"""Eye Aspect Ratio (Soukupová & Čech, 2016).

EAR = (|p2 - p6| + |p3 - p5|) / (2 |p1 - p4|)

p1/p4 are the eye corners, p2/p3 the upper lid, p6/p5 the lower lid.
"""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np

Point = Sequence[float]

# MediaPipe FaceMesh indices, ordered p1..p6 for each eye.
RIGHT_EYE = (33, 160, 158, 133, 153, 144)
LEFT_EYE = (362, 385, 387, 263, 373, 380)


def eye_aspect_ratio(eye: Sequence[Point]) -> float:
    """EAR for one eye given six (x, y) points ordered p1..p6. Returns 0.0 for degenerate input."""
    if len(eye) != 6:
        raise ValueError(f"expected 6 eye points, got {len(eye)}")
    p = np.asarray(eye, dtype=float)[:, :2]
    vertical = np.linalg.norm(p[1] - p[5]) + np.linalg.norm(p[2] - p[4])
    horizontal = np.linalg.norm(p[0] - p[3])
    if horizontal <= 1e-9:
        return 0.0
    return float(vertical / (2.0 * horizontal))


def average_ear(landmarks: Sequence[Point]) -> float:
    """Mean EAR of both eyes from a full FaceMesh landmark list (pixel or normalised coords)."""
    right = [landmarks[i] for i in RIGHT_EYE]
    left = [landmarks[i] for i in LEFT_EYE]
    return (eye_aspect_ratio(right) + eye_aspect_ratio(left)) / 2.0
