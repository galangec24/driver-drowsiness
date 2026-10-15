"""Driver + passenger in view: eye readings must come from the driver (the face nearest the camera)."""

from __future__ import annotations

from pathlib import Path

import cv2
import pytest

import config
from detectors.landmarks import face_area

FIXTURES = Path(__file__).parent / "fixtures"

pytestmark = pytest.mark.skipif(
    not config.FACE_LANDMARKER_MODEL.exists(), reason="MediaPipe models not downloaded (run main.py once)"
)


def test_landmarks_follow_the_driver_not_the_passenger():
    from detectors.face_detector import FaceDetector
    from detectors.landmarks import LandmarkExtractor

    img = cv2.imread(str(FIXTURES / "two_faces.jpg"))  # driver left (large), passenger right (small)
    rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    det = FaceDetector(config.FACE_DETECTOR_MODEL)
    lm = LandmarkExtractor(config.FACE_LANDMARKER_MODEL)
    try:
        face = det.detect(rgb)
        pts = lm.extract(rgb)
    finally:
        det.close()
        lm.close()
    driver_right_edge = 445
    assert face is not None and face.x + face.width / 2 < driver_right_edge
    assert pts is not None
    cx = sum(p[0] for p in pts) / len(pts)
    assert cx < driver_right_edge  # landmarks on the driver's face


def test_face_area():
    assert face_area([(0, 0), (10, 0), (10, 5)]) == 50
