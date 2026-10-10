"""Unit tests for the ML package (features, generator, export parity, alert policy)."""

import numpy as np
import pytest
from sklearn.ensemble import GradientBoostingClassifier

from guardian_ml.export import export_gbc, predict_portable
from guardian_ml.features import FEATURE_NAMES, compute_features
from guardian_ml.fusion import compute_drowsiness_score, round4
from guardian_ml.policy import COOLDOWN_S, run_session, score_session
from guardian_ml.synth import CONFOUNDERS, generate

THR = {"earThreshold": 0.21, "perclosThreshold": 0.4}


def tick(t, ear=0.3, perclos=0.05, hr=70, conf=0.95, label=0, state="alert"):
    return {
        "t": float(t),
        "ear": ear,
        "perclos": perclos,
        "heartRate": hr,
        "faceConfidence": conf,
        "label": label,
        "state": state,
    }


# ---------------------------------------------------------------- features


def test_feature_vector_shape_and_defaults_without_ear():
    f = compute_features([{"fusionScore": 0.5}, {"fusionScore": 0.8, "heartRate": 0}], THR)
    assert len(f) == len(FEATURE_NAMES)
    named = dict(zip(FEATURE_NAMES, f, strict=True))
    assert named["ear_rel_mean"] == 1.0 and named["missing_ear_frac"] == 1.0
    assert named["frac_drowsy"] == 0.5 and named["hr_present_frac"] == 0.0


def test_closed_eye_run_features():
    window = [{**tick(i), "fusionScore": 0.1} for i in range(20)]
    window += [{**tick(20 + i, ear=0.08, perclos=0.6), "fusionScore": 0.8} for i in range(5)]
    named = dict(zip(FEATURE_NAMES, compute_features(window, THR), strict=True))
    assert named["run_below_now"] == 5 and named["longest_run_below"] == 5
    assert named["ear_rel_min"] == pytest.approx(0.08 / 0.21)
    assert named["ear_rel_slope"] < 0
    assert named["frac_drowsy"] == pytest.approx(5 / 25)


def test_window_is_capped_at_30_ticks():
    window = [{**tick(i), "fusionScore": 0.0} for i in range(50)]
    assert compute_features(window, THR)[0] == 30


# ---------------------------------------------------------------- fusion port


def test_fusion_matches_backend_examples():
    score, cls = compute_drowsiness_score({"ear": 0.17, "perclos": 0.48, "heartRate": 56}, THR)
    assert round4(score) == 0.4152 and cls == "warning"
    score, cls = compute_drowsiness_score({"ear": 0.21, "perclos": 0, "heartRate": 45}, None)
    assert score == 0.4 and cls == "alert"


# ---------------------------------------------------------------- generator


def test_generator_is_deterministic_and_labelled():
    d1, r1 = generate(2, 1, 12, seed=3)
    d2, r2 = generate(2, 1, 12, seed=3)
    assert d1 == d2 and r1[:200] == r2[:200]
    labels = {r["label"] for r in r1}
    assert labels <= {-1, 0, 1}
    assert all(0 <= r["faceConfidence"] <= 1 for r in r1)
    assert all(r["ear"] is None or 0 <= r["ear"] <= 0.5 for r in r1)


def test_generator_covers_confounders_and_drowsiness():
    _, rows = generate(10, 2, 25, seed=11)
    states = {r["state"] for r in rows}
    assert "drowsy" in states and len(states & set(CONFOUNDERS)) >= 5
    drowsy = [r["ear"] for r in rows if r["label"] == 1 and r["ear"] is not None]
    awake = [r["ear"] for r in rows if r["state"] == "alert" and r["ear"] is not None]
    assert np.mean(drowsy) < np.mean(awake)


# ---------------------------------------------------------------- export parity


def test_portable_predictor_matches_sklearn_exactly():
    rng = np.random.default_rng(0)
    X = rng.normal(size=(600, len(FEATURE_NAMES)))
    y = (X[:, 1] + 0.5 * X[:, 7] + rng.normal(0, 0.5, 600) > 0).astype(int)
    clf = GradientBoostingClassifier(n_estimators=30, max_depth=3, random_state=0).fit(X, y)
    model = export_gbc(clf, 0.5, {"version": 0})
    p = clf.predict_proba(X[:100])[:, 1]
    for x, ref in zip(X[:100], p, strict=True):
        assert abs(predict_portable(model, list(x)) - ref) < 1e-9


# ---------------------------------------------------------------- policy + metrics


def drowsy_session():
    ticks = [tick(i) for i in range(60)]
    ticks += [tick(60 + i, ear=0.06, perclos=0.7, hr=50, label=1, state="drowsy") for i in range(40)]
    return ticks


def test_cooldown_limits_alerts_per_type():
    ticks = drowsy_session()
    run = run_session(ticks, THR)
    fired = [d.t for d in run.decisions if d.alert]
    assert fired and all(b - a >= COOLDOWN_S for a, b in zip(fired, fired[1:], strict=False))


def test_verifier_can_suppress_and_metrics_count_episodes():
    # 20 s awake (past the cooldown), then a look-down that *looks* drowsy to the fusion engine.
    ticks = drowsy_session() + [tick(100 + i) for i in range(20)]
    ticks += [tick(120 + i, ear=0.06, perclos=0.7, hr=50, label=0, state="phone_glance") for i in range(30)]
    base = score_session(ticks, run_session(ticks, THR))
    assert base.episodes == 1 and base.detected == 1 and base.false_alerts >= 1
    assert base.fp_by_state.get("phone_glance", 0) >= 1

    # A verifier that rejects everything removes all alerts once it has enough history.
    muted = run_session(ticks, THR, verifier=lambda f: 0.0, threshold=0.5)
    late = [d for d in muted.decisions if d.alert]
    assert all(d.verifier_score is None for d in late)  # only abstentions (< MIN_TICKS) can fire


# --------------------------------------------------------------------------- admin dataset helpers
def test_best_threshold_separates_yawns() -> None:
    from guardian_ml.calibration import best_threshold, rates_at

    yawns = [0.55, 0.62, 0.7, 0.8, 0.9]
    other = [0.05, 0.1, 0.2, 0.3, 0.58]
    best = best_threshold(yawns, other)
    assert best["threshold"] == 0.55
    assert best["tpr"] == 1.0 and best["fpr"] == 0.2
    assert rates_at(0.6, yawns, other)["tpr"] == 0.8
    floored = best_threshold(yawns, other, floor=0.6)
    assert floored["threshold"] >= 0.6
    assert best_threshold([0.1], [0.05], floor=0.3)["threshold"] == 0.3


def test_video_labels_and_recording_names() -> None:
    from pathlib import Path

    from guardian_ml.calibration import recording_name, video_label

    assert video_label(Path("rldd/07/10.mov"), "rldd") == "drowsy"
    assert video_label(Path("rldd/07/0.MP4"), "rldd") == "alert"
    assert video_label(Path("rldd/07/5.mov"), "rldd") == "ignore"
    assert video_label(Path("rldd/07/notes.txt"), "rldd") is None
    assert video_label(Path("x/Drowsy_clips/a.mp4"), "folders") == "drowsy"
    assert video_label(Path("x/normal driving/a.avi"), "folders") == "alert"
    assert video_label(Path("x/misc/a.avi"), "folders") is None
    root = Path("videos")
    assert recording_name(Path("videos/07/10.mov"), root) == "07_10.jsonl"
    assert recording_name(Path("videos/p_12/day 1/0.mov"), root) == "p-12_day-1-0.jsonl"
