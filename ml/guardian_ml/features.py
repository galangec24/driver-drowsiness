"""Window features for the false-positive verifier — THE canonical definition.

backend/src/services/fpFeatures.js is a line-for-line port. Any change here must be mirrored there,
then `python scripts/make_parity_fixture.py` regenerated; the backend parity test fails otherwise.

Pure Python on purpose (no numpy): summation order must match the JS exactly.

A tick is a dict with: t (seconds), ear, perclos, heartRate, faceConfidence (each float or None),
fusionScore (float). heartRate <= 0 means "no sensor". All EAR/PERCLOS features are relative to the
driver's *personal* thresholds, so the model generalises across drivers.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from typing import Any

WINDOW = 30  # ticks (~30 s at 1 Hz)
MIN_TICKS = 10  # verifier abstains with less history

FEATURE_NAMES: list[str] = [
    "n_ticks",
    "ear_rel_last",
    "ear_rel_mean",
    "ear_rel_min",
    "ear_rel_std",
    "ear_rel_slope",
    "ear_rel_mad",
    "frac_below",
    "run_below_now",
    "longest_run_below",
    "missing_ear_frac",
    "perclos_rel_last",
    "perclos_rel_slope",
    "hr_present_frac",
    "hr_mean",
    "hr_slope",
    "face_conf_mean",
    "face_conf_min",
    "fusion_last",
    "fusion_mean",
    "frac_nonalert",
    "frac_drowsy",
]


def _valid(v: Any) -> bool:
    return isinstance(v, int | float) and not isinstance(v, bool) and math.isfinite(v)


def _mean(xs: list[float]) -> float:
    s = 0.0
    for x in xs:
        s += x
    return s / len(xs)


def _std(xs: list[float]) -> float:
    m = _mean(xs)
    s = 0.0
    for x in xs:
        s += (x - m) * (x - m)
    return math.sqrt(s / len(xs))


def _slope(idx: list[float], ys: list[float]) -> float:
    """Least-squares slope of ys against idx (per tick). 0 with < 2 points."""
    n = len(ys)
    if n < 2:
        return 0.0
    mx = _mean(idx)
    my = _mean(ys)
    num = 0.0
    den = 0.0
    for i in range(n):
        dx = idx[i] - mx
        num += dx * (ys[i] - my)
        den += dx * dx
    return 0.0 if den == 0 else num / den


def compute_features(window: Sequence[dict[str, Any]], thresholds: dict[str, float]) -> list[float]:
    """window: most recent ticks, oldest first (the last WINDOW are used)."""
    w = list(window)[-WINDOW:]
    n = len(w)
    ear_thr = thresholds["earThreshold"]
    perclos_thr = thresholds["perclosThreshold"]

    ear_idx: list[float] = []
    ear_rel: list[float] = []
    below_flags: list[bool] = []
    perclos_idx: list[float] = []
    perclos_rel: list[float] = []
    hr_idx: list[float] = []
    hr: list[float] = []
    face: list[float] = []
    fusion: list[float] = []
    nonalert = 0
    drowsy = 0

    for i, tick in enumerate(w):
        e = tick.get("ear")
        if _valid(e):
            ear_idx.append(float(i))
            ear_rel.append(e / ear_thr)
            below_flags.append(e < ear_thr)
        else:
            below_flags.append(False)
        p = tick.get("perclos")
        if _valid(p):
            perclos_idx.append(float(i))
            perclos_rel.append(p / perclos_thr)
        h = tick.get("heartRate")
        if _valid(h) and h > 0:
            hr_idx.append(float(i))
            hr.append(float(h))
        f = tick.get("faceConfidence")
        face.append(float(f) if _valid(f) else 0.0)
        fs = float(tick.get("fusionScore") or 0.0)
        fusion.append(fs)
        if fs > 0.4:
            nonalert += 1
        if fs > 0.7:
            drowsy += 1

    run_now = 0
    for flag in reversed(below_flags):
        if not flag:
            break
        run_now += 1
    longest = 0
    cur = 0
    for flag in below_flags:
        cur = cur + 1 if flag else 0
        longest = max(longest, cur)

    if ear_rel:
        ear_feats = [
            ear_rel[-1],
            _mean(ear_rel),
            min(ear_rel),
            _std(ear_rel),
            _slope(ear_idx, ear_rel),
            (
                _mean([abs(ear_rel[i] - ear_rel[i - 1]) for i in range(1, len(ear_rel))])
                if len(ear_rel) > 1
                else 0.0
            ),
            sum(1 for b in below_flags if b) / n,
        ]
    else:
        ear_feats = [1.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0]

    return [
        float(n),
        *ear_feats,
        float(run_now),
        float(longest),
        (n - len(ear_rel)) / n if n else 1.0,
        perclos_rel[-1] if perclos_rel else 0.0,
        _slope(perclos_idx, perclos_rel),
        len(hr) / n if n else 0.0,
        _mean(hr) if hr else 0.0,
        _slope(hr_idx, hr),
        _mean(face) if face else 0.0,
        min(face) if face else 0.0,
        fusion[-1] if fusion else 0.0,
        _mean(fusion) if fusion else 0.0,
        nonalert / n if n else 0.0,
        drowsy / n if n else 0.0,
    ]
