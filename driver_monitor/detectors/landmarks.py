"""Face landmarks (MediaPipe FaceLandmarker, 478 points incl. irises)."""

from __future__ import annotations

from pathlib import Path

import numpy as np

from detectors.ear import LEFT_EYE, RIGHT_EYE
from detectors.head_pose import POSE_LANDMARKS

Points = list[tuple[float, float]]


def face_area(points: Points) -> float:
    """Bounding-box area of a face's landmarks: the driver, nearest the camera, is the largest."""
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return (max(xs) - min(xs)) * (max(ys) - min(ys))


class LandmarkExtractor:
    def __init__(self, model_path: Path) -> None:
        import mediapipe as mp
        from mediapipe.tasks.python import BaseOptions, vision

        self._mp = mp
        self._landmarker = vision.FaceLandmarker.create_from_options(
            vision.FaceLandmarkerOptions(
                base_options=BaseOptions(model_asset_path=str(model_path)),
                # A passenger may be in view too: find up to 3 faces and keep the driver's.
                num_faces=3,
                min_face_detection_confidence=0.5,
                min_tracking_confidence=0.5,
            )
        )

    def extract(self, rgb: np.ndarray) -> Points | None:
        """All landmarks as pixel (x, y) of the driver's face (the largest = closest), or None."""
        h, w = rgb.shape[:2]
        image = self._mp.Image(image_format=self._mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
        result = self._landmarker.detect(image)
        if not result.face_landmarks:
            return None
        faces = [[(lm.x * w, lm.y * h) for lm in face] for face in result.face_landmarks]
        return max(faces, key=face_area)

    def close(self) -> None:
        self._landmarker.close()


def eye_points(landmarks: Points) -> tuple[Points, Points]:
    return [landmarks[i] for i in RIGHT_EYE], [landmarks[i] for i in LEFT_EYE]


def pose_points(landmarks: Points) -> Points:
    return [landmarks[i] for i in POSE_LANDMARKS]
