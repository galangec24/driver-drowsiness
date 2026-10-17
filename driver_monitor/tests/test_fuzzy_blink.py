"""Fuzzy-logic fatigue (combinations of signs), blink counting, and the Google Wi-Fi location."""

from __future__ import annotations

from typing import Any

import pytest

from detectors.blink import BlinkDetector
from fusion.fuzzy import FatigueFuzzy, trap
from fusion.watch_alerts import HIGH, MILD, NONE, WatchAlerter
from transport.gps import FallbackLocation, FixedLocation, NoLocation
from transport.wifi_geolocation import (
    GeolocationError,
    GoogleWifiLocation,
    geolocate,
    parse_netsh,
    parse_nmcli,
)

CALM: dict[str, Any] = dict(perclos=0.05, closure_s=0.0, blink_rate=15, long_blinks=0, yawns=0, nods=0)


def fz(**over: Any):
    return FatigueFuzzy().evaluate(**{**CALM, **over})


# ----------------------------------------------------------------------------- fuzzy rules
def test_trapezoid_membership() -> None:
    assert trap(5, (0, 10, 20, 30)) == 0.5
    assert trap(15, (0, 10, 20, 30)) == 1.0
    assert trap(25, (0, 10, 20, 30)) == 0.5
    assert trap(31, (0, 10, 20, 30)) == 0.0


def test_calm_driver_is_awake() -> None:
    r = fz()
    assert r.level == 0 and r.score < 0.3 and r.reason == ""


@pytest.mark.parametrize(
    "signs",
    [
        {"blink_rate": 35},  # talking / dry eyes: blinking a lot on its own is not fatigue
        {"yawns": 1},  # one yawn
        {"long_blinks": 1},  # one slow blink
    ],
)
def test_one_mild_sign_alone_is_not_an_alarm(signs: dict[str, Any]) -> None:
    assert fz(**signs).level == 0


@pytest.mark.parametrize(
    ("signs", "level", "reason"),
    [
        ({"blink_rate": 32, "yawns": 3}, 2, "frequent blinking and repeated yawning"),
        ({"long_blinks": 5, "yawns": 1}, 2, "slow blinks and yawning"),
        ({"yawns": 3, "perclos": 0.3}, 2, "yawning, eyes closing more"),
        ({"blink_rate": 32, "yawns": 1}, 1, "frequent blinking and yawning"),
        ({"long_blinks": 2, "yawns": 1}, 1, "slow blinks and a yawn"),
        ({"long_blinks": 6}, 1, "many slow blinks"),
        ({"yawns": 4}, 1, "repeated yawning"),
    ],
)
def test_combinations_of_signs(signs: dict[str, Any], level: int, reason: str) -> None:
    r = fz(**signs)
    assert r.level == level, (r.score, r.fired)
    assert r.reason == reason


def test_strong_single_signs_are_drowsy() -> None:
    assert fz(perclos=0.6).level == 2
    assert fz(closure_s=2.5).level == 2
    assert fz(nods=2).level == 2


def test_limits_follow_the_drivers_tuned_thresholds() -> None:
    strict, relaxed = FatigueFuzzy(perclos_limit=0.3), FatigueFuzzy(perclos_limit=0.55)
    assert strict.evaluate(**{**CALM, "perclos": 0.35}).level == 2
    assert relaxed.evaluate(**{**CALM, "perclos": 0.35}).level <= 1


def test_unmeasured_signs_are_left_out() -> None:
    r = FatigueFuzzy().evaluate(
        perclos=None, closure_s=None, blink_rate=None, long_blinks=None, yawns=0, nods=0
    )
    assert r.level == 0


def test_in_car_alarm_uses_fuzzy_fatigue() -> None:
    a = WatchAlerter(send=lambda _l: None)
    assert a.on_frame(0, 0, 0.0, fatigue=0.5, fatigue_reason="slow blinks and a yawn") == MILD
    assert a.reason_now == "fatigue: slow blinks and a yawn"
    assert a.on_frame(0, 0, 1.0, fatigue=0.82, fatigue_reason="x") == HIGH
    assert a.on_frame(0, 0, 30.0, fatigue=0.1) == NONE


# ----------------------------------------------------------------------------- blinks
def feed(
    det: BlinkDetector, pattern: list[tuple[bool | None, float]], t: float = 0.0, dt: float = 0.1
) -> float:
    """pattern: (closed, seconds) segments sampled at 10 Hz."""
    for closed, seconds in pattern:
        for _ in range(round(seconds / dt)):
            det.update(closed, t)
            t += dt
    return t


def test_blink_rate_and_slow_blinks() -> None:
    det = BlinkDetector()
    t = 0.0
    for _ in range(10):  # 10 normal blinks (0.2 s) in 30 s
        t = feed(det, [(False, 2.8), (True, 0.2)], t)
    assert det.rate(t) == pytest.approx(20, rel=0.1)
    assert det.long_blinks(t) == 0
    for _ in range(3):  # three slow, heavy blinks (0.8 s)
        t = feed(det, [(False, 2.0), (True, 0.8)], t)
    t = feed(det, [(False, 0.5)], t)
    assert det.long_blinks(t) == 3
    # a 3 s closure is a microsleep, not a blink
    t = feed(det, [(True, 3.0), (False, 0.5)], t)
    assert det.long_blinks(t) == 3


