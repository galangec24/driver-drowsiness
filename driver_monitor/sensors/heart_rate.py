"""Heart rate from a Bluetooth LE wearable (standard Heart Rate Service, 0x180D).

parse_hrm()      decodes the Heart Rate Measurement characteristic (0x2A37) exactly as the
                 Bluetooth spec defines it, so our ESP32 watch and commercial straps/watches
                 that broadcast standard HR (Polar, Coospo, Garmin "HR broadcast", ...) all work.
HeartRateState   keeps the latest HR, cleans RR intervals, computes HRV (RMSSD) and a per-session
                 personal baseline: the median of the first few minutes of good contact, when the
                 driver is fresh. Drowsiness shows as HR falling below it and HRV rising above it.
"""

from __future__ import annotations

import math
import statistics
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any

# Physiological limits for a seated driver; anything outside is a sensor artefact.
RR_MIN_MS, RR_MAX_MS = 300.0, 1500.0  # 200 … 40 bpm
HR_MIN, HR_MAX = 35, 200
RR_MAX_JUMP = 0.25  # reject beats that differ > 25 % from the recent median (motion artefacts)


@dataclass(frozen=True)
class HrmPacket:
    heart_rate: int
    contact_supported: bool
    contact: bool | None  # None when the sensor doesn't report contact
    rr_ms: tuple[float, ...] = ()
    energy_kj: int | None = None


def parse_hrm(data: bytes | bytearray) -> HrmPacket:
    """Decode a Heart Rate Measurement (0x2A37) notification."""
    if len(data) < 2:
        raise ValueError("HRM packet too short")
    flags = data[0]
    i = 1
    if flags & 0x01:  # HR as uint16
        hr = int.from_bytes(data[i : i + 2], "little")
        i += 2
    else:
        hr = data[i]
        i += 1
    contact_supported = bool(flags & 0x04)
    contact = bool(flags & 0x02) if contact_supported else None
    energy = None
    if flags & 0x08:
        energy = int.from_bytes(data[i : i + 2], "little")
        i += 2
    rr: list[float] = []
    if flags & 0x10:
        while i + 1 < len(data):
            rr.append(int.from_bytes(data[i : i + 2], "little") * 1000.0 / 1024.0)
            i += 2
    return HrmPacket(hr, contact_supported, contact, tuple(rr), energy)


def rmssd(rr_ms: list[float]) -> float | None:
    """Root mean square of successive RR differences (ms), the standard short-term HRV measure."""
    if len(rr_ms) < 3:
        return None
    diffs = [b - a for a, b in zip(rr_ms, rr_ms[1:], strict=False)]
    return math.sqrt(sum(d * d for d in diffs) / len(diffs))


@dataclass
class HeartRateState:
    """Thread-safe: the BLE thread calls add(), the camera loop calls snapshot()."""

    baseline_s: float = 180.0  # fresh-driver period used for the personal baseline
    hrv_window_s: float = 60.0
    stale_after_s: float = 5.0
    rebaseline_after_s: float = 600.0  # a new wearer / new trip after 10 min without contact
    _hr: int | None = None
    _hr_at: float = 0.0
    _contact: bool | None = None
    _rr: deque[tuple[float, float]] = field(default_factory=deque)
    _base_hr: list[int] = field(default_factory=list)
    _base_hrv: list[float] = field(default_factory=list)
    _base_started: float | None = None
    hr_baseline: float | None = None
    hrv_baseline: float | None = None
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def add(self, pkt: HrmPacket, now: float | None = None) -> None:
        now = time.monotonic() if now is None else now
        with self._lock:
            if self._hr_at and now - self._hr_at > self.rebaseline_after_s:
                self._reset_baseline()
            self._contact = pkt.contact
            if pkt.contact is False or not HR_MIN <= pkt.heart_rate <= HR_MAX:
                return  # no skin contact / implausible: ignore, readings go stale
            self._hr, self._hr_at = pkt.heart_rate, now
            for rr in pkt.rr_ms:
                self._add_rr(rr, now)
            while self._rr and now - self._rr[0][0] > self.hrv_window_s:
                self._rr.popleft()
            self._update_baseline(now)

    def _add_rr(self, rr: float, now: float) -> None:
        if not RR_MIN_MS <= rr <= RR_MAX_MS:
            return
        recent = [v for _, v in list(self._rr)[-8:]]
        if len(recent) >= 3:
            med = statistics.median(recent)
            if abs(rr - med) / med > RR_MAX_JUMP:
                return
        self._rr.append((now, rr))

    def _update_baseline(self, now: float) -> None:
        if self.hr_baseline is not None:
            return
        if self._base_started is None:
            self._base_started = now
        self._base_hr.append(self._hr)  # type: ignore[arg-type]
        hrv = rmssd([v for _, v in self._rr])
        if hrv is not None:
            self._base_hrv.append(hrv)
        if now - self._base_started >= self.baseline_s and len(self._base_hr) >= 30:
            self.hr_baseline = float(statistics.median(self._base_hr))
            if len(self._base_hrv) >= 30:
                self.hrv_baseline = float(statistics.median(self._base_hrv))

    def _reset_baseline(self) -> None:
        self._base_hr.clear()
        self._base_hrv.clear()
        self._base_started = None
        self.hr_baseline = None
        self.hrv_baseline = None
        self._rr.clear()

    @property
    def contact(self) -> bool | None:
        return self._contact

    def snapshot(self, now: float | None = None) -> dict[str, Any]:
        """Signals for the ingest payload. heartRate 0 = no (fresh) reading, as the contract defines."""
        now = time.monotonic() if now is None else now
        with self._lock:
            if self._hr is None or now - self._hr_at > self.stale_after_s:
                return {"heartRate": 0}
            out: dict[str, Any] = {"heartRate": int(self._hr)}
            hrv = rmssd([v for _, v in self._rr])
            if hrv is not None:
                out["hrv"] = round(hrv, 1)
            if self.hr_baseline is not None:
                out["hrBaseline"] = round(self.hr_baseline, 1)
            if self.hrv_baseline is not None:
                out["hrvBaseline"] = round(self.hrv_baseline, 1)
            return out


