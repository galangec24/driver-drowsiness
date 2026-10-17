"""GPS parsing, location in the payload, and alert snapshot encoding."""

import cv2
import numpy as np
import pytest

from transport.gps import FixedLocation, NoLocation, make_location_source, nmea_checksum_ok, parse_rmc
from transport.ingest_client import build_payload, encode_snapshot

DRIVER = "665f00000000000000000001"


def with_checksum(body: str) -> str:
    calc = 0
    for ch in body:
        calc ^= ord(ch)
    return f"${body}*{calc:02X}"


# Makati: 14°33.282' N, 121°01.464' E, 32.4 knots, course 84.4°
RMC = with_checksum("GNRMC,083559.00,A,1433.282,N,12101.464,E,32.4,84.4,081026,,,A")


def test_rmc_is_parsed_to_decimal_degrees_kmh_and_heading() -> None:
    fix = parse_rmc(RMC)
    assert fix == {
        "lat": pytest.approx(14.5547, abs=1e-4),
        "lng": pytest.approx(121.0244, abs=1e-4),
        "speed": 60.0,
        "heading": 84.4,
    }


def test_southern_and_western_hemispheres_are_negative() -> None:
    fix = parse_rmc(with_checksum("GPRMC,120000,A,3351.000,S,15112.000,W,0.0,,010125,,"))
    assert fix is not None and fix["lat"] < 0 and fix["lng"] < 0
    assert "heading" not in fix


def test_no_fix_bad_checksum_and_other_sentences_are_ignored() -> None:
    assert parse_rmc(with_checksum("GPRMC,120000,V,,,,,,,010125,,")) is None  # V = no fix
    assert parse_rmc(RMC[:-2] + "00") is None
    assert not nmea_checksum_ok("GPRMC,no-dollar")
    assert parse_rmc(with_checksum("GPGGA,120000,1433.282,N,12101.464,E,1,08,0.9,10,M,,M,,")) is None


def test_location_sources() -> None:
    assert isinstance(make_location_source("none"), NoLocation)
    fixed = make_location_source("fixed", "14.5547,121.0244")
    assert isinstance(fixed, FixedLocation) and fixed.current() == {"lat": 14.5547, "lng": 121.0244}
    with pytest.raises(SystemExit):
        make_location_source("fixed", "not-a-point")
    with pytest.raises(SystemExit):
        make_location_source("nmea", port="")


def test_location_is_appended_only_when_known() -> None:
    plain = build_payload(DRIVER, 0.3, 0.1, 0.9)
    assert list(plain) == ["driverId", "source", "signals", "timestamp"]
    located = build_payload(DRIVER, 0.3, 0.1, 0.9, location={"lat": 1.0, "lng": 2.0})
    assert list(located) == ["driverId", "source", "signals", "timestamp", "location"]


def test_snapshot_is_a_small_jpeg() -> None:
    frame = np.random.default_rng(0).integers(0, 255, (720, 1280, 3), dtype=np.uint8)
    jpeg = encode_snapshot(frame)
    assert jpeg[:2] == b"\xff\xd8"
    decoded = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
    assert decoded.shape[1] == 640 and decoded.shape[0] == 360


def test_windows_location_output_is_parsed() -> None:
    from transport.gps import parse_windows_fix

    assert parse_windows_fix("14.554729,121.024445,92\r\n") == {
        "lat": 14.554729,
        "lng": 121.024445,
        "accuracy": 92.0,
    }
    assert parse_windows_fix("unknown") is None
    assert parse_windows_fix("0,0,0") is None  # no fix yet
    assert parse_windows_fix("14,5547;121,02") is None  # never a decimal comma


def test_auto_source_off_windows_is_none(monkeypatch) -> None:
    import transport.gps as gps

    monkeypatch.setattr(gps.sys, "platform", "linux")
    assert isinstance(gps.make_location_source("auto"), gps.NoLocation)
