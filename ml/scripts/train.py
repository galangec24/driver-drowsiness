"""Train, evaluate and export the false-positive verifier.

    python scripts/train.py --data data/synthetic_v1
    python scripts/train.py --data data/synthetic_v1 --extra data/recordings_v1 \
        --feedback data/feedback/alerts.jsonl

--extra      additional datasets in the same format (e.g. imported real recordings); their drivers are
             split train/val/test the same way as the synthetic ones
--feedback   parent-labelled alerts exported by `npm run export:feedback` (training only, weight 5)

Outputs
  ../backend/src/ml/fp-verifier.json        model the backend loads (no Python at runtime)
  ../backend/tests/fixtures/fp-parity.json  Python↔JS parity cases (features, probabilities, fusion)
  reports/fp_verifier_report.md, reports/metrics.json

--out-dir DIR   write a *candidate* instead (DIR/fp-verifier.json, metrics.json, report.md) and leave
                the live model, parity fixture and reports untouched. Used by the admin training jobs.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from guardian_ml.data import load_dataset
from guardian_ml.export import export_gbc, predict_portable
from guardian_ml.features import FEATURE_NAMES, compute_features
from guardian_ml.fusion import (
    compute_drowsiness_score,
    resolve_thresholds,
)
from guardian_ml.policy import (
    Metrics,
    SessionRun,
    fire_alerts,
    score_session,
    score_ticks,
)

BACKEND = ROOT.parent / "backend"
TARGET_RECALL = 0.97


def split_drivers(ids: list[str], seed: int) -> dict[str, str]:
    ids = sorted(ids)
    random.Random(seed).shuffle(ids)
    n = len(ids)
    a, b = int(n * 0.70), int(n * 0.85)
    return {d: ("train" if i < a else "val" if i < b else "test") for i, d in enumerate(ids)}


def scored_runs(sessions, drivers, persistence=False) -> dict[str, SessionRun]:
    return {
        sid: score_ticks(ticks, drivers[ticks[0]["driver_id"]]["thresholds"], persistence, None)
        for sid, ticks in sessions.items()
    }


def xy(sessions, runs) -> tuple[np.ndarray, np.ndarray]:
    X, y = [], []
    for sid, run in runs.items():
        ticks = sessions[sid]
        for i, d in enumerate(run.decisions):
            if d.features is not None and ticks[i]["label"] != -1:
                X.append(d.features)
                y.append(ticks[i]["label"])
    return np.array(X, dtype=np.float64), np.array(y)


def load_feedback(path: Path) -> tuple[np.ndarray, np.ndarray]:
    """Parent labels → (features recomputed from the stored window, label: 0 false alarm / 1 real)."""
    X, y = [], []
    if not path.exists():
        return np.zeros((0, len(FEATURE_NAMES))), np.zeros(0)
    for line in path.read_text(encoding="utf8").splitlines():
        rec = json.loads(line)
        window = (rec.get("verifier") or {}).get("window")
        if not window:
            continue
        X.append(compute_features(window, rec["thresholds"]))
        y.append(0 if rec["falseAlarm"] else 1)
    return np.array(X, dtype=np.float64).reshape(-1, len(FEATURE_NAMES)), np.array(y)


def attach_scores(runs: dict[str, SessionRun], clf: Any) -> None:
    """Batch-predict verifier scores for every eligible tick (scores don't depend on the threshold)."""
    refs, feats = [], []
    for run in runs.values():
        for d in run.decisions:
            d.verifier_score = None
            if d.features is not None:
                refs.append(d)
                feats.append(d.features)
    if feats:
        probs = clf.predict_proba(np.array(feats))[:, 1]
        for d, p in zip(refs, probs, strict=True):
            d.verifier_score = float(p)


def evaluate(sessions, runs, threshold: float) -> Metrics:
    m = Metrics()
    for sid, run in runs.items():
        m.merge(score_session(sessions[sid], fire_alerts(run, threshold)))
    return m


def clear_scores(runs: dict[str, SessionRun]) -> None:
    for run in runs.values():
        for d in run.decisions:
            d.verifier_score = None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data/synthetic_v1")
    ap.add_argument("--seed", type=int, default=13)
    ap.add_argument("--extra", action="append", default=[])
    ap.add_argument("--feedback", default=None)
    ap.add_argument("--shift-test", default=None, help="extra held-out dataset from a shifted population")
    ap.add_argument("--out-dir", default=None, help="write a candidate model + report here instead")
    args = ap.parse_args()
    out_dir = Path(args.out_dir) if args.out_dir else None
    t0 = time.time()

    drivers, sessions = load_dataset(ROOT / args.data)
    for extra in args.extra:
        d2, s2 = load_dataset(ROOT / extra)
        drivers.update(d2)
        sessions.update(s2)
    split = split_drivers(list(drivers), args.seed)
    part = {
        k: {sid: tk for sid, tk in sessions.items() if split[tk[0]["driver_id"]] == k}
        for k in ("train", "val", "test")
    }
    print({k: len(v) for k, v in part.items()}, "sessions")

    runs = {k: scored_runs(v, drivers) for k, v in part.items()}
    X_tr, y_tr = xy(part["train"], runs["train"])
    X_te, y_te = xy(part["test"], runs["test"])
    weights = np.ones(len(y_tr))
    if args.feedback:
        X_fb, y_fb = load_feedback(ROOT / args.feedback)
        print(f"feedback examples {len(y_fb)} (false alarms {int((y_fb == 0).sum())})")
        if len(y_fb):
            X_tr = np.vstack([X_tr, X_fb])
            y_tr = np.concatenate([y_tr, y_fb])
            weights = np.concatenate([weights, np.full(len(y_fb), 5.0)])
    print(f"train candidates {len(y_tr)} (pos {y_tr.mean():.2%}), test {len(y_te)}")

    clf = GradientBoostingClassifier(
        n_estimators=250,
        max_depth=3,
        learning_rate=0.08,
        subsample=0.8,
        min_samples_leaf=40,
        random_state=0,
    ).fit(X_tr, y_tr, sample_weight=weights)
    logreg = make_pipeline(StandardScaler(), LogisticRegression(max_iter=3000)).fit(X_tr, y_tr)
    p_gbt, p_lr = clf.predict_proba(X_te)[:, 1], logreg.predict_proba(X_te)[:, 1]
    tick_metrics = {
        "gbt": {
            "roc_auc": round(roc_auc_score(y_te, p_gbt), 4),
            "pr_auc": round(average_precision_score(y_te, p_gbt), 4),
        },
        "logreg": {
            "roc_auc": round(roc_auc_score(y_te, p_lr), 4),
            "pr_auc": round(average_precision_score(y_te, p_lr), 4),
        },
    }
    print("tick-level", tick_metrics)

    # --- threshold selection on validation drivers (event level)
    clear_scores(runs["val"])
    baseline_val = evaluate(part["val"], runs["val"], 0.0)
    attach_scores(runs["val"], clf)
    sweep = []
    for thr in np.round(np.arange(0.02, 0.99, 0.02), 2):
        m = evaluate(part["val"], runs["val"], float(thr))
        sweep.append({"threshold": float(thr), **m.summary()})
    ok = [s for s in sweep if s["episode_recall"] >= TARGET_RECALL * baseline_val.recall]
    # Safety first: among thresholds that keep recall, take the fewest false alerts and, on ties,
    # the LOWEST threshold (a missed drowsy episode costs more than a false alarm).
    chosen = (
        min(ok, key=lambda s: (s["false_alerts_per_hour"], s["threshold"]))
        if ok
        else max(sweep, key=lambda s: s["episode_recall"])
    )
    threshold = chosen["threshold"]
    print(
        f"chosen threshold {threshold} on val: {chosen['false_alerts_per_hour']} FA/h, "
        f"recall {chosen['episode_recall']}"
    )

    # --- held-out test drivers: baseline vs persistence gate vs verifier
    clear_scores(runs["test"])
    baseline = evaluate(part["test"], runs["test"], 0.0)
    persist_runs = scored_runs(part["test"], drivers, persistence=True)
    persistence = evaluate(part["test"], persist_runs, 0.0)
    attach_scores(runs["test"], clf)
    verifier = evaluate(part["test"], runs["test"], threshold)
    policies = {
        "baseline (current backend)": baseline.summary(),
        "persistence gate (drowsyDurationMs, 1-tick tolerance)": persistence.summary(),
        "learned verifier": verifier.summary(),
    }
    for k, v in policies.items():
        print(k, v)

    shift_policies = None
    if args.shift_test:
        sd, ss = load_dataset(ROOT / args.shift_test)
        sruns = scored_runs(ss, sd)
        shift_base = evaluate(ss, sruns, 0.0)
        attach_scores(sruns, clf)
        shift_policies = {
            "baseline (current backend)": shift_base.summary(),
            "learned verifier": evaluate(ss, sruns, threshold).summary(),
        }
        for k, v in shift_policies.items():
            print("shift", k, v)

    # --- export model + parity fixture
    meta = {
        "version": 1,
        "trained_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "dataset": args.data,
        "train_candidates": len(y_tr),
        "val_threshold_selection": {
            "target_recall_vs_baseline": TARGET_RECALL,
            **chosen,
        },
        "test": policies["learned verifier"],
        "note": "Trained on synthetic data; validate on real recordings before relying on it.",
    }
    model = export_gbc(clf, threshold, meta)
    sample = X_te[: min(400, len(X_te))]
    max_diff = max(
        abs(predict_portable(model, list(x)) - p)
        for x, p in zip(sample, clf.predict_proba(sample)[:, 1], strict=True)
    )
    assert max_diff < 1e-9, f"portable predictor mismatch {max_diff}"
    if out_dir is None:
        (BACKEND / "src" / "ml").mkdir(parents=True, exist_ok=True)
        (BACKEND / "src" / "ml" / "fp-verifier.json").write_text(json.dumps(model), encoding="utf8")
        write_parity_fixture(part["test"], drivers, runs["test"], model)
    else:
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "fp-verifier.json").write_text(json.dumps(model), encoding="utf8")

    importances = sorted(zip(FEATURE_NAMES, clf.feature_importances_, strict=True), key=lambda kv: -kv[1])
    report = {
        "dataset": args.data,
        "sessions": {k: len(v) for k, v in part.items()},
        "drivers": {k: sum(1 for s in split.values() if s == k) for k in ("train", "val", "test")},
        "tick_level_test": tick_metrics,
        "threshold": threshold,
        "val_sweep": sweep,
        "test_policies": policies,
        "shift_test": args.shift_test,
        "shift_policies": shift_policies,
        "feature_importance": [[k, round(float(v), 4)] for k, v in importances],
        "portable_parity_max_abs_diff": max_diff,
        "seconds": round(time.time() - t0, 1),
    }
    report["extra"] = args.extra
    report["feedback"] = args.feedback
    if out_dir is None:
        (ROOT / "reports").mkdir(exist_ok=True)
        (ROOT / "reports" / "metrics.json").write_text(json.dumps(report, indent=2), encoding="utf8")
        (ROOT / "reports" / "fp_verifier_report.md").write_text(render_report(report), encoding="utf8")
    else:
        (out_dir / "metrics.json").write_text(json.dumps(report, indent=2), encoding="utf8")
        (out_dir / "report.md").write_text(render_report(report), encoding="utf8")
    print(f"done in {report['seconds']}s")


