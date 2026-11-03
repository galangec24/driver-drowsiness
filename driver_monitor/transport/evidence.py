"""The alert photo sent to the parent: eyes closed, and sharp.

The frame where the eyes are *most* closed is usually the middle of a head drop or of the eyelids
moving, i.e. motion-blurred, and fast movement also throws the eye landmarks off, which makes such
frames look even more closed. So each reading interval keeps its few most-closed frames, and the
photo is the sharpest of those whose eyes are still about as closed as the most-closed one.
Sharpness = variance of the Laplacian over the face (high = crisp edges).

The photo itself (alert_photo) is cropped to head and shoulders, contrast-balanced and enlarged:
from a dashboard camera the face is often a quarter of the frame and washed out by a bright
window, too small for the parent to see the eyes on a phone (field test 2026-11-03).
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
        # (ear, sharpness, frame, face box)
        self._current: list[tuple[float, float, np.ndarray, Box | None]] = []
        self._history: list[list[tuple[float, float, np.ndarray, Box | None]]] = []

    def offer(self, ear: float, frame: np.ndarray, face: Box | None = None) -> None:
        """Consider this frame (cheap unless it is among the interval's most-closed ones)."""
        if len(self._current) >= self.keep and ear >= self._current[-1][0]:
            return
        self._current.append((ear, sharpness(frame, face), frame.copy(), face))
        self._current.sort(key=lambda c: c[0])
        del self._current[self.keep :]

    def next_interval(self) -> None:
        """A reading was sent: start a new interval, remember the last `intervals` ones."""
        if self._current:
            self._history = [*self._history[-(self.intervals - 1) :], self._current]
        self._current = []

    def best(self) -> np.ndarray | None:
        """Sharpest frame whose eyes are about as closed as the most-closed one (None if none)."""
        found = self.best_with_face()
        return found[0] if found else None

    def best_with_face(self) -> tuple[np.ndarray, Box | None] | None:
        """best(), with that frame's face box (for cropping the photo)."""
        cands = [c for group in [*self._history, self._current] for c in group]
        if not cands:
            return None
        lowest = min(c[0] for c in cands)
        closed_enough = max(lowest * 1.2, lowest + 0.02)
        pick = max((c for c in cands if c[0] <= closed_enough), key=lambda c: c[1])
        return pick[2], pick[3]

    def reset(self) -> None:
        self._current, self._history = [], []


def alert_photo(
    frame: np.ndarray, face: Box | None = None, margin: float = 0.9, width: int = 560
) -> np.ndarray:
    """The parent's alert photo: head and shoulders around the face (face width + `margin` of it on
    each side, 4:3), contrast-balanced on lightness only (CLAHE, colours kept) and enlarged to
    `width`. The whole frame, just balanced, when no face is known."""
    img = frame
    h_img, w_img = frame.shape[:2]
    if face is not None:
        x, y, w, h = face
        crop_w = min(w_img, round(max(w, h) * (1 + 2 * margin)))
        crop_h = min(h_img, round(crop_w * 3 / 4))
        cx, cy = x + w / 2, y + h * 0.6  # a little below the face centre: chin and shoulders
        x0 = int(min(max(0, cx - crop_w / 2), w_img - crop_w))
        y0 = int(min(max(0, cy - crop_h / 2), h_img - crop_h))
        if crop_w >= 40 and crop_h >= 30:
            img = frame[y0 : y0 + crop_h, x0 : x0 + crop_w]
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    lab[:, :, 0] = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(4, 4)).apply(lab[:, :, 0])
    img = cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)
    if img.shape[1] != width:
        scale = width / img.shape[1]
        interp = cv2.INTER_CUBIC if scale > 1 else cv2.INTER_AREA
        img = cv2.resize(img, (width, round(img.shape[0] * scale)), interpolation=interp)
    return img
