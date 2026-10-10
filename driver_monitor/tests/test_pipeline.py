"""Integration: mock camera + fake detectors → payload. No test touches the real backend."""

from datetime import UTC, datetime

import numpy as np
import pytest

from detectors.ear import LEFT_EYE, RIGHT_EYE
from detectors.face_detector import FaceBox
from detectors.head_pose import POSE_LANDMARKS
from detectors.perclos import PerclosTracker
from main import Monitor
from tests.test_ear import synthetic_eye
from transport.ingest_client import build_payload

DRIVER = "665f00000000000000000001"


def face_landmarks(opening: float) -> list[tuple[float, float]]:
    pts = [(320.0, 240.0)] * 478
    pts = list(pts)
    # Plausible frontal geometry for solvePnP. Written first: indices 33 and 263 are also the
    # outer eye corners, which the eye points below then set consistently.
    for idx, p in zip(
        POSE_LANDMARKS, [(320, 250), (320, 345), (390, 200), (250, 200), (362, 295), (278, 295)], strict=True
    ):
        pts[idx] = (float(p[0]), float(p[1]))
    for idx, p in zip(RIGHT_EYE, synthetic_eye(40, opening, cx=270, cy=200), strict=True):
        pts[idx] = p
    for idx, p in zip(LEFT_EYE, synthetic_eye(40, opening, cx=370, cy=200), strict=True):
        pts[idx] = p
    return pts


class FakeDetector:
    def __init__(self, present: bool = True) -> None:
        self.present = present

    def detect(self, rgb: np.ndarray) -> FaceBox | None:
        return FaceBox(200, 120, 240, 260, 0.93) if self.present else None


class FakeLandmarker:
    def __init__(self) -> None:
        self.opening = 12.0

    def extract(self, rgb: np.ndarray) -> list[tuple[float, float]]:
        return face_landmarks(self.opening)


class RecordingPoster:
    def __init__(self) -> None:
        self.payloads: list[dict] = []

    def post(self, payload: dict) -> dict:
        self.payloads.append(payload)
        return {"classification": "alert", "fusionScore": 0.1, "alertTriggered": False, "alertId": None}


def make_monitor(detector: FakeDetector | None = None) -> tuple[Monitor, FakeLandmarker]:
    lm = FakeLandmarker()
    m = Monitor(
        driver_id=DRIVER,
        detector=detector or FakeDetector(),
        landmarker=lm,
        poster=RecordingPoster(),
        perclos=PerclosTracker(min_baseline_samples=5),
        interval_s=1.0,
        analyze_every=3,
    )
    return m, lm


def mock_camera(n: int) -> list[np.ndarray]:
    return [np.zeros((480, 640, 3), dtype=np.uint8) for _ in range(n)]


def test_only_every_third_frame_is_analysed() -> None:
    m, _ = make_monitor()
    for i, frame in enumerate(mock_camera(9)):
        m.process_frame(frame, i / 30)
    assert m.aggregator.frames == 3


def test_payload_matches_contract_and_posts_once_per_interval() -> None:
    m, lm = make_monitor()
    poster = m.poster
    t = 0.0
    for frame in mock_camera(90):  # 3 s at 30 fps
        m.process_frame(frame, t)
        if m.due(t):
            poster.post(m.make_payload(t))
        t += 1 / 30
    assert len(poster.payloads) == 2  # ~once per second, never per frame
    p = poster.payloads[0]
    assert list(p) == ["driverId", "source", "signals", "timestamp"]
    assert p["source"] == "driver_monitor"
    # Contract keys first, in order; optional additive signals (yawnCount, mar) after them.
    assert list(p["signals"])[:5] == ["ear", "perclos", "heartRate", "faceConfidence", "matchedDriver"]
    assert p["signals"]["yawnCount"] == 0
    assert p["signals"]["nodCount"] == 0
    assert "wearable" not in p
    assert p["signals"]["ear"] == pytest.approx(0.3, abs=0.01)  # 2*12 / (2*40)
    assert p["signals"]["faceConfidence"] == pytest.approx(0.93)
    assert p["signals"]["matchedDriver"] == DRIVER
    assert p["timestamp"].endswith("Z")
    assert m.last.pose is not None and abs(m.last.pose.yaw) < 20


def test_closing_eyes_raises_perclos() -> None:
    m, lm = make_monitor()
    t = 0.0
    for frame in mock_camera(60):
        m.process_frame(frame, t)
        t += 1 / 30
    lm.opening = 2.0  # eyes nearly shut
    for frame in mock_camera(60):
        m.process_frame(frame, t)
        t += 1 / 30
    assert m.perclos.value > 0.3
    assert m.make_payload(t)["signals"]["ear"] < 0.2


def test_no_face_omits_ear_and_perclos() -> None:
    m, _ = make_monitor(FakeDetector(present=False))
    for i, frame in enumerate(mock_camera(30)):
        m.process_frame(frame, i / 30)
    p = m.make_payload(1.0)
    assert "ear" not in p["signals"] and "perclos" not in p["signals"]
    assert p["signals"]["faceConfidence"] == 0.0
    assert p["signals"]["heartRate"] == 0


def test_build_payload_rounding_and_timestamp() -> None:
    p = build_payload(DRIVER, 0.123456, 0.4567, 0.98765, now=datetime(2026, 10, 7, 10, 23, tzinfo=UTC))
    assert p["signals"]["ear"] == 0.123
    assert p["signals"]["perclos"] == 0.457
    assert p["timestamp"] == "2026-10-07T10:23:00.000Z"