def write_parity_fixture(sessions, drivers, runs, model) -> None:
    rng = random.Random(5)
    cases = []
    sids = sorted(runs)
    while len(cases) < 150:
        sid = rng.choice(sids)
        ticks, run = sessions[sid], runs[sid]
        idx = [i for i, d in enumerate(run.decisions) if d.features is not None]
        if not idx:
            continue
        i = rng.choice(idx)
        thr = resolve_thresholds(drivers[ticks[0]["driver_id"]]["thresholds"])
        window = [
            {k: ticks[j][k] for k in ("t", "ear", "perclos", "heartRate", "faceConfidence")}
            | {"fusionScore": run.decisions[j].fusion}
            for j in range(max(0, i - 29), i + 1)
        ]
        feats = run.decisions[i].features
        cases.append(
            {
                "thresholds": thr,
                "window": window,
                "features": feats,
                "probability": predict_portable(model, feats),
            }
        )
    fusion_cases = []
    for _ in range(100):
        sid = rng.choice(sids)
        tick = rng.choice(sessions[sid])
        thr = drivers[tick["driver_id"]]["thresholds"]
        signals = {k: tick[k] for k in ("ear", "perclos", "heartRate") if tick[k] is not None}
        score, cls = compute_drowsiness_score(signals, thr)
        fusion_cases.append(
            {
                "signals": signals,
                "thresholds": thr,
                "fusionScore": score,
                "classification": cls,
            }
        )
    out = BACKEND / "tests" / "fixtures" / "fp-parity.json"
    out.write_text(json.dumps({"verifier": cases, "fusion": fusion_cases}), encoding="utf8")


