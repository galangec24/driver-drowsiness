"""PERCLOS rolling window with a self-calibrating, per-driver baseline."""

import pytest

from detectors.perclos import PerclosTracker


def feed(tracker: PerclosTracker, ears: list[float], start: float = 0.0, dt: float = 0.1) -> float:
    t = start
    for e in ears:
        tracker.update(e, t)
        t += dt
    return t


def test_zero_until_baseline_is_known() -> None:
    tr = PerclosTracker(min_baseline_samples=15)
    feed(tr, [0.05] * 10)
    assert tr.baseline is None
    assert tr.value == 0.0


def test_all_open_is_zero() -> None:
    tr = PerclosTracker()
    feed(tr, [0.30] * 100)
    assert tr.value == pytest.approx(0.0)


def test_fraction_closed_after_calibration() -> None:
    tr = PerclosTracker(window_s=30, closure_ratio=0.7)
    t = feed(tr, [0.30] * 50)  # calibrate (5 s open)
    feed(tr, [0.30] * 50 + [0.08] * 50, start=t)  # then half closed
    # 150 samples in the window: 50 + 50 open, 50 closed
    assert tr.value == pytest.approx(50 / 150)


def test_relative_to_driver_baseline() -> None:
    """The same absolute EAR is 'closed' for a wide-eyed driver but 'open' for a narrow-eyed one."""
    wide, narrow = PerclosTracker(), PerclosTracker()
    feed(wide, [0.34] * 50 + [0.20] * 50)
    feed(narrow, [0.21] * 50 + [0.20] * 50)
    assert wide.value > 0.3
    assert narrow.value == pytest.approx(0.0)


def test_window_expires_old_samples() -> None:
    tr = PerclosTracker(window_s=5)
    t = feed(tr, [0.30] * 30)
    t = feed(tr, [0.05] * 30, start=t)  # 3 s closed
    assert tr.value > 0.4
    feed(tr, [0.30] * 100, start=t)  # 10 s open: closed samples age out
    assert tr.value == pytest.approx(0.0)


def test_mark_no_face_expires_window() -> None:
    tr = PerclosTracker(window_s=5)
    t = feed(tr, [0.30] * 30 + [0.05] * 20)
    tr.mark_no_face(t + 10)
    assert tr.value == 0.0


def test_invalid_ratio() -> None:
    with pytest.raises(ValueError):
        PerclosTracker(closure_ratio=1.5)


def test_narrow_eyes_noisy_frame_does_not_restart_closure() -> None:
    """Narrow eyes: small open/closed gap, so landmark noise used to reset the microsleep timer."""
    tr = PerclosTracker()
    t = feed(tr, [0.17, 0.18, 0.16] * 30)  # narrow open eyes, ~0.17
    start = t
    # closed (~0.09) with one noisy frame that looks just above the cut-off (0.125)
    t = feed(tr, [0.09] * 8 + [0.13] + [0.09] * 15, start=t)
    assert tr.closed_for(t) == pytest.approx(t - start, abs=0.15)
    # hysteresis: 0.13 is not "clearly open" for a 0.17 eye, so the closure goes on
    t = feed(tr, [0.13] * 3 + [0.09] * 3, start=t)
    assert tr.closed_for(t) >= 2.4
    t = feed(tr, [0.17] * 5, start=t)  # really open
    assert tr.closed_for(t) == 0


def test_unreliable_frames_never_count_as_closed() -> None:
    tr = PerclosTracker()
    t = feed(tr, [0.30] * 100)
    base = tr.baseline
    for _ in range(30):  # face turning back into view: EAR reads low
        tr.update(0.05, t, reliable=False)
        t += 0.1
    assert tr.closed_for(t) == 0 and tr.value == 0 and tr.baseline == base


def test_lost_face_drops_the_turning_away_frames_and_needs_coverage() -> None:
    tr = PerclosTracker(window_s=30)
    t = feed(tr, [0.30] * 50)
    t = feed(tr, [0.06] * 5, start=t)  # ducking out of view: last 0.5 s look closed
    tr.mark_no_face(t)
    tr.mark_no_face(t + 5)
    assert tr.value == 0.0
    # back after the window has gone by: 2 samples are not a PERCLOS
    tr2 = PerclosTracker(window_s=5)
    t = feed(tr2, [0.30] * 50)
    tr2.mark_no_face(t + 20)
    feed(tr2, [0.06, 0.06], start=t + 20)
    assert tr2.value == 0.0
