"""In-car alerting: decides when to vibrate the driver's watch.

Two paths, so the driver is warned even with no internet:

1. Local, every analysed frame (~10 Hz). Eyes closed continuously for the driver's own
   drowsyDurationMs (a microsleep), or a head nod → HIGH immediately. Thresholds are fetched
   from the backend and cached on the device.
2. Backend verdict, ~1 Hz. The full fusion (eyes + PERCLOS + heart rate + yawns + false-alarm
   verifier) answers every POST: drowsy → HIGH, warning → MILD.
   If the backend has not answered for `offline_after_s`, local PERCLOS ≥ perclosThreshold → HIGH.

Levels follow the BLE Alert Level characteristic: 0 none, 1 mild, 2 high.
A level is repeated at most every `repeat_s`; after `calm_s` with no reason to alert, sends 0 (stop).
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

NONE, MILD, HIGH = 0, 1, 2


@dataclass
class WatchAlerter:
    send: Callable[[int], None]
    repeat_s: float = 15.0
    calm_s: float = 10.0
    offline_after_s: float = 5.0
    drowsy_duration_s: float = 2.0
    perclos_threshold: float = 0.4
    _last_sent: dict[int, float] = field(default_factory=dict)
    _active: int = NONE
    _last_reason_at: float = 0.0
    _backend_at: float | None = None
    _backend_level: int = NONE
    last_reason: str = ""

    def apply_thresholds(self, t: dict[str, Any]) -> None:
        if isinstance(t.get("drowsyDurationMs"), int | float) and t["drowsyDurationMs"] > 0:
            self.drowsy_duration_s = t["drowsyDurationMs"] / 1000.0
        if isinstance(t.get("perclosThreshold"), int | float) and t["perclosThreshold"] > 0:
            self.perclos_threshold = float(t["perclosThreshold"])

    def on_backend(self, response: dict[str, Any], now: float) -> None:
        """Every ingest response: {classification, alertTriggered, ...}."""
        self._backend_at = now
        self._backend_level = {"drowsy": HIGH, "warning": MILD}.get(response.get("classification", ""), NONE)

    def on_frame(self, closed_for_s: float, perclos: float, now: float, nodded: bool = False) -> int:
        """Call per analysed frame. Returns the level in force (also sent to the watch when it changes)."""
        level, reason = NONE, ""
        if closed_for_s >= self.drowsy_duration_s:
            level, reason = HIGH, f"eyes closed {closed_for_s:.1f}s"
        elif nodded:
            level, reason = HIGH, "head nod"
        backend_fresh = self._backend_at is not None and now - self._backend_at <= self.offline_after_s
        if backend_fresh and self._backend_level > level:
            level, reason = self._backend_level, "backend"
        elif not backend_fresh and perclos >= self.perclos_threshold and HIGH > level:
            level, reason = HIGH, f"PERCLOS {perclos:.0%} (offline)"

        if level > NONE:
            self._last_reason_at = now
            last = self._last_sent.get(level)
            if level > self._active or last is None or now - last >= self.repeat_s:
                self._fire(level, now)
                self.last_reason = reason
        elif self._active > NONE and now - self._last_reason_at >= self.calm_s:
            self._fire(NONE, now)
        return self._active

    def _fire(self, level: int, now: float) -> None:
        self.send(level)
        self._last_sent[level] = now
        self._active = level
