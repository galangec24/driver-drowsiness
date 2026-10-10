"""Local pre-aggregation: frame-level signals → one reading per POST interval.

No drowsiness decision is made here — thresholds are per-driver and applied by the backend.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class IntervalAggregator:
    ears: list[float] = field(default_factory=list)
    face_scores: list[float] = field(default_factory=list)
    frames: int = 0
    mar_max: float | None = None
    last_mar_max: float | None = None  # value of the interval just flushed

    def add(self, ear: float | None, face_score: float, mar: float | None = None) -> None:
        self.frames += 1
        self.face_scores.append(face_score)
        if ear is not None:
            self.ears.append(ear)
        if mar is not None:
            self.mar_max = mar if self.mar_max is None else max(self.mar_max, mar)

    def flush(self) -> tuple[float | None, float]:
        """(mean EAR or None if no face was seen, mean face confidence). Resets the interval."""
        ear = sum(self.ears) / len(self.ears) if self.ears else None
        conf = sum(self.face_scores) / len(self.face_scores) if self.face_scores else 0.0
        self.ears.clear()
        self.face_scores.clear()
        self.frames = 0
        self.last_mar_max, self.mar_max = self.mar_max, None
        return ear, conf
