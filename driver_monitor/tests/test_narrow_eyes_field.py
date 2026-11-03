"""Field trace 2026-11-03 (narrow eyes, leaning on a hand): fully closed eyes read 0.04-0.41 of the
open-eye EAR, deliberately narrowed eyes 0.66-0.78, and leaning on a hand put the chin out of the
picture while the eyes were in plain view."""

from __future__ import annotations

from detectors.ear import LEFT_EYE, RIGHT_EYE
from detectors.perclos import PerclosTracker
from main import eyes_in_frame


def feed(p: PerclosTracker, ears: list[float], t: float = 0.0, dt: float = 0.1) -> float:
    for e in ears:
        p.update(e, t)
        t += dt
    return t


def calibrated() -> tuple[PerclosTracker, float]:
    p = PerclosTracker()
    return p, feed(p, [0.30] * 100)  # open-eye EAR ~0.30


def test_narrowed_eyes_are_not_a_microsleep() -> None:
    p, t = calibrated()
    # Narrowed for 5 s, one reading dipping to 0.66 of the baseline, the rest 0.72-0.78.
    narrowed = [0.30 * r for r in [0.66] + [0.72, 0.75, 0.78, 0.73] * 12]
    t = feed(p, narrowed, t)
    assert p.closed_for(t) == 0.0
    assert not p.is_closed


def test_fully_closed_eyes_start_the_microsleep_timer() -> None:
    p, t = calibrated()
    t = feed(p, [0.30 * 0.3] * 25, t)  # 2.5 s fully closed
    assert p.closed_for(t) >= 2.3


def test_a_brief_dip_does_not_keep_narrowed_eyes_closed() -> None:
    """The old 70 % / 80 % pair: one dip below 70 % and narrowed eyes at 72-78 % stayed "closed"."""
    p, t = calibrated()
    t = feed(p, [0.30 * 0.55], t)  # one dip below the 60 % line
    t = feed(p, [0.30 * 0.74] * 30, t)  # narrowed, clearly above the 68 % reopen line
    assert p.closed_for(t) == 0.0


def face_points(eye_xy: tuple[float, float], w: int = 640, h: int = 480) -> list[tuple[float, float]]:
    """478 landmarks: the eye points around eye_xy, the rest far below (chin out of the picture)."""
    pts = [(w / 2, h + 80.0)] * 478
    for i in (*RIGHT_EYE, *LEFT_EYE):
        pts[i] = eye_xy
    return pts


def test_eyes_in_view_count_even_with_the_chin_out_of_the_picture() -> None:
    assert eyes_in_frame(face_points((320, 300)), 640, 480)


def test_eyes_at_the_edge_of_the_picture_do_not_count() -> None:
    assert not eyes_in_frame(face_points((320, 476)), 640, 480)
    assert not eyes_in_frame(face_points((3, 200)), 640, 480)
