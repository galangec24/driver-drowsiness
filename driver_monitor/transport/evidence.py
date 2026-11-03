"""The alert photo sent to the parent: eyes closed, and sharp.

The frame where the eyes are *most* closed is usually the middle of a head drop or of the eyelids
moving, i.e. motion-blurred, and fast movement also throws the eye landmarks off, which makes such
frames look even more closed. So each reading interval keeps its few most-closed frames, and the
photo is the sharpest of those whose eyes are still about as closed as the most-closed one.
Sharpness = variance of the Laplacian over the face (high = crisp edges).
"""

from __future__ import annotations

import cv2
import numpy as np

Box = tuple[int, int, int, int]  # x, y, width, height


def sharpness(frame: np.ndarray, face: Box | None = None) -> float:
    """Variance of the Laplacian of the face region (whole frame without a face), at a fixed
    160 px width so faces near and far are compared fairly."""
    img = frame
    if face is not None:
        x, y, w, h = face
        crop = frame[max(0, y) : y + h, max(0, x) : x + w]
        if crop.size:
            img = crop
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    if gray.shape[1] != 160:
        gray = cv2.resize(gray, (160, max(1, round(gray.shape[0] * 160 / gray.shape[1]))))
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


class EvidencePicker:
    def __init__(self, keep: int = 5, intervals: int = 3) -> None:
        self.keep = keep
        self.intervals = intervals
        self._current: list[tuple[float, float, np.ndarray]] = []  # (ear, sharpness, frame)
        self._history: list[list[tuple[float, float, np.ndarray]]] = []

    def offer(self, ear: float, frame: np.ndarray, face: Box | None = None) -> None:
        """Consider this frame (cheap unless it is among the interval's most-closed ones)."""
        if len(self._current) >= self.keep and ear >= self._current[-1][0]:
            return
        self._current.append((ear, sharpness(frame, face), frame.copy()))
        self._current.sort(key=lambda c: c[0])
        del self._current[self.keep :]

    def next_interval(self) -> None:
        """A reading was sent: start a new interval, remember the last `intervals` ones."""
        if self._current:
            self._history = [*self._history[-(self.intervals - 1) :], self._current]
        self._current = []

    def best(self) -> np.ndarray | None:
        """Sharpest frame whose eyes are about as closed as the most-closed one (None if none)."""
        cands = [c for group in [*self._history, self._current] for c in group]
        if not cands:
            return None
        lowest = min(c[0] for c in cands)
        closed_enough = max(lowest * 1.2, lowest + 0.02)
        return max((c for c in cands if c[0] <= closed_enough), key=lambda c: c[1])[2]

    def reset(self) -> None:
        self._current, self._history = [], []
