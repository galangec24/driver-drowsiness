"""Yawns, BLE heart-rate parsing/HRV/baseline, and the in-car watch alert policy."""

import pytest

from detectors.mouth import CORNERS, VERTICAL_PAIRS, YawnDetector, mouth_aspect_ratio
from detectors.perclos import PerclosTracker
from fusion.watch_alerts import HIGH, MILD, NONE, WatchAlerter
from sensors.heart_rate import HeartRateState, HrmPacket, parse_hrm, rmssd

# ----------------------------------------------------------------------------- mouth / yawns


def mouth(opening: float, width: float = 60.0) -> list[tuple[float, float]]:
    pts = [(0.0, 0.0)] * 478
    pts[CORNERS[0]] = (100.0, 200.0)
    pts[CORNERS[1]] = (100.0 + width, 200.0)
    for up, lo in VERTICAL_PAIRS:
        pts[up] = (130.0, 200.0 - opening / 2)
        pts[lo] = (130.0, 200.0 + opening / 2)
    return pts


def test_mar_closed_talking_yawning() -> None:
    assert mouth_aspect_ratio(mouth(0)) == pytest.approx(0)
    assert mouth_aspect_ratio(mouth(15)) == pytest.approx(0.25)
    assert mouth_aspect_ratio(mouth(45)) == pytest.approx(0.75)


def feed(det: YawnDetector, mar: float, start: float, seconds: float, hz: float = 10) -> float:
    t = start
    for _ in range(int(seconds * hz)):
        det.update(mar, t)
        t += 1 / hz
    return t


def test_long_wide_opening_is_one_yawn_talking_is_not() -> None:
    det = YawnDetector()
    t = feed(det, 0.3, 0, 10)  # talking: never wide
    t = feed(det, 0.7, t, 0.8)  # a laugh: wide but short
    t = feed(det, 0.1, t, 1)
    assert det.count(t) == 0
    t = feed(det, 0.75, t, 4)  # a real 4-second yawn …
    assert det.count(t) == 1 and det.yawning
    t = feed(det, 0.45, t, 1)  # … still between the thresholds (hysteresis): same yawn
    assert det.count(t) == 1
    t = feed(det, 0.1, t, 1)
    assert not det.yawning


def test_yawns_expire_after_the_window() -> None:
    det = YawnDetector(window_s=300)
    t = 0.0
    for _ in range(3):
        t = feed(det, 0.8, t, 2)
        t = feed(det, 0.05, t, 5)
    assert det.count(t) == 3
    assert det.count(t + 300) == 0


def test_lost_face_ends_a_yawn() -> None:
    det = YawnDetector()
    t = feed(det, 0.8, 0, 1)
    det.update(None, t)
    feed(det, 0.8, t + 0.1, 1)
    assert det.count(t + 2) == 0


# ----------------------------------------------------------------------------- BLE heart rate


def test_parse_hrm_uint8_with_contact_and_rr() -> None:
    # flags: contact supported+detected (0x06) | RR present (0x10); HR 72; RR 1024 → 1000 ms, 820 → ~800.8 ms
    pkt = parse_hrm(bytes([0x16, 72, 0x00, 0x04, 0x34, 0x03]))
    assert pkt.heart_rate == 72
    assert pkt.contact_supported and pkt.contact is True
    assert pkt.rr_ms == pytest.approx((1000.0, 820 * 1000 / 1024))


def test_parse_hrm_uint16_energy_no_contact_support() -> None:
    pkt = parse_hrm(bytes([0x09, 0x2C, 0x01, 0x10, 0x00]))  # uint16 HR 300?? + energy 16
    assert pkt.heart_rate == 300 and pkt.energy_kj == 16
    assert pkt.contact is None
    with pytest.raises(ValueError):
        parse_hrm(b"\x00")


def test_rmssd() -> None:
    assert rmssd([800, 810]) is None
    assert rmssd([800, 820, 800, 820]) == pytest.approx(20.0)


def beat(
    state: HeartRateState, hr: int, t: float, rr: tuple[float, ...] = (), contact: bool | None = True
) -> None:
    state.add(HrmPacket(hr, contact is not None, contact, rr), now=t)


def test_snapshot_goes_stale_and_ignores_no_contact() -> None:
    s = HeartRateState()
    assert s.snapshot(now=0) == {"heartRate": 0}
    beat(s, 70, 10)
    assert s.snapshot(now=11)["heartRate"] == 70
    beat(s, 40, 12, contact=False)  # strap lifted: ignored
    assert s.snapshot(now=12)["heartRate"] == 70
    assert s.snapshot(now=20) == {"heartRate": 0}  # stale after 5 s


def test_rr_artifacts_are_rejected_before_hrv() -> None:
    s = HeartRateState()
    t = 0.0
    for rr in (800, 810, 790, 805, 2000, 400, 795, 300):  # 2000/400/300 are artefacts
        beat(s, 75, t, (rr,))
        t += 0.8
    snap = s.snapshot(now=t)
    assert snap["hrv"] < 20


