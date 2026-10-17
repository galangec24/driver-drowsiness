"""PERCLOS — percentage of time the eyes are closed over a rolling window (default 30 s).

"Closed" is judged relative to the driver's own open-eye baseline (a high percentile of recent EAR),
so there is no absolute EAR threshold here. The backend still applies each driver's personal
thresholds to the raw EAR/PERCLOS it receives.

Narrow eyes: the open/closed gap is small, so one noisy frame used to flip "closed" back to
"open" and restart the microsleep timer. Closure now has hysteresis (re-opening needs a clearly
higher EAR) and short "open" blips (< `open_grace_s`) don't end a closure.

Unreliable frames (face turning back into view, head turned far to the side) are passed with
`reliable=False`: they never count as closed, never feed the baseline, and end any closure.
"""

from __future__ import annotations

from collections import deque

import numpy as np


class PerclosTracker:
    def __init__(
        self,
        window_s: float = 30.0,
        closure_ratio: float = 0.7,
        baseline_window_s: float = 120.0,
        baseline_percentile: float = 90.0,
        min_baseline_samples: int = 15,
        reopen_margin: float = 0.1,
        open_grace_s: float = 0.3,
        min_coverage_s: float = 3.0,
        drop_before_loss_s: float = 0.6,
    ) -> None:
        if not 0 < closure_ratio < 1:
            raise ValueError("closure_ratio must be between 0 and 1")
        self.window_s = window_s
        self.closure_ratio = closure_ratio
        self.baseline_window_s = baseline_window_s
        self.baseline_percentile = baseline_percentile
        self.min_baseline_samples = min_baseline_samples
        self.reopen_margin = reopen_margin
        self.open_grace_s = open_grace_s
        self.min_coverage_s = min_coverage_s
        self.drop_before_loss_s = drop_before_loss_s
        self._open_since: float | None = None
        self._is_closed = False
        self._lost = False
        self._closed: deque[tuple[float, bool]] = deque()
        self._ears: deque[tuple[float, float]] = deque()
        self._closed_since: float | None = None

    @property
    def baseline(self) -> float | None:
        """Driver's open-eye EAR estimate, or None until enough samples."""
        if len(self._ears) < self.min_baseline_samples:
            return None
        return float(np.percentile([e for _, e in self._ears], self.baseline_percentile))

    def update(self, ear: float, t: float, closed: bool | None = None, reliable: bool = True) -> float:
        """Add one EAR sample at time t (seconds) and return the current PERCLOS (0..1).

        `closed` (from the eye-state image model) overrides the EAR-ratio rule when given.
        `reliable=False` (face only half in view, head turned away): the sample is ignored."""
        self._lost = False
        if not reliable:
            self._closed_since, self._open_since, self._is_closed = None, None, False
            return self.value
        self._ears.append((t, ear))
        while self._ears and t - self._ears[0][0] > self.baseline_window_s:
            self._ears.popleft()

        base = self.baseline
        if closed is None:
            if base is None:
                closed = False
            elif self._is_closed:  # hysteresis: stays closed until clearly open again
                closed = ear < base * min(0.95, self.closure_ratio + self.reopen_margin)
            else:
                closed = ear < base * self.closure_ratio
        self._is_closed = closed
        if closed:
            self._open_since = None
            self._closed_since = t if self._closed_since is None else self._closed_since
        elif self._closed_since is not None:
            # A brief "open" reading inside a closure (landmark noise) doesn't end it.
            self._open_since = t if self._open_since is None else self._open_since
            if t - self._open_since >= self.open_grace_s:
                self._closed_since, self._open_since = None, None
        self._closed.append((t, closed))
        while self._closed and t - self._closed[0][0] > self.window_s:
            self._closed.popleft()
        return self.value

    @property
    def is_closed(self) -> bool:
        """This frame's open/closed decision (with hysteresis); False until calibrated."""
        return self._is_closed

    def closed_for(self, t: float) -> float:
        """Seconds the eyes have been continuously closed (0 when open / unknown). Microsleep timer."""
        return 0.0 if self._closed_since is None else t - self._closed_since

    def mark_no_face(self, t: float) -> None:
        """Drop stale samples when the face is lost so PERCLOS reflects only observed time.

        The last moments before the face disappeared (turning or ducking away: eyes look
        half shut to the landmarker) are dropped too, so they can't count as drowsiness."""
        if not self._lost:
            self._lost = True
            last = self._closed[-1][0] if self._closed else t
            while self._closed and last - self._closed[-1][0] < self.drop_before_loss_s:
                self._closed.pop()
        self._closed_since, self._open_since, self._is_closed = None, None, False
        while self._closed and t - self._closed[0][0] > self.window_s:
            self._closed.popleft()

    def recent(self, t: float, span_s: float = 10.0) -> float:
        """Share of the last `span_s` seconds with eyes closed (0 until a few samples)."""
        pts = [c for ts, c in self._closed if t - ts <= span_s]
        if len(pts) < 5:
            return 0.0
        return sum(pts) / len(pts)

    def effective(self, t: float, span_s: float = 10.0) -> float:
        """PERCLOS for alarms: the 30 s value, but only while the eyes are *still* closing often.

        A driver who has kept their eyes open for the last `span_s` is back to normal now, not in
        30 s when the old closures have left the window."""
        return min(self.value, self.recent(t, span_s))

    @property
    def value(self) -> float:
        # Needs a few seconds of observed time: right after the face comes back, 2 of 3 samples
        # "closed" is not 67% PERCLOS.
        if not self._closed or self._closed[-1][0] - self._closed[0][0] < self.min_coverage_s:
            return 0.0
        return sum(1 for _, c in self._closed if c) / len(self._closed)

    def reset(self) -> None:
        self._closed.clear()
        self._ears.clear()
        self._closed_since, self._open_since, self._is_closed, self._lost = None, None, False, False