# --------------------------------------------------------------------------- dashboard radar vitals


@dataclass(frozen=True)
class VitalsPacket:
    breathing_rate: float  # breaths/min, 0 = no reading
    distance_cm: float
    present: bool


def parse_vitals(data: bytes | bytearray) -> VitalsPacket:
    """Guardian Radar vitals characteristic: uint16 breaths/min x10, uint16 distance cm, uint8 flags."""
    if len(data) < 5:
        raise ValueError("vitals packet too short")
    return VitalsPacket(
        breathing_rate=int.from_bytes(data[0:2], "little") / 10.0,
        distance_cm=float(int.from_bytes(data[2:4], "little")),
        present=bool(data[4] & 0x01),
    )


@dataclass
class BreathingState:
    """Breathing rate from the dashboard radar with a per-trip personal baseline (like HeartRateState).

    Breathing slows as drowsiness sets in; the backend scores the drop below this baseline.
    """

    baseline_s: float = 180.0
    stale_after_s: float = 5.0
    rebaseline_after_s: float = 600.0
    present: bool = False
    distance_cm: float | None = None
    baseline: float | None = None
    _rate: float | None = None
    _at: float = 0.0
    _samples: list[float] = field(default_factory=list)
    _started: float | None = None
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def add(self, pkt: VitalsPacket, now: float | None = None) -> None:
        now = time.monotonic() if now is None else now
        with self._lock:
            self.present, self.distance_cm = pkt.present, pkt.distance_cm
            if not pkt.present or not 4 <= pkt.breathing_rate <= 40:
                return
            if self._at and now - self._at > self.rebaseline_after_s:
                self._samples.clear()
                self._started, self.baseline = None, None
            self._rate, self._at = pkt.breathing_rate, now
            if self.baseline is None:
                self._started = now if self._started is None else self._started
                self._samples.append(pkt.breathing_rate)
                if now - self._started >= self.baseline_s and len(self._samples) >= 30:
                    self.baseline = float(statistics.median(self._samples))

    def snapshot(self, now: float | None = None) -> dict[str, Any]:
        now = time.monotonic() if now is None else now
        with self._lock:
            if self._rate is None or now - self._at > self.stale_after_s:
                return {}
            out: dict[str, Any] = {"breathingRate": round(self._rate, 1)}
            if self.baseline is not None:
                out["breathingBaseline"] = round(self.baseline, 1)
            return out


def pick_heart(states: list[HeartRateState], now: float | None = None) -> dict[str, Any]:
    """Heart signals from the first source (in priority order) with a fresh reading."""
    for state in states:
        snap = state.snapshot(now)
        if snap.get("heartRate"):
            return snap
    return {"heartRate": 0}
