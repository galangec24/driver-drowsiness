"""EAR on synthetic landmarks."""

import math

import pytest

from detectors.ear import LEFT_EYE, RIGHT_EYE, average_ear, eye_aspect_ratio


def synthetic_eye(
    width: float, opening: float, cx: float = 0.0, cy: float = 0.0
) -> list[tuple[float, float]]:
    """Six points p1..p6 of an eye: corners at ±width/2, lids at ±opening/2."""
    half = width / 2
    return [
        (cx - half, cy),  # p1 corner
        (cx - half / 3, cy - opening / 2),  # p2 upper
        (cx + half / 3, cy - opening / 2),  # p3 upper
        (cx + half, cy),  # p4 corner
        (cx + half / 3, cy + opening / 2),  # p5 lower
        (cx - half / 3, cy + opening / 2),  # p6 lower
    ]


def test_open_eye_ear_matches_geometry() -> None:
    # vertical distances = opening each, horizontal = width → EAR = 2*opening / (2*width)
    assert eye_aspect_ratio(synthetic_eye(30, 9)) == pytest.approx(0.3)


def test_closed_eye_is_near_zero() -> None:
    assert eye_aspect_ratio(synthetic_eye(30, 0.0)) == pytest.approx(0.0)


def test_ear_monotonic_in_opening() -> None:
    values = [eye_aspect_ratio(synthetic_eye(30, o)) for o in (0, 2, 4, 6, 8, 10)]
    assert values == sorted(values)


def test_scale_and_translation_invariant() -> None:
    a = eye_aspect_ratio(synthetic_eye(30, 7))
    b = eye_aspect_ratio(synthetic_eye(300, 70, cx=500, cy=-200))
    assert a == pytest.approx(b)


def test_rotation_invariant() -> None:
    eye = synthetic_eye(30, 8)
    ang = math.radians(25)
    rotated = [(x * math.cos(ang) - y * math.sin(ang), x * math.sin(ang) + y * math.cos(ang)) for x, y in eye]
    assert eye_aspect_ratio(rotated) == pytest.approx(eye_aspect_ratio(eye))


def test_degenerate_and_bad_input() -> None:
    assert eye_aspect_ratio([(0, 0)] * 6) == 0.0
    with pytest.raises(ValueError):
        eye_aspect_ratio([(0, 0)] * 5)


def test_average_ear_uses_facemesh_indices() -> None:
    landmarks = [(0.0, 0.0)] * 478
    landmarks = list(landmarks)
    for idx, pt in zip(RIGHT_EYE, synthetic_eye(30, 9, cx=200, cy=200), strict=True):
        landmarks[idx] = pt
    for idx, pt in zip(LEFT_EYE, synthetic_eye(30, 6, cx=300, cy=200), strict=True):
        landmarks[idx] = pt
    assert average_ear(landmarks) == pytest.approx((0.3 + 0.2) / 2)
