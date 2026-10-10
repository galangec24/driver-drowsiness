"""Open/closed eye classifier on eye crops (CPU, numpy only at runtime).

Why: EAR comes from landmark geometry and drops when the driver looks down, squints or wears
glasses — the main sources of false drowsiness alerts. This model looks at the eye *image* and is
used to decide which frames count as "closed" for PERCLOS. It does not change the ingest payload.

Single source of truth: ml/scripts/train_eye_state.py imports `preprocess` and `hog_features`
from this file, so training and runtime features are identical.

Model file (JSON, produced by training): {"kind": "mlp"|"logreg", "mean", "scale", "layers": [...]}.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from pathlib import Path

import cv2
import numpy as np

SIZE = 32
CELL = 8
BINS = 9
N_FEATURES = 324  # 3x3 blocks (2x2 cells, stride 1 cell) x 4 cells x 9 bins


def preprocess(image: np.ndarray) -> np.ndarray:
    """Any BGR/gray eye crop → 32x32 uint8, histogram-equalised (lighting-robust)."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    small = cv2.resize(gray, (SIZE, SIZE), interpolation=cv2.INTER_AREA)
    return cv2.equalizeHist(small)


def hog_features(eye32: np.ndarray) -> np.ndarray:
    """32x32 uint8 → 324 HOG features (float32). Plain numpy (Dalal-Triggs style: unsigned
    gradients, 9 bins, 8x8 cells, 2x2-cell blocks with L2-Hys) so it is identical on every
    OpenCV version and platform."""
    img = eye32.astype(np.float32)
    gx = np.zeros_like(img)
    gy = np.zeros_like(img)
    gx[:, 1:-1] = img[:, 2:] - img[:, :-2]
    gy[1:-1, :] = img[2:, :] - img[:-2, :]
    mag = np.hypot(gx, gy)
    ang = np.rad2deg(np.arctan2(gy, gx)) % 180.0
    bins = np.minimum((ang / (180.0 / BINS)).astype(np.int64), BINS - 1)
    n = SIZE // CELL
    hist = np.zeros((n, n, BINS), dtype=np.float32)
    for cy in range(n):
        for cx in range(n):
            sl = (slice(cy * CELL, (cy + 1) * CELL), slice(cx * CELL, (cx + 1) * CELL))
            hist[cy, cx] = np.bincount(bins[sl].ravel(), weights=mag[sl].ravel(), minlength=BINS)
    feats = []
    for by in range(n - 1):
        for bx in range(n - 1):
            v = hist[by : by + 2, bx : bx + 2].ravel()
            v = v / np.sqrt(np.sum(v * v) + 1e-6)
            v = np.minimum(v, 0.2)  # L2-Hys clipping
            feats.append(v / np.sqrt(np.sum(v * v) + 1e-6))
    return np.concatenate(feats).astype(np.float32)


def crop_eye(gray: np.ndarray, points: Sequence[Sequence[float]], scale: float = 1.6) -> np.ndarray | None:
    """Square crop centred on an eye's landmark points, side = scale x eye width
    (matches the framing of the training photos: eye + some lid/brow context)."""
    pts = np.asarray(points, dtype=np.float32)[:, :2]
    cx, cy = pts.mean(axis=0)
    width = float(pts[:, 0].max() - pts[:, 0].min())
    if width < 4:
        return None
    half = width * scale / 2
    h, w = gray.shape[:2]
    x0, x1 = int(max(0, cx - half)), int(min(w, cx + half))
    y0, y1 = int(max(0, cy - half)), int(min(h, cy + half))
    if x1 - x0 < 6 or y1 - y0 < 6:
        return None
    return gray[y0:y1, x0:x1]


class EyeStateModel:
    """Numpy forward pass of the exported scikit-learn model."""

    def __init__(self, spec: dict) -> None:
        self.kind = spec["kind"]
        self.mean = np.asarray(spec["mean"], dtype=np.float64)
        self.scale = np.asarray(spec["scale"], dtype=np.float64)
        self.layers = [
            (np.asarray(L["W"], dtype=np.float64), np.asarray(L["b"], dtype=np.float64))
            for L in spec["layers"]
        ]
        self.threshold = float(spec.get("threshold", 0.5))

    @classmethod
    def load(cls, path: Path) -> EyeStateModel:
        return cls(json.loads(Path(path).read_text(encoding="utf8")))

    def prob_closed(self, features: np.ndarray) -> np.ndarray:
        """features: (n, 324) → probability each eye is closed."""
        x = (np.atleast_2d(features).astype(np.float64) - self.mean) / self.scale
        for i, (W, b) in enumerate(self.layers):
            x = x @ W + b
            if i < len(self.layers) - 1:
                x = np.maximum(x, 0.0)  # ReLU hidden layers
        return 1.0 / (1.0 + np.exp(-x[:, 0]))

    def predict_crops(self, crops: Sequence[np.ndarray]) -> np.ndarray:
        feats = np.stack([hog_features(preprocess(c)) for c in crops])
        return self.prob_closed(feats)
