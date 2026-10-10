"""Head pose recovered from synthetic projections of the 3D face model."""

import cv2
import numpy as np
import pytest

from detectors.head_pose import MODEL_POINTS, camera_matrix, estimate_head_pose

W, H = 640, 480
FLIP = np.diag([1.0, -1.0, -1.0])


def rot(pitch: float, yaw: float, roll: float) -> np.ndarray:
    p, y, r = np.radians([pitch, yaw, roll])
    rx = np.array([[1, 0, 0], [0, np.cos(p), -np.sin(p)], [0, np.sin(p), np.cos(p)]])
    ry = np.array([[np.cos(y), 0, np.sin(y)], [0, 1, 0], [-np.sin(y), 0, np.cos(y)]])
    rz = np.array([[np.cos(r), -np.sin(r), 0], [np.sin(r), np.cos(r), 0], [0, 0, 1]])
    return rz @ ry @ rx


def project(pitch: float, yaw: float, roll: float) -> np.ndarray:
    """Image points for a face with the given pose, 60 cm from the camera."""
    rmat = FLIP @ rot(pitch, yaw, roll)  # model y-up/z-out → camera y-down/z-in
    rvec, _ = cv2.Rodrigues(rmat)
    pts, _ = cv2.projectPoints(
        MODEL_POINTS, rvec, np.array([0.0, 0.0, 600.0]), camera_matrix(W, H), np.zeros(4)
    )
    return pts.reshape(-1, 2)


def test_frontal_face_is_near_zero() -> None:
    pose = estimate_head_pose(project(0, 0, 0), W, H)
    assert pose is not None
    assert pose.pitch == pytest.approx(0, abs=1.0)
    assert pose.yaw == pytest.approx(0, abs=1.0)
    assert pose.roll == pytest.approx(0, abs=1.0)


@pytest.mark.parametrize(
    ("pitch", "yaw", "roll"),
    [(15, 0, 0), (-20, 0, 0), (0, 25, 0), (0, -30, 0), (0, 0, 12), (10, -15, 5)],
)
def test_recovers_known_rotation(pitch: float, yaw: float, roll: float) -> None:
    pose = estimate_head_pose(project(pitch, yaw, roll), W, H)
    assert pose is not None
    assert pose.pitch == pytest.approx(pitch, abs=1.5)
    assert pose.yaw == pytest.approx(yaw, abs=1.5)
    assert pose.roll == pytest.approx(roll, abs=1.5)


def test_nodding_down_changes_pitch_sign() -> None:
    down = estimate_head_pose(project(-20, 0, 0), W, H)
    up = estimate_head_pose(project(20, 0, 0), W, H)
    assert down is not None and up is not None
    assert down.pitch < 0 < up.pitch


def test_wrong_point_count() -> None:
    with pytest.raises(ValueError):
        estimate_head_pose([(0, 0)] * 5, W, H)
