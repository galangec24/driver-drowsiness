"""Real-webcam check of the eye pipeline on the Driver Drowsiness Dataset (DDD, Kaggle).

DDD = face frames cut from UTA-RLDD webcam videos, labelled *Drowsy* / *Non Drowsy* (not eyes
open/closed), so it can't train the eye model. It *can* show how well the in-car signals separate
drowsy from alert faces on real webcams: for a sample of frames this runs the same steps as
driver_monitor (FaceMesh landmarks -> EAR, eye crops -> eye-state model) and reports ROC-AUC.

Run with the driver_monitor venv (it has MediaPipe); the download needs kagglehub (ml venv):

    ml\\venv\\Scripts\\python -c "import os,kagglehub; os.environ['KAGGLEHUB_CACHE']='ml/data/ddd_raw'; \\
        print(kagglehub.dataset_download('ismailnasri20/driver-drowsiness-dataset-ddd'))"
    driver_monitor\\venv\\Scripts\\python ml\\scripts\\eval_ddd.py \\
        --models driver_monitor/models/eye_state.json ml/reports/candidate_eye/eye_state.json --per-class 1500

Frames come from 60 people's videos, so neighbouring frames look alike: treat the numbers as a
realistic sanity check, not a benchmark.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "driver_monitor"))

from detectors.ear import average_ear  # noqa: E402
from detectors.eye_state import EyeStateModel, crop_eye  # noqa: E402
from detectors.landmarks import LandmarkExtractor, eye_points  # noqa: E402


def auc(pos: list[float], neg: list[float]) -> float:
    """P(score of a random drowsy frame > score of a random alert frame); ties count half."""
    s = np.array(pos + neg)
    y = np.array([1] * len(pos) + [0] * len(neg))
    order = s.argsort(kind="mergesort")
    ranks = np.empty(len(s))
    ranks[order] = np.arange(1, len(s) + 1)
    for v in np.unique(s):  # average ranks of ties
        m = s == v
        ranks[m] = ranks[m].mean()
    n1, n0 = len(pos), len(neg)
    return float((ranks[y == 1].sum() - n1 * (n1 + 1) / 2) / (n1 * n0))


WEIGHTS = [round(w, 1) for w in np.arange(0.0, 1.01, 0.1)]  # share given to the eye model


def fuse(ear: dict[str, list[float]], eye: dict[str, list[float]], rng: random.Random) -> dict:
    """EAR + eye model as one score: w * z(eye) + (1 - w) * z(-EAR).

    Each signal is z-scored over all frames (labels unused). The weight is chosen on a random half
    of the frames and the AUC reported on the other half, so the number isn't tuned to itself.
    """
    z = {}
    for name, s in (("ear", ear), ("eye", eye)):
        allv = np.array(s["drowsy"] + s["alert"])
        mu, sd = allv.mean(), allv.std() or 1.0
        z[name] = {k: (np.array(v) - mu) / sd for k, v in s.items()}
    halves = {}
    for cls in ("drowsy", "alert"):
        idx = list(range(len(z["ear"][cls])))
        rng.shuffle(idx)
        halves[cls] = (idx[: len(idx) // 2], idx[len(idx) // 2 :])

    def auc_at(w: float, half: int) -> float:
        s = {c: w * z["eye"][c] + (1 - w) * z["ear"][c] for c in ("drowsy", "alert")}
        pick = {c: s[c][halves[c][half]].tolist() for c in s}
        return auc(pick["drowsy"], pick["alert"])

    tune = {w: auc_at(w, 0) for w in WEIGHTS}
    best = max(tune, key=tune.get)
    return {
        "best_eye_weight": best,
        "held_out_auc": round(auc_at(best, 1), 4),
        "held_out_auc_ear_only": round(auc_at(0.0, 1), 4),
        "held_out_auc_eye_only": round(auc_at(1.0, 1), 4),
        "tuning_half_auc_by_weight": {str(w): round(a, 4) for w, a in tune.items()},
    }


def find_dir(base: Path, names: tuple[str, ...]) -> Path:
    for p in base.rglob("*"):
        if p.is_dir() and p.name.lower() in names:
            return p
    raise SystemExit(f"no folder named {names} under {base}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=str(ROOT / "ml" / "data" / "ddd_raw"))
    ap.add_argument("--models", nargs="+", required=True, help="eye_state.json files to compare")
    ap.add_argument("--per-class", type=int, default=1500)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--out", default=str(ROOT / "ml" / "reports" / "ddd_eval.json"))
    args = ap.parse_args()

    base = Path(args.data)
    classes = {
        "drowsy": find_dir(base, ("drowsy",)),
        "alert": find_dir(base, ("non drowsy", "non_drowsy", "nondrowsy")),
    }
    models = {Path(m).as_posix(): EyeStateModel.load(Path(m)) for m in args.models}
    lm = LandmarkExtractor(ROOT / "driver_monitor" / "models" / "face_landmarker.task")
    rng = random.Random(args.seed)

    scores: dict[str, dict[str, list[float]]] = {"ear": {"drowsy": [], "alert": []}}
    for m in models:
        scores[m] = {"drowsy": [], "alert": []}
    seen = {"drowsy": 0, "alert": 0}
    for cls, d in classes.items():
        files = sorted(f for f in d.iterdir() if f.suffix.lower() in {".jpg", ".jpeg", ".png"})
        rng.shuffle(files)
        for f in files[: args.per_class]:
            bgr = cv2.imread(str(f))
            if bgr is None:
                continue
            seen[cls] += 1
            pts = lm.extract(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
            if pts is None:
                continue
            gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
            crops = [c for c in (crop_eye(gray, e) for e in eye_points(pts)) if c is not None]
            if not crops:
                continue
            # lower EAR = more closed, so negate it: higher score = "more drowsy" for every column
            scores["ear"][cls].append(-average_ear(pts))
            for name, model in models.items():
                scores[name][cls].append(float(model.predict_crops(crops).mean()))
    lm.close()

    result = {
        "frames_tried": seen,
        "faces_found": {k: len(v) for k, v in scores["ear"].items()},
        "auc": {name: round(auc(s["drowsy"], s["alert"]), 4) for name, s in scores.items()},
        "mean_closed_prob": {
            name: {k: round(float(np.mean(v)), 3) for k, v in s.items()}
            for name, s in scores.items()
            if name != "ear"
        },
        "fused_with_ear": {m: fuse(scores["ear"], scores[m], rng) for m in models},
    }
    Path(args.out).write_text(json.dumps(result, indent=2), encoding="utf8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
