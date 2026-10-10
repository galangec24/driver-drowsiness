"""Head pose (pitch / yaw / roll, degrees) via cv2.solvePnP on six FaceMesh landmarks."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import cv2
import numpy as np

# FaceMesh indices: nose tip, chin, left eye outer, right eye outer, left mouth, right mouth.
POSE_LANDMARKS = (1, 152, 263, 33, 287, 57)

# Generic 3D face model (millimetres), same order as POSE_LANDMARKS.
MODEL_POINTS = np.array(
    [
        (0.0, 0.0, 0.0),
        (0.0, -63.6, -12.5),
        (43.3, 32.7, -26.0),
        (-43.3, 32.7, -26.0),
        (28.9, -28.9, -24.1),
        (-28.9, -28.9, -24.1),
    ],
    dtype=np.float64,
)


@dataclass(frozen=True)
class HeadPose:
    pitch: float
    yaw: float
    roll: float


def camera_matrix(width: int, height: int) -> np.ndarray:
    focal = float(width)
    return np.array([[focal, 0, width / 2.0], [0, focal, height / 2.0], [0, 0, 1]], dtype=np.float64)


def rotation_to_euler(rvec: np.ndarray) -> HeadPose:
    """Rodrigues vector → (pitch about x, yaw about y, roll about z) in degrees."""
    rmat, _ = cv2.Rodrigues(rvec)
    sy = np.hypot(rmat[0, 0], rmat[1, 0])
    if sy > 1e-6:
        pitch = np.arctan2(rmat[2, 1], rmat[2, 2])
        yaw = np.arctan2(-rmat[2, 0], sy)
        roll = np.arctan2(rmat[1, 0], rmat[0, 0])
    else:  # gimbal lock
        pitch = np.arctan2(-rmat[1, 2], rmat[1, 1])
        yaw = np.arctan2(-rmat[2, 0], sy)
        roll = 0.0
    return HeadPose(*(float(np.degrees(a)) for a in (pitch, yaw, roll)))


def estimate_head_pose(image_points: Sequence[Sequence[float]], width: int, height: int) -> HeadPose | None:
    """image_points: six (x, y) pixel coords ordered like POSE_LANDMARKS."""
    pts = np.asarray(image_points, dtype=np.float64).reshape(-1, 2)
    if pts.shape[0] != len(MODEL_POINTS):
        raise ValueError(f"expected {len(MODEL_POINTS)} points, got {pts.shape[0]}")
    # SQPNP is globally optimal; the default ITERATIVE solver can converge to a mirrored solution
    # behind the camera (tz < 0) on real faces, which shows up as ~±135° roll.
    ok, rvec, tvec = cv2.solvePnP(
        MODEL_POINTS, pts, camera_matrix(width, height), np.zeros((4, 1)), flags=cv2.SOLVEPNP_SQPNP
    )
    if not ok or tvec[2, 0] <= 0:
        return None
    # The 3D model is y-up while image y grows downward: flip about x so a frontal face is ~0°.
    flip = np.diag([1.0, -1.0, -1.0])
    rmat, _ = cv2.Rodrigues(rvec)
    corrected, _ = cv2.Rodrigues(flip @ rmat)
    return rotation_to_euler(corrected)
