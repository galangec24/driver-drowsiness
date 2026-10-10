"""Vehicle location for the optional ingest "location" field.

GPS_SOURCE=none   no location (default)
GPS_SOURCE=fixed  GPS_FIXED=lat,lng, for a parked demo rig or testing the parent map
GPS_SOURCE=nmea   USB/serial GPS receiver (GPS_PORT=COM5, GPS_BAUD=9600); needs `pip install pyserial`

Only $..RMC sentences are used: they carry position, speed and course in one line.
"""

from __future__ import annotations

import threading
import time
from typing import Any, Protocol

KNOTS_TO_KMH = 1.852
STALE_AFTER_S = 10.0  # a receiver that stopped reporting must not pin an old position


class LocationSource(Protocol):
    def current(self) -> dict[str, Any] | None: ...

    def close(self) -> None: ...


def nmea_checksum_ok(sentence: str) -> bool:
    if not sentence.startswith("$") or "*" not in sentence:
        return False
    body, _, given = sentence[1:].partition("*")
    calc = 0
    for ch in body:
        calc ^= ord(ch)
    try:
        return calc == int(given[:2], 16)
    except ValueError:
        return False


def _coord(value: str, hemi: str, deg_digits: int) -> float:
    deg = float(value[:deg_digits])
    minutes = float(value[deg_digits:])
    out = deg + minutes / 60.0
    return -out if hemi in ("S", "W") else out


def parse_rmc(sentence: str) -> dict[str, Any] | None:
    """$GPRMC/$GNRMC → {lat, lng, speed km/h, heading°}; None for invalid/no-fix sentences."""
    sentence = sentence.strip()
    if not nmea_checksum_ok(sentence):
        return None
    fields = sentence[1:].split("*")[0].split(",")
    if len(fields) < 9 or not fields[0].endswith("RMC") or fields[2] != "A":
        return None
    try:
        fix: dict[str, Any] = {
            "lat": round(_coord(fields[3], fields[4], 2), 6),
            "lng": round(_coord(fields[5], fields[6], 3), 6),
        }
        if fields[7]:
            fix["speed"] = round(float(fields[7]) * KNOTS_TO_KMH, 1)
        if fields[8]:
            fix["heading"] = round(float(fields[8]) % 360, 1)
    except (ValueError, IndexError):
        return None
    return fix


class NoLocation:
    def current(self) -> dict[str, Any] | None:
        return None

    def close(self) -> None:
        pass


class FixedLocation:
    def __init__(self, lat: float, lng: float) -> None:
        self.fix = {"lat": lat, "lng": lng}

    def current(self) -> dict[str, Any] | None:
        return dict(self.fix)

    def close(self) -> None:
        pass


class NmeaGps:
    """Reads a serial NMEA receiver on a background thread; current() returns the latest fix."""

    def __init__(self, port: str, baud: int = 9600) -> None:
        try:
            import serial  # pyserial (optional dependency)
        except ImportError as exc:
            raise SystemExit("GPS_SOURCE=nmea needs pyserial: pip install pyserial") from exc
        self._serial = serial.Serial(port, baud, timeout=1)
        self._fix: dict[str, Any] | None = None
        self._at = 0.0
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._read, daemon=True)
        self._thread.start()

    def _read(self) -> None:
        while not self._stop.is_set():
            try:
                line = self._serial.readline().decode("ascii", errors="ignore")
            except Exception:  # noqa: BLE001 - unplugged receiver: keep the monitor running
                time.sleep(1)
                continue
            fix = parse_rmc(line) if "RMC" in line else None
            if fix:
                with self._lock:
                    self._fix, self._at = fix, time.monotonic()

    def current(self) -> dict[str, Any] | None:
        with self._lock:
            if self._fix is None or time.monotonic() - self._at > STALE_AFTER_S:
                return None
            return dict(self._fix)

    def close(self) -> None:
        self._stop.set()
        self._serial.close()


def parse_latlng(text: str) -> tuple[float, float] | None:
    try:
        lat, lng = (float(x) for x in text.split(","))
    except ValueError:
        return None
    return (lat, lng) if -90 <= lat <= 90 and -180 <= lng <= 180 else None


def make_location_source(source: str, fixed: str = "", port: str = "", baud: int = 9600) -> LocationSource:
    source = source.lower()
    if source == "fixed":
        latlng = parse_latlng(fixed)
        if latlng is None:
            raise SystemExit("GPS_SOURCE=fixed needs GPS_FIXED=lat,lng (e.g. 14.5547,121.0244)")
        return FixedLocation(*latlng)
    if source == "nmea":
        if not port:
            raise SystemExit("GPS_SOURCE=nmea needs GPS_PORT (e.g. COM5 or /dev/ttyACM0)")
        return NmeaGps(port, baud)
    return NoLocation()
