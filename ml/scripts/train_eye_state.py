"""Train the open/closed eye classifier used by driver_monitor for PERCLOS.

    python scripts/fetch_eye_data.py            # once: Kaggle → data/eyes_v1/eyes.npz
    python scripts/train_eye_state.py

Features come from driver_monitor/detectors/eye_state.py (the runtime implementation), so training
and the live monitor compute identical inputs. Writes driver_monitor/models/eye_state.json and
reports/eye_state_report.md.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import cv2
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, confusion_matrix, roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.neural_network import MLPClassifier
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parent.parent
MONITOR = ROOT.parent / "driver_monitor"
sys.path.insert(0, str(MONITOR))

from detectors.eye_state import EyeStateModel, hog_features, preprocess  # noqa: E402


def augment(img: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Webcam-like variation: low resolution, blur, noise, small pose/scale changes, lighting."""
    h, w = img.shape
    if rng.random() < 0.5:
        img = cv2.flip(img, 1)  # left vs right eye
    angle, zoom = rng.uniform(-12, 12), rng.uniform(0.85, 1.15)
    m = cv2.getRotationMatrix2D((w / 2 + rng.uniform(-3, 3), h / 2 + rng.uniform(-3, 3)), angle, zoom)
    img = cv2.warpAffine(img, m, (w, h), borderMode=cv2.BORDER_REFLECT)
    if rng.random() < 0.7:  # a webcam eye is only ~15-40 px wide
        s = int(rng.integers(12, 29))
        img = cv2.resize(
            cv2.resize(img, (s, s), interpolation=cv2.INTER_AREA), (w, h), interpolation=cv2.INTER_LINEAR
        )
    if rng.random() < 0.3:
        img = cv2.GaussianBlur(img, (3, 3), rng.uniform(0.3, 1.2))
    img = img.astype(np.float32) * rng.uniform(0.6, 1.3) + rng.uniform(-30, 30)
    img += rng.normal(0, rng.uniform(0, 8), img.shape)
    return np.clip(img, 0, 255).astype(np.uint8)


def webcam_quality(img: np.ndarray, size: int = 16) -> np.ndarray:
    h, w = img.shape
    return cv2.resize(
        cv2.resize(img, (size, size), interpolation=cv2.INTER_AREA), (w, h), interpolation=cv2.INTER_LINEAR
    )


def featurize(images: np.ndarray) -> np.ndarray:
    return np.stack([hog_features(preprocess(im)) for im in images])