def render_report(r: dict[str, Any]) -> str:
    rows = "\n".join(
        f"| {name} | {m['false_alerts_per_hour']} | {m['false_alerts']} | {m['episode_recall']:.1%} "
        f"| {m['median_detection_latency_s']} |"
        for name, m in r["test_policies"].items()
    )
    base = r["test_policies"]["baseline (current backend)"]["false_alerts_per_hour"]
    ver = r["test_policies"]["learned verifier"]["false_alerts_per_hour"]
    reduction = (1 - ver / base) * 100 if base else 0
    by_state = "\n".join(
        f"| {name} | " + ", ".join(f"{k}: {v}" for k, v in m["false_alerts_by_state"].items()) + " |"
        for name, m in r["test_policies"].items()
    )
    feats = "\n".join(f"| {k} | {v} |" for k, v in r["feature_importance"][:12])
    t = r["tick_level_test"]
    return f"""# False-positive verifier — evaluation report

Dataset `{r['dataset']}` · drivers train/val/test =
{r['drivers']['train']}/{r['drivers']['val']}/{r['drivers']['test']}
(split **by driver**, so test drivers were never seen in training) · alert threshold **{r['threshold']}**
(chosen on validation drivers: fewest false alerts while keeping >= 97 % of the baseline's
episode recall; ties go to the lowest threshold, since a missed drowsy episode costs more than a
false alarm).

## Held-out test drivers

| Policy | False alerts / hour | False alerts | Drowsy episodes detected | Median detection latency (s) |
|---|---|---|---|---|
{rows}

**False alerts reduced by {reduction:.0f} %** versus the current backend.

False alerts by what the driver was actually doing:

| Policy | Breakdown |
|---|---|
{by_state}

{render_shift(r)}
## Tick-level discrimination (candidate ticks, test drivers)

| Model | ROC-AUC | PR-AUC |
|---|---|---|
| Gradient-boosted trees (deployed) | {t['gbt']['roc_auc']} | {t['gbt']['pr_auc']} |
| Logistic regression (reference) | {t['logreg']['roc_auc']} | {t['logreg']['pr_auc']} |

## Most important features

| Feature | Importance |
|---|---|
{feats}

## Caveats

- The data is **synthetic**: it models known drowsiness markers and common false-alarm situations,
  but its numbers are not real-world accuracy. Re-run this report on real recordings
  (`scripts/import_recordings.py`) and parent feedback (`npm run export:feedback` in `backend/`).
- The persistence gate is reported for comparison only. Applying `drowsyDurationMs` to 1 Hz
  classifications costs recall and latency because early drowsiness flickers between bands; it is
  not enabled in the backend.
- Python↔JS parity: max |Δp| = {r['portable_parity_max_abs_diff']:.2e} on held-out samples.
"""


def render_shift(r: dict[str, Any]) -> str:
    if not r.get("shift_policies"):
        return ""
    rows = "\n".join(
        f"| {name} | {m['false_alerts_per_hour']} | {m['episode_recall']:.1%} "
        f"| {m['median_detection_latency_s']} |"
        for name, m in r["shift_policies"].items()
    )
    return f"""## Robustness: shifted population (`{r['shift_test']}`, never used for training)

Subtler drowsiness, twice as many glasses wearers, 1.5x sensor noise, more confounders.

| Policy | False alerts / hour | Drowsy episodes detected | Median detection latency (s) |
|---|---|---|---|
{rows}
"""


if __name__ == "__main__":
    main()