def test_no_rate_until_enough_is_watched_and_gaps_dont_count() -> None:
    det = BlinkDetector()
    t = feed(det, [(False, 5), (True, 0.2), (False, 5)])
    assert det.rate(t) is None  # 10 s watched < 20 s
    # a closure cut by the face disappearing is not counted as a blink
    t = feed(det, [(True, 0.3), (None, 3), (False, 15)], t)
    assert det.rate(t) == pytest.approx(60 / 25.3, rel=0.15)


# ----------------------------------------------------------------------------- Google Wi-Fi location
NETSH = """
SSID 1 : Home
    Network type            : Infrastructure
    BSSID 1                 : aa:bb:cc:dd:ee:01
         Signal             : 80%
    BSSID 2                 : AA:BB:CC:DD:EE:02
         Signal             : 40%
"""


def test_wifi_scans_are_parsed() -> None:
    assert parse_netsh(NETSH) == [
        {"macAddress": "aa:bb:cc:dd:ee:01", "signalStrength": -60},
        {"macAddress": "aa:bb:cc:dd:ee:02", "signalStrength": -80},
    ]
    assert parse_nmcli("AA\\:BB\\:CC\\:DD\\:EE\\:03:70\nbad line\n") == [
        {"macAddress": "aa:bb:cc:dd:ee:03", "signalStrength": -65}
    ]


class FakeResponse:
    def __init__(self, status: int, body: dict[str, Any]) -> None:
        self.status_code = status
        self._body = body

    def json(self) -> dict[str, Any]:
        return self._body


class FakeSession:
    def __init__(self, response: FakeResponse) -> None:
        self.response = response
        self.calls: list[dict[str, Any]] = []

    def post(self, url: str, **kw: Any) -> FakeResponse:
        self.calls.append({"url": url, **kw})
        return self.response


APS = parse_netsh(NETSH)


def test_geolocate_sends_the_access_points_and_reads_the_fix() -> None:
    s = FakeSession(FakeResponse(200, {"location": {"lat": 14.5547, "lng": 121.0244}, "accuracy": 35}))
    assert geolocate("KEY", APS, s) == {"lat": 14.5547, "lng": 121.0244, "accuracy": 35.0}
    call = s.calls[0]
    assert call["params"] == {"key": "KEY"}
    assert call["json"] == {"considerIp": False, "wifiAccessPoints": APS}


def test_geolocate_errors_are_reported() -> None:
    s = FakeSession(FakeResponse(403, {"error": {"errors": [{"reason": "keyInvalid"}]}}))
    with pytest.raises(GeolocationError, match="403 keyInvalid"):
        geolocate("BAD", APS, s)


def test_google_is_only_asked_while_the_gps_has_no_fix() -> None:
    s = FakeSession(FakeResponse(200, {"location": {"lat": 1.0, "lng": 2.0}, "accuracy": 50}))
    gps: Any = NoLocation()
    wifi = GoogleWifiLocation(
        "KEY", wanted=lambda: gps.current() is None, scan=lambda: APS, session=s, start=False
    )
    loc = FallbackLocation(gps, wifi)
    assert wifi.wanted() and wifi.poll_once() == {"lat": 1.0, "lng": 2.0, "accuracy": 50.0}
    assert loc.current() == {"lat": 1.0, "lng": 2.0, "accuracy": 50.0}
    gps = FixedLocation(14.5, 121.0)  # GPS got a fix
    loc.primary = gps
    assert not wifi.wanted()
    assert loc.current() == {"lat": 14.5, "lng": 121.0}


# ----------------------------------------------------------------------------- recovery
def test_alarm_steps_down_within_seconds_when_awake_again() -> None:
    sent: list[int] = []
    a = WatchAlerter(send=sent.append)
    assert a.on_frame(2.5, 0.0, 0.0) == HIGH  # eyes closed 2.5 s
    assert a.on_frame(0, 0, 1.0, restless=True) == HIGH  # milder reason only: still held briefly
    assert a.on_frame(0, 0, 3.5, restless=True) == MILD  # DROWSY → WARNING after calm_s
    assert a.on_frame(0, 0, 7.0) == NONE  # normal face → normal
    assert sent == [HIGH, MILD, NONE]


def test_perclos_for_alarms_recovers_when_eyes_stay_open() -> None:
    from detectors.perclos import PerclosTracker

    p = PerclosTracker()
    t = 0.0
    for i in range(300):  # 30 s: eyes closed half the time
        p.update(0.3 if i < 50 or i % 2 else 0.05, t)
        t += 0.1
    assert p.value > 0.35 and p.effective(t) > 0.35
    for _ in range(110):  # 11 s eyes open
        p.update(0.3, t)
        t += 0.1
    assert p.value > 0.2  # the 30 s window still remembers
    assert p.effective(t) == 0.0  # but the driver is fine now


def test_old_yawns_and_nods_fade() -> None:
    from detectors.head_nod import NodDetector

    n = NodDetector()
    n._events.extend([0.0, 1.0])  # two nods
    assert n.recent(1.0) == pytest.approx(1.98, abs=0.01)
    assert n.count(61.0) == 2  # the parent's 5-minute count
    assert n.recent(61.0) < 0.6  # but a minute later they barely count
    calm_again = FatigueFuzzy().evaluate(**{**CALM, "nods": n.recent(61.0)})
    assert calm_again.level == 0
