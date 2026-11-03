"""Field trace 2026-11-03 (narrow eyes, leaning on a hand): fully closed eyes read 0.04-0.41 of the
open-eye EAR, deliberately narrowed eyes 0.66-0.78, and leaning on a hand put the chin out of the
picture while the eyes were in plain view."""

from __future__ import annotations

import pytest

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
    """The old pairs: one dip and squinting eyes at 66-78 % stayed "closed" (field trace 4: 68 %)."""
    p, t = calibrated()
    t = feed(p, [0.30 * 0.45], t)  # one dip below the 50 % line
    t = feed(p, [0.30 * 0.66] * 30, t)  # squinting, above the 62 % reopen line
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


# Field test 2026-11-03 (second round): blinking a lot (irritated eyes) and one eye shut.


def test_one_eye_open_is_not_closed_eyes() -> None:
    from detectors.ear import open_eye_ear

    pts = [(0.0, 0.0)] * 478
    open_eye = [(0, 0), (10, -3), (20, -3), (30, 0), (20, 3), (10, 3)]  # EAR 0.2
    shut_eye = [(0, 0), (10, -0.3), (20, -0.3), (30, 0), (20, 0.3), (10, 0.3)]  # EAR 0.02
    for i, p in zip(RIGHT_EYE, open_eye, strict=True):
        pts[i] = (100 + p[0], 100 + p[1])
    for i, p in zip(LEFT_EYE, shut_eye, strict=True):
        pts[i] = (200 + p[0], 100 + p[1])
    assert open_eye_ear(pts) == pytest.approx(0.2)


def test_rapid_blinking_is_not_a_microsleep_or_eyes_closed() -> None:
    """Blinking about twice a second, seen at ~4 frames/s (this laptop): closed, open, closed..."""
    p, t = calibrated()
    longest = 0.0
    for i in range(60):  # 15 s
        p.update(0.30 * (0.15 if i % 2 == 0 else 0.95), t)
        t += 0.25
        longest = max(longest, p.closed_for(t))
    assert longest < 0.5  # every open frame ends the "closure": no microsleep timer
    assert p.value < 0.1  # quick blinks are not "eyes closed much of the time"
    assert p.effective(t) < 0.1


def test_slow_closures_still_count_toward_perclos() -> None:
    p, t = calibrated()
    for _ in range(10):  # 1 s closed, 2 s open, repeated: heavy, slow blinks
        t = feed(p, [0.30 * 0.2] * 10, t)
        t = feed(p, [0.30] * 20, t)
    assert p.value > 0.25


def test_squinting_open_eye_with_the_other_shut_stays_awake() -> None:
    """Field trace 4 / "Latest Capture": one eye shut, the open one squinting at 0.59-0.70."""
    p, t = calibrated()
    squint = [0.30 * r for r in [0.59, 0.66, 0.70, 0.62, 0.68, 0.64, 0.61, 0.67] * 10]
    longest = 0.0
    for e in squint:
        p.update(e, t)
        t += 0.1
        longest = max(longest, p.closed_for(t))
    assert longest == 0.0


def test_a_deliberate_squint_after_a_dip_is_not_a_microsleep() -> None:
    """Field trace 8: narrowed eyes that can still see read 0.45-0.68 of the open level, dipping
    once; with "open again" at 62 % they stayed "closed" for 2-3 s (false microsleep)."""
    p, t = calibrated()
    t = feed(p, [0.30 * 0.45], t)  # a dip below 50 %
    longest = 0.0
    for r in [0.58, 0.62, 0.56, 0.60, 0.64, 0.57] * 8:  # squinting, above 55 %
        p.update(0.30 * r, t)
        t += 0.1
        longest = max(longest, p.closed_for(t))
    assert longest < 0.5


def test_fully_closed_eyes_still_count_with_the_closer_open_line() -> None:
    p, t = calibrated()
    longest = 0.0
    for r in [0.08, 0.06, 0.10, 0.07, 0.52, 0.09, 0.05] * 6:  # closed, one noisy 52 % frame
        p.update(0.30 * r, t)
        t += 0.1
        longest = max(longest, p.closed_for(t))
    assert longest >= 4.0
