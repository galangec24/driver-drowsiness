"""Export a scikit-learn GradientBoostingClassifier to portable JSON + a reference predictor.

The JSON is evaluated by backend/src/services/fpVerifier.js. `predict_portable` below is the exact
algorithm the JS uses (including float32 feature casting, which is what sklearn trees compare on),
so `predict_portable(model_json, x) == clf.predict_proba([x])[0, 1]` (parity-tested).
"""

from __future__ import annotations

import math
import struct
from typing import Any

import numpy as np

from guardian_ml.features import FEATURE_NAMES, MIN_TICKS, WINDOW


def _f32(x: float) -> float:
    return struct.unpack("f", struct.pack("f", x))[0]


def export_gbc(clf: Any, threshold: float, meta: dict[str, Any]) -> dict[str, Any]:
    init = float(clf._raw_predict_init(np.zeros((1, len(FEATURE_NAMES))))[0, 0])
    trees = []
    for est in clf.estimators_[:, 0]:
        tr = est.tree_
        trees.append(
            {
                "f": [int(v) for v in tr.feature],
                "t": [float(v) for v in tr.threshold],
                "l": [int(v) for v in tr.children_left],
                "r": [int(v) for v in tr.children_right],
                "v": [float(v) for v in tr.value[:, 0, 0]],
            }
        )
    return {
        "kind": "gradient_boosted_trees",
        "version": meta.get("version", 1),
        "features": FEATURE_NAMES,
        "window": WINDOW,
        "minTicks": MIN_TICKS,
        "threshold": threshold,
        "init": init,
        "learningRate": float(clf.learning_rate),
        "trees": trees,
        "meta": meta,
    }


def predict_portable(model: dict[str, Any], x: list[float]) -> float:
    xs = [_f32(v) for v in x]
    raw = model["init"]
    for tr in model["trees"]:
        node = 0
        while tr["l"][node] != -1:
            node = tr["l"][node] if xs[tr["f"][node]] <= tr["t"][node] else tr["r"][node]
        raw += model["learningRate"] * tr["v"][node]
    return 1.0 / (1.0 + math.exp(-raw))
