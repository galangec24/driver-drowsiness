"""Head-nod ("nodding off") detection from head pitch.

A drowsy nod is the head *falling* forward. It's fast and involuntary, and it ends either with
the eyes closed or with a quick jerk back up when the driver catches themselves. Looking down at
the console or a phone is slower, and the eyes stay open, so it is not counted.

Pitch convention (detectors/head_pose.py): head down = negative pitch. Everything is measured
relative to the driver's own neutral pitch (rolling median), so camera mounting angle doesn't matter.

A nod is counted when:
  1. pitch drops ≥ drop_deg below neutral, and
  2. the drop happened fast (≥ min_drop_speed °/s over the last ~0.5 s), and
  3. while down, the eyes were closed at some point, OR the head snapped back up fast
     (≥ min_recover_speed °/s) within max_down_s.
"""

from __future__ import annotations

import statistics
from collections import deque

NEUTRAL, FALLING_DOWN, LOOKING_DOWN = "neutral", "down", "looking"


class NodDetector:
    def __init__(
        self,
        drop_deg: float = 15.0,
        min_drop_speed: float = 25.0,
        min_recover_speed: float = 40.0,
        max_down_s: float = 4.0,
        neutral_window_s: float = 30.0,
        window_s: float = 300.0,
    ) -> None:
        self.drop_deg = drop_deg
        self.min_drop_speed = min_drop_speed
        self.min_recover_speed = min_recover_speed
        self.max_down_s = max_down_s
        self.neutral_window_s = neutral_window_s
        self.window_s = window_s
        self._pitch: deque[tuple[float, float]] = deque()  # (t, pitch) for the neutral estimate
        self._recent: deque[tuple[float, float]] = deque()  # last ~0.6 s, for speeds
        self._state = NEUTRAL
        self._down_at = 0.0
        self._eyes_closed_while_down = False
        self._events: deque[float] = deque()
        self.last_nod_at: float | None = None

    # ------------------------------------------------------------------ public
    @property
    def neutral(self) -> float | None:
        """The driver's usual head pitch, or None until ~2 s of samples."""
        if len(self._pitch) < 20:
            return None
        return statistics.median(p for _, p in self._pitch)

    @property
    def head_down(self) -> bool:
        return self._state == FALLING_DOWN

    def update(self, pitch: float | None, eyes_closed: bool, t: float) -> bool:
        """One analysed frame. Returns True on the frame a nod is counted."""
        self._expire(t)
        if pitch is None:  # face lost: start over (no guesses from missing data)
            self._state = NEUTRAL
            self._recent.clear()
            return False

        neutral = self.neutral
        self._recent.append((t, pitch))
        while self._recent and t - self._recent[0][0] > 0.6:
            self._recent.popleft()
        if neutral is None:
            self._remember(t, pitch)
            return False

        drop = neutral - pitch  # > 0 when the head is lower than usual
        fall_speed = -self._speed(0.5)  # °/s downward over the last half second

        if self._state == NEUTRAL:
            self._remember(t, pitch)
            if drop >= self.drop_deg:
                if fall_speed >= self.min_drop_speed:
                    self._state, self._down_at = FALLING_DOWN, t
                    self._eyes_closed_while_down = eyes_closed
                else:
                    self._state = LOOKING_DOWN  # deliberate, slow: ignore until back up
            return False

        if self._state == LOOKING_DOWN:
            if drop < self.drop_deg / 2:
                self._state = NEUTRAL
            return False

        # FALLING_DOWN
        self._eyes_closed_while_down |= eyes_closed
        if drop < self.drop_deg / 2:  # back up
            # A jerk back up is fast: measure over the last 0.3 s only, not across the dip.
            snapped = self._speed(0.3) >= self.min_recover_speed and t - self._down_at <= self.max_down_s
            self._state = NEUTRAL
            if self._eyes_closed_while_down or snapped:
                return self._count(t)
            return False
        if t - self._down_at > self.max_down_s:
            # Head stayed down: a nod only if the eyes closed (falling asleep), else looking down.
            self._state = LOOKING_DOWN
            if self._eyes_closed_while_down:
                return self._count(t)
        return False

    def count(self, t: float) -> int:
        """Nods in the last window_s seconds."""
        self._expire(t)
        return len(self._events)

    # ------------------------------------------------------------------ internals
    def _remember(self, t: float, pitch: float) -> None:
        # Only upright-ish samples feed the neutral estimate.
        self._pitch.append((t, pitch))
        while self._pitch and t - self._pitch[0][0] > self.neutral_window_s:
            self._pitch.popleft()

    def _speed(self, span_s: float) -> float:
        """Pitch change rate (°/s, + = up) over roughly the last span_s seconds."""
        if len(self._recent) < 2:
            return 0.0
        t1, p1 = self._recent[-1]
        t0, p0 = next(((t, p) for t, p in self._recent if t1 - t <= span_s + 1e-6), self._recent[0])
        return (p1 - p0) / (t1 - t0) if t1 > t0 else 0.0

    def _count(self, t: float) -> bool:
        self._events.append(t)
        self.last_nod_at = t
        return True

    def _expire(self, t: float) -> None:
        while self._events and t - self._events[0] > self.window_s:
            self._events.popleft()
