"""In-car alerting: decides when to vibrate the driver's watch.

Two paths, so the driver is warned even with no internet:

1. Local, every analysed frame (~10 Hz). Eyes closed continuously for the driver's own
   drowsyDurationMs (a microsleep), or a head nod → HIGH immediately. Thresholds are fetched
   from the backend and cached on the device.
2. Backend verdict, ~1 Hz. The full fusion (eyes + PERCLOS + heart rate + yawns + false-alarm
   verifier) answers every POST: drowsy → HIGH, warning → MILD.
   If the backend has not answered for `offline_after_s`, local PERCLOS ≥ perclosThreshold → HIGH.
3. Fuzzy fatigue (fusion/fuzzy.py), every frame: combinations such as frequent blinking plus
   repeated yawning. > 0.7 → HIGH, > 0.4 → MILD, named by the strongest rule.

Levels follow the BLE Alert Level characteristic: 0 none, 1 mild, 2 high.
A level is repeated at most every `repeat_s`. It steps down as soon as its reason has been gone
for `calm_s` (HIGH → MILD if a milder reason is still there, else 0 = stop), so a driver who is
awake again is back to normal within a few seconds.
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
    calm_s: float = 3.0
    offline_after_s: float = 5.0
    drowsy_duration_s: float = 2.0
    perclos_threshold: float = 0.4
    _last_sent: dict[int, float] = field(default_factory=dict)
    _active: int = NONE
    _last_reason_at: float = 0.0
    _seen: dict[int, float] = field(default_factory=dict)  # level → last frame it had a reason
    _backend_at: float | None = None
    _backend_level: int = NONE
    last_reason: str = ""
    # Why the current frame is (or isn't) alarming, for the on-screen status (updated every frame).
    reason_now: str = ""

    @property
    def level(self) -> int:
        """In-car alert level in force now (NONE / MILD / HIGH)."""
        return self._active

    def apply_thresholds(self, t: dict[str, Any]) -> None:
        if isinstance(t.get("drowsyDurationMs"), int | float) and t["drowsyDurationMs"] > 0:
            self.drowsy_duration_s = t["drowsyDurationMs"] / 1000.0
        if isinstance(t.get("perclosThreshold"), int | float) and t["perclosThreshold"] > 0:
            self.perclos_threshold = float(t["perclosThreshold"])

    def on_backend(self, response: dict[str, Any], now: float) -> None:
        """Every ingest response: {classification, alertTriggered, ...}."""
        self._backend_at = now
        self._backend_level = {"drowsy": HIGH, "warning": MILD}.get(response.get("classification", ""), NONE)

    def on_frame(
        self,
        closed_for_s: float,
        perclos: float,
        now: float,
        nodded: bool = False,
        away_for_s: float = 0.0,
        restless: bool = False,
        away_s: float = 2.0,
        away_long_s: float = 5.0,
        fatigue: float = 0.0,
        fatigue_reason: str = "",
    ) -> int:
        """Call per analysed frame. Returns the level in force (also sent to the watch when it changes)."""
        level, reason = NONE, ""
        if closed_for_s >= self.drowsy_duration_s:
            level, reason = HIGH, f"eyes closed {closed_for_s:.1f}s"
        elif nodded:
            level, reason = HIGH, "head nod"
        elif away_for_s >= away_long_s:
            level, reason = HIGH, f"eyes off the road {away_for_s:.0f}s"
        elif away_for_s >= away_s:
            level, reason = MILD, "eyes off the road"
        elif restless:
            level, reason = MILD, "restless: too much movement"
        fuzzy_level = HIGH if fatigue > 0.7 else MILD if fatigue > 0.4 else NONE
        if fuzzy_level > level:
            level, reason = fuzzy_level, f"fatigue: {fatigue_reason or 'several signs'}"
        backend_fresh = self._backend_at is not None and now - self._backend_at <= self.offline_after_s
        if backend_fresh and self._backend_level > level:
            level, reason = self._backend_level, "backend"
        elif not backend_fresh and perclos >= self.perclos_threshold and HIGH > level:
            level, reason = HIGH, f"PERCLOS {perclos:.0%} (offline)"

        self.reason_now = reason
        if level > NONE:
            self._last_reason_at = now
            self._seen[level] = now
        # Highest level whose reason was present within calm_s.
        held = max((lv for lv in (HIGH, MILD) if now - self._seen.get(lv, -1e9) < self.calm_s), default=NONE)
        if level > self._active:
            self._fire(level, now)
            self.last_reason = reason
        elif held < self._active:
            self._fire(held, now)  # step down: DROWSY → WARNING → normal
        elif level > NONE and level == self._active:
            last = self._last_sent.get(level)
            if last is None or now - last >= self.repeat_s:
                self._fire(level, now)
                self.last_reason = reason
        return self._active

    def _fire(self, level: int, now: float) -> None:
        self.send(level)
        self._last_sent[level] = now
        self._active = level
