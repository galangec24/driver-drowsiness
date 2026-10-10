"""Head-nod detector: drowsy nods count, deliberate looking-down does not."""

from detectors.head_nod import NodDetector

HZ = 10


def run(det: NodDetector, t: float, seconds: float, pitch_fn, closed: bool = False) -> tuple[float, int]:
    """Feed `seconds` of samples; pitch_fn(elapsed) -> pitch. Returns (t, nods counted)."""
    nods = 0
    start = t
    for _ in range(int(seconds * HZ)):
        nods += det.update(pitch_fn(t - start), closed, t)
        t += 1 / HZ
    return t, nods


def upright(det: NodDetector, t: float = 0.0, seconds: float = 5.0, base: float = -5.0) -> float:
    t, _ = run(det, t, seconds, lambda _e: base)
    return t


def test_quick_fall_and_jerk_back_up_is_a_nod() -> None:
    det = NodDetector()
    t = upright(det)
    # head falls 25° in 0.4 s, hangs 0.5 s, snaps back in 0.3 s (eyes open, startled)
    t, a = run(det, t, 0.4, lambda e: -5 - 25 * e / 0.4)
    t, b = run(det, t, 0.5, lambda _e: -30)
    t, c = run(det, t, 0.4, lambda e: -30 + 25 * min(1, e / 0.3))
    assert a + b + c == 1
    assert det.count(t) == 1


def test_fall_with_eyes_closed_held_down_is_a_nod() -> None:
    det = NodDetector(max_down_s=3)
    t = upright(det)
    t, a = run(det, t, 0.4, lambda e: -5 - 20 * e / 0.4, closed=True)
    t, b = run(det, t, 4, lambda _e: -25, closed=True)  # stays down, asleep
    assert a + b == 1


def test_slowly_looking_down_at_the_console_is_not_a_nod() -> None:
    det = NodDetector()
    t = upright(det)
    t, a = run(det, t, 2.0, lambda e: -5 - 25 * e / 2.0)  # 12.5 °/s, deliberate
    t, b = run(det, t, 3, lambda _e: -30)
    t, c = run(det, t, 2.0, lambda e: -30 + 25 * e / 2.0)
    assert a + b + c == 0


def test_quick_glance_down_with_open_eyes_and_slow_return_is_not_a_nod() -> None:
    det = NodDetector()
    t = upright(det)
    t, a = run(det, t, 0.4, lambda e: -5 - 20 * e / 0.4)  # fast glance at the phone
    t, b = run(det, t, 1.5, lambda _e: -25)
    t, c = run(det, t, 1.5, lambda e: -25 + 20 * e / 1.5)  # calm return
    assert a + b + c == 0


def test_neutral_is_personal_and_camera_angle_independent() -> None:
    det = NodDetector()
    t = upright(det, base=12.0)  # camera mounted low: "upright" reads +12°
    assert abs(det.neutral - 12.0) < 0.01
    t, n = run(det, t, 0.4, lambda e: 12 - 22 * e / 0.4)  # reaches −10 (22° below neutral)
    t, m = run(det, t, 0.3, lambda e: -10 + 22 * min(1, e / 0.2))
    assert n + m == 1


def test_nods_expire_and_face_loss_resets() -> None:
    det = NodDetector(window_s=300)
    t = upright(det)
    t, _ = run(det, t, 0.3, lambda e: -5 - 20 * e / 0.3)
    det.update(None, False, t)  # face lost mid-fall: no guess
    t, n = run(det, t + 0.1, 0.3, lambda e: -25 + 20 * min(1, e / 0.2))
    assert n == 0
    assert det.count(t + 400) == 0
