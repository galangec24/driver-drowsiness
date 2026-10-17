"""Yawn detection from FaceMesh mouth landmarks.

MAR (mouth aspect ratio) = mean of three inner-lip vertical gaps / mouth width.
Closed mouth ≈ 0.0–0.1, talking ≈ 0.1–0.4, yawning ≈ 0.6–1.0.

A yawn is the mouth staying wide open (MAR ≥ open_threshold) for at least min_duration_s.
Talking and laughing open the mouth only briefly, so the duration rule filters them out.
Hysteresis (close_threshold < open_threshold) keeps one long yawn from counting twice.
"""

from __future__ import annotations

import math
from collections import deque
from collections.abc import Sequence

# Inner-lip pairs (upper, lower) and the mouth corners, MediaPipe FaceMesh indices.
VERTICAL_PAIRS = ((82, 87), (13, 14), (312, 317))
CORNERS = (78, 308)


def _dist(a: Sequence[float], b: Sequence[float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def mouth_aspect_ratio(landmarks: Sequence[Sequence[float]]) -> float:
    width = _dist(landmarks[CORNERS[0]], landmarks[CORNERS[1]])
    if width <= 1e-6:
        return 0.0
    gaps = [_dist(landmarks[u], landmarks[lo]) for u, lo in VERTICAL_PAIRS]
    return sum(gaps) / (len(gaps) * width)


class YawnDetector:
    def __init__(
        self,
        open_threshold: float = 0.5,
        close_threshold: float = 0.35,
        min_duration_s: float = 1.5,
        # Yawning is judged over 10 minutes: one yawn is normal, 3+ in 10 min is fatigue.
        window_s: float = 600.0,
    ) -> None:
        if close_threshold >= open_threshold:
            raise ValueError("close_threshold must be below open_threshold")
        self.open_threshold = open_threshold
        self.close_threshold = close_threshold
        self.min_duration_s = min_duration_s
        self.window_s = window_s
        self._opened_at: float | None = None
        self._counted = False
        self._events: deque[float] = deque()

    @property
    def yawning(self) -> bool:
        """True while the current mouth opening has already qualified as a yawn."""
        return self._counted

    def update(self, mar: float | None, t: float) -> bool:
        """Feed one MAR sample (None = no face). Returns True on the frame a new yawn is counted."""
        self._expire(t)
        if mar is None or mar < self.close_threshold:
            self._opened_at, self._counted = None, False
            return False
        if mar >= self.open_threshold and self._opened_at is None:
            self._opened_at = t
        if self._opened_at is not None and not self._counted and t - self._opened_at >= self.min_duration_s:
            # Counted as soon as it qualifies (real time), not when the mouth closes.
            self._counted = True
            self._events.append(t)
            return True
        return False

    def count(self, t: float) -> int:
        """Yawns in the last window_s seconds."""
        self._expire(t)
        return len(self._events)

    def recent(self, t: float, half_life_s: float = 30.0) -> float:
        """Recency-weighted count: each event counts 1 now, ½ after `half_life_s`, ¼ after 2×...

        The 5-minute count is what the parent sees; this is what decides how tired the driver is
        *now*, so a driver who stopped yawning / nodding recovers within a minute or so."""
        self._expire(t)
        return sum(0.5 ** ((t - e) / half_life_s) for e in self._events)

    def sustained(self, t: float, hold_s: float = 120.0, fade_s: float = 180.0) -> float:
        """Yawns in the last 10 minutes, as evidence of fatigue *now*.

        Counts fully for `hold_s` after the latest yawn, then fades out over `fade_s`: a driver who
        yawned 3 times and then stopped is back to normal within ~5 minutes, not after 10."""
        self._expire(t)
        if not self._events:
            return 0.0
        since = t - self._events[-1]
        weight = 1.0 if since <= hold_s else max(0.0, 1.0 - (since - hold_s) / fade_s)
        return len(self._events) * weight

    def _expire(self, t: float) -> None:
        while self._events and t - self._events[0] > self.window_s:
            self._events.popleft()
