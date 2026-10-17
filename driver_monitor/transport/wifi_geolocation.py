"""Location from nearby Wi-Fi networks through the Google Geolocation API (no GPS module needed).

The device scans the Wi-Fi access points around it (it does not connect to them) and Google
answers with an estimated position and its accuracy (~20-100 m in cities, poor on open roads).

- Needs internet for every fix, so it is a *fallback*: with a GPS receiver configured it is only
  asked while the GPS has no fix (start-up, garages). See transport/gps.py make_location_source.
- Billed per request by Google, so it is polled slowly (GEOLOCATION_EVERY_S, default 90 s).
- The API key lives only in driver_monitor/.env (GOOGLE_GEOLOCATION_KEY), restricted to the
  Geolocation API in Google Cloud Console. It is never sent anywhere but Google.

Scanning: `nmcli` on the Raspberry Pi / Linux, `netsh wlan` on Windows.
"""

from __future__ import annotations

import re
import subprocess
import sys
import threading
import time
from collections.abc import Callable
from typing import Any

import requests
from loguru import logger as log

GEOLOCATE_URL = "https://www.googleapis.com/geolocation/v1/geolocate"
BSSID = re.compile(r"^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$", re.I)

AccessPoint = dict[str, Any]  # {"macAddress": "aa:bb:..", "signalStrength": -60}


def percent_to_dbm(percent: float) -> int:
    """Signal quality 0-100 % (nmcli / netsh) → approximate dBm (-100 .. -50)."""
    return int(round(min(100.0, max(0.0, percent)) / 2 - 100))


def parse_nmcli(text: str) -> list[AccessPoint]:
    """`nmcli -t -f BSSID,SIGNAL dev wifi list` → access points (colons in BSSID are escaped)."""
    out = []
    for line in text.splitlines():
        line = line.strip().replace("\\:", "-")
        if not line or ":" not in line:
            continue
        bssid, _, signal = line.rpartition(":")
        bssid = bssid.replace("-", ":").lower()
        if BSSID.match(bssid) and signal.isdigit():
            out.append({"macAddress": bssid, "signalStrength": percent_to_dbm(int(signal))})
    return out


def parse_netsh(text: str) -> list[AccessPoint]:
    """`netsh wlan show networks mode=bssid` → access points."""
    out: list[AccessPoint] = []
    bssid: str | None = None
    for raw in text.splitlines():
        key, _, value = raw.partition(":")
        key, value = key.strip().lower(), value.strip()
        if key.startswith("bssid"):
            # "BSSID 1 : aa:bb:cc:dd:ee:ff" — partition split at the first colon only
            candidate = raw.split(":", 1)[1].strip().lower()
            bssid = candidate if BSSID.match(candidate) else None
        elif key == "signal" and bssid and value.endswith("%"):
            try:
                out.append({"macAddress": bssid, "signalStrength": percent_to_dbm(float(value[:-1]))})
            except ValueError:
                pass
            bssid = None
    return out


def scan_access_points() -> list[AccessPoint]:
    """Visible Wi-Fi access points on this device (empty if Wi-Fi is off / no tool)."""
    if sys.platform == "win32":
        cmd = ["netsh", "wlan", "show", "networks", "mode=bssid"]
        parse = parse_netsh
    else:
        cmd = ["nmcli", "-t", "-f", "BSSID,SIGNAL", "dev", "wifi", "list", "--rescan", "auto"]
        parse = parse_nmcli
    try:
        text = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=20,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    # Strongest first; Google uses up to a few dozen.
    return sorted(parse(text), key=lambda ap: -ap["signalStrength"])[:30]


def geolocate(
    key: str, aps: list[AccessPoint], session: Any = requests, timeout: float = 10.0
) -> dict | None:
    """Ask Google where these access points are. Returns {lat, lng, accuracy} or None."""
    body: dict[str, Any] = {"considerIp": len(aps) < 2}  # Google needs ≥ 2 APs; else coarse IP
    if len(aps) >= 2:
        body["wifiAccessPoints"] = aps
    r = session.post(GEOLOCATE_URL, params={"key": key}, json=body, timeout=timeout)
    if r.status_code != 200:
        reason = ""
        try:
            reason = r.json()["error"]["errors"][0]["reason"]
        except (ValueError, KeyError, IndexError, TypeError):
            pass
        raise GeolocationError(r.status_code, reason)
    data = r.json()
    loc = data.get("location") or {}
    if not isinstance(loc.get("lat"), int | float) or not isinstance(loc.get("lng"), int | float):
        return None
    fix: dict[str, Any] = {"lat": round(loc["lat"], 6), "lng": round(loc["lng"], 6)}
    if isinstance(data.get("accuracy"), int | float):
        fix["accuracy"] = round(float(data["accuracy"]), 1)
    return fix


class GeolocationError(Exception):
    def __init__(self, status: int, reason: str = "") -> None:
        super().__init__(f"Google Geolocation {status} {reason}".strip())
        self.status = status
        self.reason = reason


class GoogleWifiLocation:
    """Polls Google every `every_s` while `wanted()` (e.g. "the GPS has no fix") is true."""

    STALE_S = 300.0

    def __init__(
        self,
        key: str,
        every_s: float = 90.0,
        wanted: Callable[[], bool] | None = None,
        scan: Callable[[], list[AccessPoint]] = scan_access_points,
        session: Any = requests,
        start: bool = True,
    ) -> None:
        self.key = key
        self.every_s = max(30.0, every_s)
        self.wanted = wanted or (lambda: True)
        self.scan = scan
        self.session = session
        self._fix: dict[str, Any] | None = None
        self._at = 0.0
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._warned = False
        if start:
            threading.Thread(target=self._loop, daemon=True).start()

    def poll_once(self) -> dict[str, Any] | None:
        try:
            fix = geolocate(self.key, self.scan(), self.session)
        except GeolocationError as exc:
            if not self._warned:  # bad key / API not enabled / no billing: say it once
                log.warning(f"Wi-Fi location unavailable: {exc}")
                self._warned = True
            return None
        except requests.RequestException:
            return None  # offline: try again next round
        if fix:
            with self._lock:
                self._fix, self._at = fix, time.monotonic()
        return fix

    def _loop(self) -> None:
        while not self._stop.is_set():
            if self.wanted():
                self.poll_once()
            self._stop.wait(self.every_s)

    def current(self) -> dict[str, Any] | None:
        with self._lock:
            if self._fix is None or time.monotonic() - self._at > self.STALE_S:
                return None
            return dict(self._fix)

    def close(self) -> None:
        self._stop.set()
