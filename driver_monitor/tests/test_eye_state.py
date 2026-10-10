"""Eye-state classifier: features, cropping, model forward pass, PERCLOS integration."""

import json

import numpy as np
import pytest

import config
from detectors.eye_state import N_FEATURES, EyeStateModel, crop_eye, hog_features, preprocess
from detectors.perclos import PerclosTracker


def eye_image(open_: bool) -> np.ndarray:
    """Crude synthetic eye: dark iris disc when open, a thin dark line when closed."""
    img = np.full((64, 64), 200, np.uint8)
    yy, xx = np.mgrid[:64, :64]
    if open_:
        img[(yy - 32) ** 2 + (xx - 32) ** 2 < 14**2] = 40
    else:
        img[31:34, 10:54] = 40
    return img


def test_preprocess_and_hog_shapes():
    eye = preprocess(np.random.default_rng(0).integers(0, 255, (80, 120, 3), dtype=np.uint8))
    assert eye.shape == (32, 32) and eye.dtype == np.uint8
    f = hog_features(eye)
    assert f.shape == (N_FEATURES,) and np.isfinite(f).all()
    assert np.array_equal(f, hog_features(eye))  # deterministic


def test_hog_distinguishes_open_and_closed_shapes():
    f_open = hog_features(preprocess(eye_image(True)))
    f_closed = hog_features(preprocess(eye_image(False)))
    assert np.linalg.norm(f_open - f_closed) > 1.0


def test_crop_eye_is_square_and_centred():
    gray = np.zeros((480, 640), np.uint8)
    pts = [(300, 200), (310, 195), (320, 195), (330, 200), (320, 205), (310, 205)]
    crop = crop_eye(gray, pts)
    assert crop is not None and crop.shape == (48, 48)  # 1.6 x 30 px eye width
    assert crop_eye(gray, [(10, 10)] * 6) is None  # degenerate eye


def test_forward_pass_matches_manual_logistic():
    spec = {
        "kind": "logreg",
        "mean": [0.0] * 2,
        "scale": [1.0] * 2,
        "layers": [{"W": [[2.0], [-1.0]], "b": [0.5]}],
    }
    m = EyeStateModel(spec)
    p = m.prob_closed(np.array([[1.0, 3.0]]))[0]
    assert p == pytest.approx(1 / (1 + np.exp(-(2 - 3 + 0.5))))


def test_trained_model_loads_and_outputs_probabilities():
    assert config.EYE_STATE_MODEL.exists(), "run ml/scripts/train_eye_state.py"
    spec = json.loads(config.EYE_STATE_MODEL.read_text())
    assert len(spec["mean"]) == N_FEATURES
    m = EyeStateModel(spec)
    probs = m.predict_crops([eye_image(True), eye_image(False), np.full((40, 40), 128, np.uint8)])
    assert probs.shape == (3,) and ((probs >= 0) & (probs <= 1)).all()


def test_perclos_uses_model_decision_when_given():
    tr = PerclosTracker(min_baseline_samples=5)
    for i in range(20):  # EAR looks fully open, but the image model says closed half the time
        tr.update(0.30, i * 0.1, closed=(i % 2 == 0))
    assert tr.value == pytest.approx(0.5)