def test_personal_baseline_from_the_first_minutes() -> None:
    s = HeartRateState(baseline_s=180)
    t = 0.0
    while t < 181:
        beat(s, 78 if int(t) % 2 else 76, t, (780.0, 790.0))
        t += 1
    snap = s.snapshot(now=t - 1)
    assert snap["hrBaseline"] == pytest.approx(77, abs=1)
    # later drop doesn't move the baseline (that is the signal)
    for _ in range(60):
        beat(s, 64, t)
        t += 1
    assert s.snapshot(now=t - 1)["hrBaseline"] == pytest.approx(77, abs=1)


# ----------------------------------------------------------------------------- watch alerts


class Watch:
    def __init__(self) -> None:
        self.levels: list[int] = []

    def __call__(self, level: int) -> None:
        self.levels.append(level)


def test_microsleep_vibrates_immediately_without_backend() -> None:
    w = Watch()
    a = WatchAlerter(send=w, drowsy_duration_s=2.0)
    assert a.on_frame(closed_for_s=1.5, perclos=0.1, now=0) == NONE
    assert a.on_frame(closed_for_s=2.1, perclos=0.1, now=0.1) == HIGH
    assert w.levels == [HIGH]
    # held: not re-sent every frame, only after repeat_s
    a.on_frame(3.0, 0.1, 1.0)
    a.on_frame(17.0, 0.1, 15.2)
    assert w.levels == [HIGH, HIGH]
    # eyes open again → stop after calm_s
    a.on_frame(0, 0.1, 20)
    a.on_frame(0, 0.1, 26)
    assert w.levels[-1] == NONE


def test_backend_verdicts_and_offline_fallback() -> None:
    w = Watch()
    a = WatchAlerter(send=w)
    a.on_backend({"classification": "warning"}, now=0)
    assert a.on_frame(0, 0.1, 0.5) == MILD
    a.on_backend({"classification": "drowsy"}, now=1)
    assert a.on_frame(0, 0.1, 1.2) == HIGH  # escalation is sent at once
    # backend silent for > 5 s and PERCLOS high → local HIGH keeps going
    assert a.on_frame(0, 0.5, 30) == HIGH
    assert w.levels == [MILD, HIGH, HIGH]


def test_thresholds_from_backend_are_applied() -> None:
    a = WatchAlerter(send=Watch())
    a.apply_thresholds({"drowsyDurationMs": 1500, "perclosThreshold": 0.3})
    assert a.drowsy_duration_s == 1.5 and a.perclos_threshold == 0.3


def test_perclos_tracker_times_continuous_closure() -> None:
    p = PerclosTracker(min_baseline_samples=3)
    t = 0.0
    for _ in range(10):
        p.update(0.3, t)
        t += 0.1
    assert p.closed_for(t) == 0
    start = t
    for _ in range(25):
        p.update(0.05, t)
        t += 0.1
    assert p.closed_for(t) == pytest.approx(t - start)
    p.update(0.3, t)
    assert p.closed_for(t) == 0


# ----------------------------------------------------------------------------- dashboard radar


def test_parse_vitals_packet() -> None:
    from sensors.heart_rate import parse_vitals

    # 14.5 breaths/min (145), 82 cm, present
    pkt = parse_vitals(bytes([145, 0, 82, 0, 1]))
    assert pkt.breathing_rate == 14.5 and pkt.distance_cm == 82 and pkt.present
    with pytest.raises(ValueError):
        parse_vitals(b"\x00\x00")


def test_breathing_baseline_and_absence() -> None:
    from sensors.heart_rate import BreathingState, VitalsPacket

    s = BreathingState(baseline_s=180)
    t = 0.0
    while t < 181:
        s.add(VitalsPacket(16.0, 80, True), now=t)
        t += 1
    assert s.snapshot(now=t) == {"breathingRate": 16.0, "breathingBaseline": 16.0}
    s.add(VitalsPacket(11.0, 80, True), now=t)  # slowing down: baseline stays
    assert s.snapshot(now=t)["breathingBaseline"] == 16.0
    s.add(VitalsPacket(0.0, 0, False), now=t + 1)  # driver out of range
    assert s.present is False
    assert s.snapshot(now=t + 10) == {}  # stale


def test_heart_source_priority_falls_back() -> None:
    from sensors.heart_rate import pick_heart

    radar, watch = HeartRateState(), HeartRateState()
    beat(watch, 70, 0)
    assert pick_heart([radar, watch], now=1)["heartRate"] == 70  # radar silent → watch
    beat(radar, 66, 1, contact=True)
    assert pick_heart([radar, watch], now=2)["heartRate"] == 66  # radar first when fresh
    assert pick_heart([radar, watch], now=60) == {"heartRate": 0}


def test_head_nod_vibrates_immediately() -> None:
    w = Watch()
    a = WatchAlerter(send=w)
    assert a.on_frame(0, 0.05, 0, nodded=True) == HIGH
    assert w.levels == [HIGH] and a.last_reason == "head nod"
