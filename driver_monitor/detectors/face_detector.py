"""Locate the driver's face (MediaPipe BlazeFace). Detection only — recognition happens on the backend."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np


@dataclass(frozen=True)
class FaceBox:
    x: int
    y: int
    width: int
    height: int
    score: float


class FaceDetector:
    def __init__(self, model_path: Path, min_confidence: float = 0.5) -> None:
        import mediapipe as mp
        from mediapipe.tasks.python import BaseOptions, vision

        self._mp = mp
        self._detector = vision.FaceDetector.create_from_options(
            vision.FaceDetectorOptions(
                base_options=BaseOptions(model_asset_path=str(model_path)),
                min_detection_confidence=min_confidence,
            )
        )

    def detect(self, rgb: np.ndarray) -> FaceBox | None:
        """Largest face in an RGB frame, or None."""
        image = self._mp.Image(image_format=self._mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
        result = self._detector.detect(image)
        if not result.detections:
            return None
        best = max(result.detections, key=lambda d: d.bounding_box.width * d.bounding_box.height)
        b = best.bounding_box
        score = best.categories[0].score if best.categories else 0.0
        return FaceBox(b.origin_x, b.origin_y, b.width, b.height, float(score))

    def close(self) -> None:
        self._detector.close()
