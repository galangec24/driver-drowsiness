"""PERCLOS — percentage of time the eyes are closed over a rolling window (default 30 s).

"Closed" is judged relative to the driver's own open-eye baseline (a high percentile of recent EAR),
so there is no absolute EAR threshold here. The backend still applies each driver's personal
thresholds to the raw EAR/PERCLOS it receives.
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
    ) -> None:
        if not 0 < closure_ratio < 1:
            raise ValueError("closure_ratio must be between 0 and 1")
        self.window_s = window_s
        self.closure_ratio = closure_ratio
        self.baseline_window_s = baseline_window_s
        self.baseline_percentile = baseline_percentile
        self.min_baseline_samples = min_baseline_samples
        self._closed: deque[tuple[float, bool]] = deque()
        self._ears: deque[tuple[float, float]] = deque()
        self._closed_since: float | None = None

    @property
    def baseline(self) -> float | None:
        """Driver's open-eye EAR estimate, or None until enough samples."""
        if len(self._ears) < self.min_baseline_samples:
            return None
        return float(np.percentile([e for _, e in self._ears], self.baseline_percentile))

    def update(self, ear: float, t: float, closed: bool | None = None) -> float:
        """Add one EAR sample at time t (seconds) and return the current PERCLOS (0..1).

        `closed` (from the eye-state image model) overrides the EAR-ratio rule when given."""
        self._ears.append((t, ear))
        while self._ears and t - self._ears[0][0] > self.baseline_window_s:
            self._ears.popleft()

        base = self.baseline
        if closed is None:
            closed = base is not None and ear < base * self.closure_ratio
        if closed:
            self._closed_since = t if self._closed_since is None else self._closed_since
        else:
            self._closed_since = None
        self._closed.append((t, closed))
        while self._closed and t - self._closed[0][0] > self.window_s:
            self._closed.popleft()
        return self.value

    def closed_for(self, t: float) -> float:
        """Seconds the eyes have been continuously closed (0 when open / unknown). Microsleep timer."""
        return 0.0 if self._closed_since is None else t - self._closed_since

    def mark_no_face(self, t: float) -> None:
        """Drop stale samples when the face is lost so PERCLOS reflects only observed time."""
        self._closed_since = None
        while self._closed and t - self._closed[0][0] > self.window_s:
            self._closed.popleft()

    @property
    def value(self) -> float:
        if not self._closed:
            return 0.0
        return sum(1 for _, c in self._closed if c) / len(self._closed)

    def reset(self) -> None:
        self._closed.clear()
        self._ears.clear()
        self._closed_since = None
