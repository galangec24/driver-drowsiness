"""Synthetic driving-session generator with realistic false-positive confounders.

Eyelid openness is simulated at 10 Hz (driver_monitor analyses every 3rd frame of a 30 fps camera),
then aggregated to 1 Hz ticks exactly like driver_monitor/main.py sends them:
  ear       = mean EAR of frames where a face was found (omitted when none)
  perclos   = 30 s rolling fraction of frames with EAR < 0.7 x the driver's open-eye baseline
              (90th percentile of the last 120 s) — the PerclosTracker algorithm
  faceConfidence = mean detector score (0 for frames without a face)
  heartRate = 0 when the driver has no HR sensor

Labels per tick:  1 = drowsy (drowsiness level >= 0.5, or microsleep)
                  0 = not drowsy (alert or any confounder)
                 -1 = early onset (level 0.25-0.5): ignored for training and false-alarm counting

This is a modelled dataset: it encodes published characteristics of drowsiness (longer/slower blinks,
rising PERCLOS, microsleeps, heart-rate decline) and of common false-alarm situations. It is for
building and validating the pipeline — real-world accuracy must be measured on real recordings.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

import numpy as np

FPS = 10
PERCLOS_WINDOW_S = 30
BASELINE_WINDOW_S = 120
CLOSURE_RATIO = 0.7

CONFOUNDERS = [
    "talking",
    "laughing",
    "mirror_check",
    "phone_glance",
    "sun_squint",
    "glare",
    "occlusion",
    "heavy_blinker",
    "eye_rub_sneeze",
]


@dataclass
class DriverProfile:
    driver_id: str
    ear_open: float
    ear_closed: float
    noise: float
    blink_rate: float  # per minute when alert
    hr_rest: float
    hr_sensor: bool
    athlete: bool
    expressivity: float  # how strongly drowsiness shows on the face (subtle drivers are hard)
    glasses: bool  # persistent reflections: noisier landmarks, lower detector confidence
    thresholds: dict[str, float] = field(default_factory=dict)


@dataclass(frozen=True)
class Shift:
    """Generator settings; Shift.stress() is a deliberately different population for robustness tests."""

    expressivity: tuple[float, float] = (0.35, 1.0)
    glasses_p: float = 0.25
    noise_mult: float = 1.0
    confounder_p: float = 0.55

    @staticmethod
    def stress() -> Shift:
        return Shift(expressivity=(0.2, 0.7), glasses_p=0.5, noise_mult=1.5, confounder_p=0.7)


def make_driver(rng: np.random.Generator, idx: int, shift: Shift | None = None) -> DriverProfile:
    shift = shift or Shift()
    ear_open = float(np.clip(rng.normal(0.29, 0.035), 0.20, 0.38))
    athlete = bool(rng.random() < 0.12)
    hr_rest = float(np.clip(rng.normal(52, 3), 44, 58) if athlete else np.clip(rng.normal(72, 8), 55, 95))
    tuned = rng.random() < 0.6  # 40 % are new drivers still on default thresholds
    ear_thr = float(np.clip(0.75 * ear_open + rng.normal(0, 0.01), 0.12, 0.35)) if tuned else 0.21
    wv = 0.6 if rng.random() < 0.85 else float(rng.uniform(0.5, 0.8))
    return DriverProfile(
        driver_id=f"drv{idx:04d}",
        ear_open=ear_open,
        ear_closed=float(rng.uniform(0.04, 0.08)),
        noise=float(rng.uniform(0.006, 0.018)) * shift.noise_mult,
        blink_rate=float(rng.uniform(12, 20)),
        hr_rest=hr_rest,
        hr_sensor=bool(rng.random() < 0.7),
        athlete=athlete,
        expressivity=float(rng.uniform(*shift.expressivity)),
        glasses=bool(rng.random() < shift.glasses_p),
        thresholds={
            "earThreshold": round(ear_thr, 3),
            "perclosThreshold": (0.4 if rng.random() < 0.8 else round(float(rng.uniform(0.3, 0.55)), 2)),
            "drowsyDurationMs": 2000,
            "fusionWeightVision": round(wv, 2),
            "fusionWeightPhysio": round(1 - wv, 2),
        },
    )


# ---------------------------------------------------------------- frame-level segment builders


@dataclass
class Frames:
    """Per-frame arrays for one segment (len = seconds * FPS) + per-second extras."""

    openness: np.ndarray  # 0 closed .. 1 open (apparent, includes head-pose effects)
    face: np.ndarray  # bool: face detected
    conf: np.ndarray  # detector score where detected
    noise_mult: np.ndarray
    level: np.ndarray  # drowsiness level 0..1 per frame
    micro: np.ndarray  # bool: in a microsleep
    hr_offset: np.ndarray  # per-second bpm offset from rest
    state: str


def _blinks(
    rng: np.random.Generator,
    o: np.ndarray,
    rate_per_min: float,
    dur_lo: float,
    dur_hi: float,
) -> None:
    """Overlay blinks (triangular closure profile) in-place."""
    n = len(o)
    t = 0.0
    while True:
        t += rng.exponential(60.0 / max(rate_per_min, 1e-3))
        start = int(t * FPS)
        if start >= n:
            return
        dur = max(1, int(round(rng.uniform(dur_lo, dur_hi) * FPS)))
        for k in range(dur):
            i = start + k
            if i >= n:
                break
            frac = k / (dur - 1) if dur > 1 else 0.5
            closure = 1 - abs(2 * frac - 1)  # 0 → 1 (fully shut mid-blink) → 0
            o[i] = min(o[i], 1 - 0.95 * closure)


def _base(rng: np.random.Generator, seconds: int, state: str, conf_mu: float = 0.95) -> Frames:
    n = seconds * FPS
    return Frames(
        openness=np.clip(1 + rng.normal(0, 0.02, n), 0.85, 1.0),
        face=np.ones(n, dtype=bool),
        conf=np.clip(rng.normal(conf_mu, 0.02, n), 0.5, 0.995),
        noise_mult=np.ones(n),
        level=np.zeros(n),
        micro=np.zeros(n, dtype=bool),
        hr_offset=np.zeros(seconds),
        state=state,
    )


def _episodes(
    rng: np.random.Generator,
    n: int,
    every: tuple[float, float],
    dur: tuple[float, float],
) -> list[slice]:
    out, t = [], rng.uniform(*every)
    while int(t * FPS) < n:
        d = rng.uniform(*dur)
        out.append(slice(int(t * FPS), min(n, int((t + d) * FPS))))
        t += d + rng.uniform(*every)
    return out


def seg_alert(rng: np.random.Generator, d: DriverProfile, seconds: int) -> Frames:
    f = _base(rng, seconds, "alert")
    _blinks(rng, f.openness, d.blink_rate, 0.1, 0.3)
    f.hr_offset[:] = rng.normal(0, 1.0)
    return f


def seg_confounder(rng: np.random.Generator, d: DriverProfile, seconds: int, kind: str) -> Frames:
    f = _base(rng, seconds, kind)
    n = len(f.openness)
    tt = np.arange(n) / FPS
    if kind == "talking":
        freq = rng.uniform(2, 4)
        f.openness = np.clip(
            1 - 0.25 * np.abs(np.sin(2 * np.pi * freq * tt)) + rng.normal(0, 0.04, n),
            0.5,
            1,
        )
        f.conf = np.clip(rng.normal(0.9, 0.04, n), 0.5, 0.99)
        _blinks(rng, f.openness, d.blink_rate * 1.4, 0.1, 0.3)
        f.hr_offset[:] = rng.uniform(2, 6)
    elif kind == "laughing":
        _blinks(rng, f.openness, d.blink_rate, 0.1, 0.3)
        for s in _episodes(rng, n, (3, 8), (1, 2.5)):
            f.openness[s] = rng.uniform(0.25, 0.5) + rng.normal(0, 0.05, s.stop - s.start)
        f.hr_offset[:] = rng.uniform(4, 10)
    elif kind == "mirror_check":
        _blinks(rng, f.openness, d.blink_rate, 0.1, 0.3)
        for s in _episodes(rng, n, (5, 15), (0.8, 2.5)):
            f.openness[s] = rng.uniform(0.45, 0.65)
            f.conf[s] = rng.uniform(0.6, 0.85)
    elif kind == "phone_glance":
        _blinks(rng, f.openness, d.blink_rate, 0.1, 0.3)
        for s in _episodes(rng, n, (6, 20), (2, 10)):
            f.openness[s] = rng.uniform(0.08, 0.4)  # looking down: lids appear nearly closed
            f.conf[s] = rng.uniform(0.5, 0.8)
            f.face[s] = rng.random(s.stop - s.start) > 0.2
    elif kind == "sun_squint":
        f.openness = np.clip(rng.uniform(0.55, 0.72) + rng.normal(0, 0.03, n), 0.4, 0.85)
        _blinks(rng, f.openness, d.blink_rate, 0.1, 0.3)
    elif kind == "glare":
        _blinks(rng, f.openness, d.blink_rate, 0.1, 0.3)
        f.noise_mult[:] = 3.0
        f.conf = np.clip(rng.normal(0.55, 0.08, n), 0.3, 0.8)
        f.face = rng.random(n) > 0.1
    elif kind == "heavy_blinker":  # dry eyes / contact lenses: frequent, longer, partial blinks
        _blinks(rng, f.openness, rng.uniform(28, 40), 0.15, 0.5)
        f.openness = np.clip(f.openness * rng.uniform(0.85, 0.95), 0.03, 1)
    elif kind == "eye_rub_sneeze":  # genuine 1-2 s closures that are not drowsiness
        _blinks(rng, f.openness, d.blink_rate, 0.1, 0.3)
        for s in _episodes(rng, n, (15, 50), (0.8, 2.0)):
            f.openness[s] = rng.uniform(0.03, 0.15)
            if rng.random() < 0.6:  # hand in front of the face
                f.conf[s] = rng.uniform(0.4, 0.7)
    elif kind == "occlusion":
        _blinks(rng, f.openness, d.blink_rate, 0.1, 0.3)
        for s in _episodes(rng, n, (4, 12), (1, 5)):
            f.face[s] = False
        f.noise_mult[:] = 1.5
    else:
        raise ValueError(kind)
    return f


def seg_drowsy(
    rng: np.random.Generator,
    d: DriverProfile,
    seconds: int,
    start_level: float,
    end_level: float,
) -> Frames:
    """Progressive drowsiness: slower/longer blinks, drooping lids, long closures, microsleeps at the peak."""
    f = _base(rng, seconds, "drowsy")
    n = len(f.openness)
    level = np.linspace(start_level, end_level, n)
    f.level = level
    ex = d.expressivity
    f.openness = np.clip(1 - 0.32 * ex * level + rng.normal(0, 0.03, n), 0.3, 1)
    t = 0.0
    while True:
        lv = float(level[min(n - 1, int(t * FPS))])
        t += rng.exponential(60.0 / (d.blink_rate + 12 * lv))
        i0 = int(t * FPS)
        if i0 >= n:
            break
        lv = float(level[i0])
        long_closure = rng.random() < 0.25 * ex * max(0.0, lv - 0.4)
        micro = lv > 0.8 and rng.random() < 0.12 * ex
        if micro:
            dur = rng.uniform(1.5, 6)
        elif long_closure:
            dur = rng.uniform(0.8, 2.5)
        else:
            dur = rng.uniform(0.15 + 0.6 * ex * lv, 0.35 + 1.0 * ex * lv)
        i1 = min(n, i0 + max(1, int(dur * FPS)))
        f.openness[i0:i1] = np.minimum(f.openness[i0:i1], rng.uniform(0.02, 0.12))
        if micro:
            f.micro[i0:i1] = True
            if rng.random() < 0.5:  # head nod during microsleep
                f.conf[i0:i1] = rng.uniform(0.55, 0.8)
    f.hr_offset = -rng.uniform(2, 10) * ex * level[::FPS][:seconds]
    if rng.random() < 0.3:  # talking / singing along to stay awake
        tt = np.arange(n) / FPS
        f.openness = np.minimum(f.openness, 1 - 0.2 * np.abs(np.sin(2 * np.pi * rng.uniform(2, 4) * tt)))
        f.hr_offset += rng.uniform(1, 4)
    f.state = "drowsy"
    return f


# ---------------------------------------------------------------- session composition


def compose_session(
    rng: np.random.Generator, d: DriverProfile, minutes: float, drowsy: bool, confounder_p: float = 0.55
) -> list[Frames]:
    total = int(minutes * 60)
    segs: list[Frames] = [seg_alert(rng, d, int(rng.uniform(120, 300)))]
    used = len(segs[0].hr_offset)
    drowsy_at = int(rng.uniform(300, max(301, total - 900))) if drowsy else None
    while used < total:
        if drowsy_at is not None and used >= drowsy_at:
            ramp = int(rng.uniform(240, 600))
            peak = int(rng.uniform(60, 180))
            segs.append(seg_drowsy(rng, d, ramp, 0.0, 0.85))
            segs.append(seg_drowsy(rng, d, peak, 0.85, 1.0))
            used += ramp + peak
            drowsy_at = None
            if rng.random() < 0.5:  # rest stop, then alert again
                segs.append(seg_alert(rng, d, int(rng.uniform(120, 300))))
                used += len(segs[-1].hr_offset)
            continue
        if rng.random() < confounder_p:
            kind = str(rng.choice(CONFOUNDERS))
            secs = int(rng.uniform(60, 360) if kind == "sun_squint" else rng.uniform(30, 180))
            segs.append(seg_confounder(rng, d, secs, kind))
        else:
            segs.append(seg_alert(rng, d, int(rng.uniform(60, 240))))
        used += len(segs[-1].hr_offset)
    return segs


def aggregate(
    rng: np.random.Generator, d: DriverProfile, segs: list[Frames], session_id: str
) -> list[dict[str, Any]]:
    """Frames → 1 Hz ticks, mirroring driver_monitor's per-interval payload."""
    openness = np.concatenate([s.openness for s in segs])
    face = np.concatenate([s.face for s in segs])
    conf = np.concatenate([s.conf for s in segs])
    noise_mult = np.concatenate([s.noise_mult for s in segs])
    level = np.concatenate([s.level for s in segs])
    micro = np.concatenate([s.micro for s in segs])
    hr_off = np.concatenate([s.hr_offset for s in segs])
    states = np.concatenate([np.full(len(s.hr_offset), s.state) for s in segs])

    if d.glasses:
        noise_mult = noise_mult * rng.uniform(1.5, 2.5)
        conf = np.clip(conf - rng.uniform(0.05, 0.2), 0.3, 1)
    ear = (
        d.ear_closed
        + (d.ear_open - d.ear_closed) * openness
        + rng.normal(0, d.noise, len(openness)) * noise_mult
    )
    ear = np.clip(ear, 0.0, 0.5)

    seconds = len(hr_off)
    hr_walk = np.cumsum(rng.normal(0, 0.3, seconds))
    hr_walk -= np.linspace(0, hr_walk[-1], seconds)  # keep the random walk bounded
    hr = d.hr_rest + hr_off + hr_walk + rng.normal(0, 1.2, seconds)

    rows: list[dict[str, Any]] = []
    base_hist: list[np.ndarray] = []
    closed_hist: list[tuple[int, int]] = []
    for sec in range(seconds):
        fs = slice(sec * FPS, (sec + 1) * FPS)
        present = face[fs]
        e = ear[fs][present]
        # baseline = 90th percentile of the last 120 s of observed EAR (needs >= 15 samples)
        base_hist.append(e)
        if len(base_hist) > BASELINE_WINDOW_S:
            base_hist.pop(0)
        pool = np.concatenate(base_hist)
        baseline = float(np.percentile(pool, 90)) if len(pool) >= 15 else None
        closed = int(np.sum(e < baseline * CLOSURE_RATIO)) if baseline is not None else 0
        closed_hist.append((closed, len(e)))
        if len(closed_hist) > PERCLOS_WINDOW_S:
            closed_hist.pop(0)
        tot = sum(c for _, c in closed_hist)
        perclos = sum(c for c, _ in closed_hist) / tot if tot else 0.0

        lv = float(level[fs].mean())
        is_micro = bool(micro[fs].any())
        label = 1 if (lv >= 0.5 or is_micro) else (-1 if lv >= 0.25 else 0)
        rows.append(
            {
                "driver_id": d.driver_id,
                "session_id": session_id,
                "t": float(sec),
                "ear": round(float(e.mean()), 3) if len(e) else None,
                "perclos": round(perclos, 3) if len(e) else None,
                "heartRate": round(float(hr[sec])) if d.hr_sensor else 0,
                "faceConfidence": round(float(np.where(present, conf[fs], 0.0).mean()), 3),
                "label": label,
                "state": "microsleep" if is_micro else str(states[sec]),
                "level": round(lv, 3),
            }
        )
    return rows


def generate(
    n_drivers: int, sessions_per_driver: int, minutes: float, seed: int, shift: Shift | None = None
) -> tuple[list[dict], list[dict]]:
    """Returns (drivers as dicts, tick rows)."""
    rng = np.random.default_rng(seed)
    drivers, rows = [], []
    for i in range(n_drivers):
        d = make_driver(rng, i, shift)
        drivers.append(asdict(d))
        for s in range(sessions_per_driver):
            drowsy = rng.random() < 0.55
            segs = compose_session(rng, d, minutes, drowsy, (shift or Shift()).confounder_p)
            rows.extend(aggregate(rng, d, segs, f"{d.driver_id}_s{s}"))
    return drivers, rows
