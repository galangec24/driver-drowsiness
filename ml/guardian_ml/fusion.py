"""Exact port of backend/src/services/fusionEngine.js (parity-tested against the JS)."""

from __future__ import annotations

import math
from typing import Any

DEFAULT_THRESHOLDS: dict[str, float] = {
    "earThreshold": 0.21,
    "perclosThreshold": 0.4,
    "drowsyDurationMs": 2000,
    "fusionWeightVision": 0.6,
    "fusionWeightPhysio": 0.4,
    "yawnThreshold": 3,
    "fusionWeightYawn": 0.2,
    "hrDropThreshold": 0.15,
    "breathDropThreshold": 0.2,
    "nodThreshold": 2,
    "fusionWeightNod": 0.3,
}
DROWSY_BAND = 0.7
WARNING_BAND = 0.4
HRV_RISE_FULL = 0.5


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _num(v: Any) -> float | None:
    if isinstance(v, bool) or not isinstance(v, int | float):
        return None
    return float(v) if math.isfinite(v) else None


def resolve_thresholds(thresholds: dict[str, Any] | None) -> dict[str, float]:
    t = thresholds or {}
    out = {}
    for key, default in DEFAULT_THRESHOLDS.items():
        v = _num(t.get(key))
        out[key] = v if v is not None and v > 0 else default
    return out


def classify(score: float) -> str:
    if score > DROWSY_BAND:
        return "drowsy"
    if score > WARNING_BAND:
        return "warning"
    return "alert"


def _pair(a: Any, b: Any) -> tuple[float, float] | None:
    x, y = _num(a), _num(b)
    return (x, y) if x is not None and x > 0 and y is not None and y > 0 else None


def _relative_physio(hr: float | None, s: dict[str, Any], t: dict[str, float]) -> float:
    """Weighted mean of HR drop (0.7), HRV rise (0.3) and breathing slow-down (0.4), when available."""
    parts: list[tuple[float, float]] = []
    hr_pair = _pair(hr, s.get("hrBaseline"))
    if hr_pair:
        parts.append((0.7, _clamp((hr_pair[1] - hr_pair[0]) / hr_pair[1] / t["hrDropThreshold"], 0, 1)))
        hrv = _pair(s.get("hrv"), s.get("hrvBaseline"))
        if hrv:
            parts.append((0.3, _clamp((hrv[0] / hrv[1] - 1) / HRV_RISE_FULL, 0, 1)))
    br = _pair(s.get("breathingRate"), s.get("breathingBaseline"))
    if br:
        parts.append((0.4, _clamp((br[1] - br[0]) / br[1] / t["breathDropThreshold"], 0, 1)))
    if not parts:
        return 0.0
    return sum(w * v for w, v in parts) / sum(w for w, _ in parts)


def compute_drowsiness_score(signals: dict[str, Any], thresholds: dict[str, Any] | None) -> tuple[float, str]:
    """Returns (fusionScore, classification) exactly like the backend (incl. wearable, yawn and nod terms)."""
    t = resolve_thresholds(thresholds)
    s = signals or {}
    ear, perclos, hr, yawns = (
        _num(s.get("ear")),
        _num(s.get("perclos")),
        _num(s.get("heartRate")),
        _num(s.get("yawnCount")),
    )
    nods = _num(s.get("nodCount"))
    vision = 0.0 if ear is None else _clamp((t["earThreshold"] - ear) / t["earThreshold"], 0, 1)
    perclos_score = 0.0 if perclos is None else _clamp(perclos / t["perclosThreshold"], 0, 1)
    physio_abs = _clamp((60 - hr) / 15, 0, 1) if hr is not None and 0 < hr < 60 else 0.0
    physio = max(physio_abs, _relative_physio(hr, s, t))
    yawn = 0.0 if yawns is None else _clamp(yawns / t["yawnThreshold"], 0, 1)
    nod = 0.0 if nods is None else _clamp(nods / t["nodThreshold"], 0, 1)
    fused = _clamp(
        t["fusionWeightVision"] * (0.6 * vision + 0.4 * perclos_score)
        + t["fusionWeightPhysio"] * physio
        + t["fusionWeightYawn"] * yawn
        + t["fusionWeightNod"] * nod,
        0,
        1,
    )
    label = classify(fused)
    if label != "drowsy" and nods is not None and nods >= t["nodThreshold"]:
        label = "drowsy"
    if label == "alert" and yawns is not None and yawns >= t["yawnThreshold"]:
        label = "warning"
    return fused, label


def round4(v: float) -> float:
    """Backend rounds fusionScore to 4 decimals (Math.round(v*1e4)/1e4) before storing/emitting."""
    return math.floor(v * 10000 + 0.5) / 10000