def export(clf, scaler: StandardScaler, kind: str, meta: dict) -> dict:
    if kind == "logreg":
        layers = [{"W": clf.coef_.T.tolist(), "b": clf.intercept_.tolist()}]
    else:
        layers = [
            {"W": W.tolist(), "b": b.tolist()} for W, b in zip(clf.coefs_, clf.intercepts_, strict=True)
        ]
    return {
        "kind": kind,
        "mean": scaler.mean_.tolist(),
        "scale": scaler.scale_.tolist(),
        "layers": layers,
        "threshold": 0.5,
        "input": "32x32 equalised gray, OpenCV HOG (16,16)/(8,8)/(8,8)/9",
        "meta": meta,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data/eyes_v1")
    ap.add_argument("--augment", type=int, default=4, help="augmented copies per training image")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--extra", action="append", default=[], help="more eyes.npz datasets (e.g. your own)")
    ap.add_argument("--out-dir", default=None, help="write a candidate (model + report) here instead")
    args = ap.parse_args()
    out_dir = Path(args.out_dir) if args.out_dir else None
    t0 = time.time()
    rng = np.random.default_rng(args.seed)

    d = np.load(ROOT / args.data / "eyes.npz")
    images, labels, split = d["images"], d["labels"].astype(int), d["split"]
    for extra in args.extra:
        e = np.load(ROOT / extra / "eyes.npz")
        images = np.concatenate([images, e["images"]])
        labels = np.concatenate([labels, e["labels"].astype(int)])
        split = np.concatenate([split, e["split"]])
    tr_idx = np.where(split == "train")[0]
    te_idx = np.where(split == "test")[0]
    fit_idx, val_idx = train_test_split(
        tr_idx, test_size=0.15, stratify=labels[tr_idx], random_state=args.seed
    )

    aug_imgs = [images[i] for i in fit_idx] + [
        augment(images[i], rng) for i in fit_idx for _ in range(args.augment)
    ]
    aug_y = np.concatenate([labels[fit_idx]] + [np.repeat(labels[fit_idx], args.augment)])
    X_fit = featurize(np.stack(aug_imgs))
    X_val, y_val = featurize(images[val_idx]), labels[val_idx]
    X_val_cam = featurize(np.stack([webcam_quality(im) for im in images[val_idx]]))
    scaler = StandardScaler().fit(X_fit)

    candidates = [("logreg", LogisticRegression(C=c, max_iter=3000), f"C={c}") for c in (0.05, 0.3, 1.0)]
    candidates += [
        (
            "mlp",
            MLPClassifier(
                hidden_layer_sizes=(64,), alpha=a, max_iter=400, early_stopping=True, random_state=0
            ),
            f"hidden=64 alpha={a}",
        )
        for a in (1e-3, 1e-2)
    ]
    results = []
    for kind, clf, desc in candidates:
        clf.fit(scaler.transform(X_fit), aug_y)
        # Select on the mean of normal and webcam-quality validation accuracy.
        acc = accuracy_score(y_val, clf.predict(scaler.transform(X_val)))
        acc_cam = accuracy_score(y_val, clf.predict(scaler.transform(X_val_cam)))
        results.append(
            {
                "kind": kind,
                "params": desc,
                "val_acc": round(acc, 4),
                "val_acc_webcam": round(acc_cam, 4),
                "model": clf,
            }
        )
        print(f"{kind:6} {desc:22} val acc {acc:.3f}  webcam-quality {acc_cam:.3f}")
    best = max(results, key=lambda r: (r["val_acc"] + r["val_acc_webcam"], r["kind"] == "logreg"))
    clf = best["model"]

    X_te, y_te = featurize(images[te_idx]), labels[te_idx]
    X_te_cam = featurize(np.stack([webcam_quality(im) for im in images[te_idx]]))
    p_te = clf.predict_proba(scaler.transform(X_te))[:, 1]
    p_cam = clf.predict_proba(scaler.transform(X_te_cam))[:, 1]
    test = {
        "accuracy": round(accuracy_score(y_te, p_te >= 0.5), 4),
        "roc_auc": round(roc_auc_score(y_te, p_te), 4),
        "confusion_[open,closed]": confusion_matrix(y_te, p_te >= 0.5).tolist(),
        "webcam_quality_accuracy": round(accuracy_score(y_te, p_cam >= 0.5), 4),
        "webcam_quality_roc_auc": round(roc_auc_score(y_te, p_cam), 4),
    }
    print("test", test)

    meta = {
        "dataset": str(json.loads((ROOT / args.data / "stats.json").read_text())["dataset"]),
        "trained_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "selected": best["params"],
        "test": test,
    }
    spec = export(clf, scaler, best["kind"], meta)
    runtime = EyeStateModel(spec)
    diff = float(np.max(np.abs(runtime.prob_closed(X_te) - p_te)))
    # sklearn computes in float32 for float32 features; the runtime uses float64.
    assert diff < 1e-5, f"runtime/sklearn mismatch {diff}"
    out = (out_dir / "eye_state.json") if out_dir else (MONITOR / "models" / "eye_state.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(spec), encoding="utf8")
    if out_dir:
        metrics = {
            "test": test,
            "selected": best["params"],
            "kind": best["kind"],
            "datasets": [args.data, *args.extra],
        }
        (out_dir / "metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf8")

    rows = "\n".join(
        f"| {r['kind']} | {r['params']} | {r['val_acc']} | {r['val_acc_webcam']} |" for r in results
    )
    stats = json.loads((ROOT / args.data / "stats.json").read_text())
    report = f"""# Eye-state classifier (open / closed)

Dataset: Kaggle `{stats['dataset']}` — {stats['open']} open + {stats['closed']} closed eye photos
({stats['train']} train / {stats['test']} test as published;
{stats['test_images_with_near_duplicate_in_train']} test images have a near-duplicate in train).
Training images get {args.augment} augmented copies each
(webcam-like low resolution, blur, noise, rotation, lighting, mirroring).

Features: 32x32 histogram-equalised gray → OpenCV HOG (324 values), computed by
`driver_monitor/detectors/eye_state.py` for both training and runtime.

## Model selection (validation = 15 % of the published train split)

| Model | Params | Val accuracy | Val accuracy, webcam quality (16 px) |
|---|---|---|---|
{rows}

Selected: **{best['kind']} ({best['params']})**.

## Held-out test set

| Metric | Value |
|---|---|
| Accuracy | {test['accuracy']:.1%} |
| ROC-AUC | {test['roc_auc']} |
| Confusion [open, closed] (rows = truth) | {test['confusion_[open,closed]']} |
| Accuracy at webcam quality (eye downscaled to 16 px) | {test['webcam_quality_accuracy']:.1%} |
| ROC-AUC at webcam quality | {test['webcam_quality_roc_auc']} |

Runtime/sklearn parity: max |Δp| = {diff:.1e}.

## How it is used

`driver_monitor` crops each eye from the FaceMesh landmarks every analysed frame. A frame counts as
*closed* for PERCLOS when the model's mean closed-probability for both eyes is ≥ 0.5; EAR is still
measured and sent unchanged. Looking down, squinting and glasses lower EAR but usually leave the eye
visibly open, so PERCLOS stops counting those frames — fewer false drowsiness signals before the
backend's fusion engine and verifier even see them. `EYE_STATE=off` restores the EAR-only rule.

## Caveats

- Close-up photos, not dashboard-webcam frames: the webcam-quality rows estimate the resolution gap,
  not angle, infrared or motion blur. Record your own eyes with `driver_monitor --save-eyes` and add
  them (see ml/README.md) to close the gap.
- ~1,450 images from a scraped dataset; subjects are unknown, so test images may share people with
  training images. Treat the test accuracy as optimistic.
"""
    if out_dir:
        (out_dir / "report.md").write_text(report, encoding="utf8")
    else:
        (ROOT / "reports").mkdir(exist_ok=True)
        (ROOT / "reports" / "eye_state_report.md").write_text(report, encoding="utf8")
    print(f"wrote {out} ({out.stat().st_size // 1024} KB) in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
