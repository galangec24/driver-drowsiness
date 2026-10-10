"""Replica of the backend alert decision path, for offline evaluation.

Mirrors backend/src/services/alertGate.js + ingestService.js:
  fusion → (non-'alert' classification) → persistence gate (driver's drowsyDurationMs)
         → verifier (probability >= threshold, once >= MIN_TICKS of history) → per-type cooldown
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any

from guardian_ml.features import MIN_TICKS, WINDOW, compute_features
from guardian_ml.fusion import compute_drowsiness_score, resolve_thresholds, round4

COOLDOWN_S = 15.0
GAP_TOLERANCE = 1  # ticks

Verifier = Callable[[list[float]], float]


def alert_type(
    classification: str, ear: float | None, perclos: float | None, t: dict[str, float]
) -> str | None:
    if classification == "warning":
        return "warning"
    if classification != "drowsy":
        return None
    deep = (
        ear is not None
        and ear < t["earThreshold"] * 0.5
        and perclos is not None
        and perclos >= t["perclosThreshold"]
    )
    return "microsleep" if deep else "drowsy"


@dataclass
class TickDecision:
    t: float
    fusion: float
    classification: str
    kind: str | None  # alert type this tick would raise
    eligible: bool  # candidate (non-'alert') that passed the persistence gate (if enabled)
    verifier_score: float | None  # None = verifier abstained (< MIN_TICKS history) or disabled
    features: list[float] | None
    alert: str | None = None


@dataclass
class SessionRun:
    decisions: list[TickDecision] = field(default_factory=list)


def score_ticks(
    ticks: Sequence[dict[str, Any]],
    thresholds: dict[str, Any],
    persistence: bool,
    verifier: Verifier | None,
) -> SessionRun:
    """Fusion + gate + verifier score for every tick (independent of the alert threshold)."""
    t = resolve_thresholds(thresholds)
    buf: list[dict[str, Any]] = []
    run_start: float | None = None
    gap = 0
    out = SessionRun()
    for tick in ticks:
        fusion, cls = compute_drowsiness_score(tick, t)
        fusion = round4(fusion)
        buf.append({**tick, "fusionScore": fusion})
        if len(buf) > WINDOW:
            buf.pop(0)
        candidate = cls != "alert"
        if candidate:
            run_start = tick["t"] if run_start is None else run_start
            gap = 0
        else:
            gap += 1
            if gap > GAP_TOLERANCE:  # a single 'alert' tick inside a drowsy run doesn't reset it
                run_start = None
        eligible = candidate and (not persistence or (tick["t"] - run_start) * 1000 >= t["drowsyDurationMs"])
        feats = compute_features(buf, t) if eligible and len(buf) >= MIN_TICKS else None
        score = verifier(feats) if (verifier is not None and feats is not None) else None
        kind = alert_type(cls, tick.get("ear"), tick.get("perclos"), t)
        out.decisions.append(TickDecision(tick["t"], fusion, cls, kind, eligible, score, feats))
    return out


def fire_alerts(run: SessionRun, threshold: float) -> SessionRun:
    """Apply verifier threshold + per-type cooldown (sets decision.alert in place)."""
    last: dict[str, float] = {}
    for d in run.decisions:
        d.alert = None
        allowed = d.eligible and (d.verifier_score is None or d.verifier_score >= threshold)
        if allowed and d.kind and d.t - last.get(d.kind, -1e9) >= COOLDOWN_S:
            last[d.kind] = d.t
            d.alert = d.kind
    return run


def run_session(
    ticks: Sequence[dict[str, Any]],
    thresholds: dict[str, Any],
    persistence: bool = False,
    verifier: Verifier | None = None,
    threshold: float = 0.5,
) -> SessionRun:
    return fire_alerts(score_ticks(ticks, thresholds, persistence, verifier), threshold)


# ---------------------------------------------------------------- event-level metrics


@dataclass
class Metrics:
    false_alerts: int = 0
    negative_hours: float = 0.0
    episodes: int = 0
    detected: int = 0
    latencies: list[float] = field(default_factory=list)
    fp_by_state: dict[str, int] = field(default_factory=dict)

    @property
    def false_alerts_per_hour(self) -> float:
        return self.false_alerts / self.negative_hours if self.negative_hours else 0.0

    @property
    def recall(self) -> float:
        return self.detected / self.episodes if self.episodes else 0.0

    @property
    def median_latency(self) -> float:
        xs = sorted(self.latencies)
        return xs[len(xs) // 2] if xs else float("nan")

    def merge(self, o: Metrics) -> None:
        self.false_alerts += o.false_alerts
        self.negative_hours += o.negative_hours
        self.episodes += o.episodes
        self.detected += o.detected
        self.latencies += o.latencies
        for k, v in o.fp_by_state.items():
            self.fp_by_state[k] = self.fp_by_state.get(k, 0) + v

    def summary(self) -> dict[str, Any]:
        return {
            "false_alerts": self.false_alerts,
            "false_alerts_per_hour": round(self.false_alerts_per_hour, 3),
            "negative_hours": round(self.negative_hours, 2),
            "episodes": self.episodes,
            "episode_recall": round(self.recall, 4),
            "median_detection_latency_s": round(self.median_latency, 1),
            "false_alerts_by_state": dict(sorted(self.fp_by_state.items(), key=lambda kv: -kv[1])),
        }


def score_session(ticks: Sequence[dict[str, Any]], run: SessionRun) -> Metrics:
    """Drowsy episode = maximal run of label==1 ticks. An alert during label 0 is a false alert;
    alerts during label -1 (early onset) are neither. An alert in the early-onset lead-in counts as
    (early) detection of the following episode."""
    m = Metrics()
    m.negative_hours = sum(1 for x in ticks if x["label"] == 0) / 3600.0
    alerts = [(d.t, ticks[i]) for i, d in enumerate(run.decisions) if d.alert]
    for _, tick in alerts:
        if tick["label"] == 0:
            m.false_alerts += 1
            m.fp_by_state[tick["state"]] = m.fp_by_state.get(tick["state"], 0) + 1

    i = 0
    n = len(ticks)
    while i < n:
        if ticks[i]["label"] != 1:
            i += 1
            continue
        j = i
        while j < n and ticks[j]["label"] == 1:
            j += 1
        lead = i
        while lead > 0 and ticks[lead - 1]["label"] == -1:
            lead -= 1
        start_t, lead_t, end_t = ticks[i]["t"], ticks[lead]["t"], ticks[j - 1]["t"]
        hits = [t for t, _ in alerts if lead_t <= t <= end_t]
        m.episodes += 1
        if hits:
            m.detected += 1
            m.latencies.append(max(0.0, hits[0] - start_t))
        i = j
    return m
