"""Blinks: how often the driver blinks, and how many blinks are slow ("long blinks").

Built on the per-frame open/closed decision of detectors/perclos.py (relative to the driver's own
open eyes, with hysteresis), so it works for narrow eyes too.

Real-world time spans: a burst of blinking (dust, talking, bright light) is normal, so the
blink rate is the average over 3 minutes and needs 2 minutes actually watched; slow blinks are
counted over 2 minutes.

- Blink: eyes closed < `long_s` (normally 0.1-0.4 s).
- Long blink: closed `long_s` .. `microsleep_s` (0.5-2 s). Slow, heavy blinks are one of the
  earliest signs of fatigue, well before PERCLOS rises.
- Longer closures are microsleeps (perclos.closed_for), not blinks.

Frames where the eyes can't be judged (no face, face turning back, head turned away) are passed
as None: a closure interrupted by them is discarded, and they don't count as observed time, so the
blink rate is "per minute actually watched".
"""

from __future__ import annotations

from collections import deque


class BlinkDetector:
    def __init__(
        self,
        long_s: float = 0.5,
        microsleep_s: float = 2.0,
        window_s: float = 180.0,
        min_observed_s: float = 120.0,
        long_window_s: float = 120.0,
        max_gap_s: float = 0.5,
    ) -> None:
        self.long_s = long_s
        self.microsleep_s = microsleep_s
        self.window_s = window_s
        self.min_observed_s = min_observed_s
        self.long_window_s = long_window_s
        self.max_gap_s = max_gap_s
        self._closed_at: float | None = None
        self._last_t: float | None = None
        self._observed: deque[tuple[float, float]] = deque()  # (t, seconds watched since last)
        self._blinks: deque[float] = deque()
        self._long: deque[float] = deque()

    def update(self, closed: bool | None, t: float) -> None:
        if closed is None:
            self._closed_at = None  # interrupted: unknown whether it was a blink
            self._last_t = None
            self._expire(t)
            return
        if self._last_t is not None:
            self._observed.append((t, min(t - self._last_t, self.max_gap_s)))
        self._last_t = t
        if closed:
            if self._closed_at is None:
                self._closed_at = t
        elif self._closed_at is not None:
            dur = t - self._closed_at
            self._closed_at = None
            if dur < self.long_s:
                self._blinks.append(t)
            elif dur < self.microsleep_s:
                self._long.append(t)
        self._expire(t)

    def observed_s(self) -> float:
        return sum(s for _, s in self._observed)

    def rate(self, t: float) -> float | None:
        """Blinks (normal + long) per minute watched, or None until `min_observed_s` of data."""
        self._expire(t)
        watched = self.observed_s()
        if watched < self.min_observed_s:
            return None
        return (len(self._blinks) + len(self._long)) * 60.0 / watched

    def long_blinks(self, t: float) -> int:
        """Slow blinks in the last `long_window_s` seconds (2 minutes)."""
        self._expire(t)
        return sum(1 for e in self._long if t - e <= self.long_window_s)

    def _expire(self, t: float) -> None:
        for q in (self._blinks, self._long):
            while q and t - q[0] > self.window_s:
                q.popleft()
        while self._observed and t - self._observed[0][0] > self.window_s:
            self._observed.popleft()
