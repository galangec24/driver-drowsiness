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
