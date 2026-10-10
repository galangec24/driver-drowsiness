"""Bluetooth LE link to the wrist wearable (the Pi is the BLE central; no wires).

- Finds the watch by name (WEARABLE_NAME), address (WEARABLE_ADDRESS) or, if neither is set,
  any device advertising the standard Heart Rate Service.
- Subscribes to Heart Rate Measurement (0x2A37) → HeartRateState.
- Reads Battery Level (0x2A19) once a minute when the device has it.
- vibrate(level) writes Alert Level (0x2A06, Immediate Alert Service 0x1802): 0 off, 1 mild, 2 high.
  The Guardian watch firmware buzzes its motor; commercial HR straps simply don't have it.
- Reconnects forever with back-off; runs on its own thread + asyncio loop so the camera
  loop is never blocked.
"""

from __future__ import annotations

import asyncio
import threading
import time
from typing import Any

from sensors.heart_rate import BreathingState, HeartRateState, parse_hrm, parse_vitals

HRS_UUID = "0000180d-0000-1000-8000-00805f9b34fb"
HRM_UUID = "00002a37-0000-1000-8000-00805f9b34fb"
BATTERY_UUID = "00002a19-0000-1000-8000-00805f9b34fb"
ALERT_LEVEL_UUID = "00002a06-0000-1000-8000-00805f9b34fb"
# Guardian Radar breathing/distance characteristic (wearable/guardian_radar/guardian_radar.ino)
VITALS_UUID = "6e0f0002-8c3b-4b8e-9a6e-6a5f3c1d0a01"


class BleWearable:
    def __init__(
        self,
        state: HeartRateState,
        name: str = "",
        address: str = "",
        log: Any = None,
        breathing: BreathingState | None = None,
        label: str = "wearable",
    ) -> None:
        try:
            import bleak  # noqa: F401
        except ImportError as exc:
            raise SystemExit("WEARABLE=ble needs bleak: pip install bleak") from exc
        self.state = state
        self.breathing = breathing
        self.label = label
        self.name = name
        self.address = address
        self.log = log
        self.connected = False
        self.device_name: str | None = None
        self.battery: int | None = None
        self.can_vibrate = False
        self._client: Any = None
        self._loop = asyncio.new_event_loop()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name=f"ble-{label}", daemon=True)

    # ------------------------------------------------------------------ public (camera thread)
    def start(self) -> BleWearable:
        self._thread.start()
        return self

    def status(self) -> dict[str, Any]:
        """For the ingest payload's optional `wearable` field."""
        out: dict[str, Any] = {"connected": self.connected}
        if self.connected:
            out["contact"] = self.state.contact
            out["battery"] = self.battery
            out["name"] = (self.device_name or "")[:40] or None
        return out

    def radar_status(self) -> dict[str, Any]:
        """For the payload's optional `radar` field (dashboard vital-signs unit)."""
        out: dict[str, Any] = {"connected": self.connected}
        if self.connected and self.breathing is not None:
            out["present"] = self.breathing.present
            if self.breathing.distance_cm is not None:
                out["distanceCm"] = round(self.breathing.distance_cm)
        return out

    def vibrate(self, level: int) -> None:
        """Fire-and-forget Alert Level write (0 off, 1 mild, 2 high)."""
        if not (self.connected and self.can_vibrate):
            return
        asyncio.run_coroutine_threadsafe(self._write_alert(level), self._loop)

    def close(self) -> None:
        self._stop.set()
        if self._loop.is_running():
            self._loop.call_soon_threadsafe(self._loop.stop)

    # ------------------------------------------------------------------ BLE thread
    def _info(self, msg: str) -> None:
        if self.log:
            self.log.info(msg)

    def _run(self) -> None:
        asyncio.set_event_loop(self._loop)
        try:
            self._loop.run_until_complete(self._supervise())
        except RuntimeError:
            pass  # loop stopped by close()

    async def _supervise(self) -> None:
        delay = 2.0
        while not self._stop.is_set():
            try:
                await self._session()
                delay = 2.0
            except Exception as exc:  # noqa: BLE001 - radio errors are expected in a car
                self._info(f"wearable: {exc}")
            self.connected = False
            self.can_vibrate = False
            await asyncio.sleep(delay)
            delay = min(30.0, delay * 1.5)

    async def _find(self) -> Any:
        from bleak import BleakScanner

        if self.address:
            return await BleakScanner.find_device_by_address(self.address, timeout=10.0)

        def match(device: Any, adv: Any) -> bool:
            name = adv.local_name or device.name or ""
            if self.name:
                return name == self.name
            return HRS_UUID in [u.lower() for u in adv.service_uuids]

        return await BleakScanner.find_device_by_filter(match, timeout=10.0)

    async def _session(self) -> None:
        from bleak import BleakClient

        device = await self._find()
        if device is None:
            raise RuntimeError(f"no wearable found ({self.name or self.address or 'any heart-rate device'})")
        disconnected = asyncio.Event()
        async with BleakClient(device, disconnected_callback=lambda _c: disconnected.set()) as client:
            self._client = client
            self.device_name = device.name
            chars = {c.uuid.lower() for s in client.services for c in s.characteristics}
            self.can_vibrate = ALERT_LEVEL_UUID in chars
            await client.start_notify(HRM_UUID, self._on_hrm)
            if self.breathing is not None and VITALS_UUID in chars:
                await client.start_notify(VITALS_UUID, self._on_vitals)
            self.connected = True
            self._info(
                f"{self.label} connected: {device.name} ({device.address}), vibration={self.can_vibrate}"
            )
            last_battery = 0.0
            while not disconnected.is_set() and not self._stop.is_set():
                if BATTERY_UUID in chars and time.monotonic() - last_battery > 60:
                    last_battery = time.monotonic()
                    try:
                        self.battery = int((await client.read_gatt_char(BATTERY_UUID))[0])
                    except Exception:  # noqa: BLE001
                        pass
                await asyncio.sleep(1.0)
            self._info(f"{self.label} disconnected")

    def _on_hrm(self, _sender: Any, data: bytearray) -> None:
        try:
            self.state.add(parse_hrm(data))
        except ValueError:
            pass

    def _on_vitals(self, _sender: Any, data: bytearray) -> None:
        try:
            if self.breathing is not None:
                self.breathing.add(parse_vitals(data))
        except ValueError:
            pass

    async def _write_alert(self, level: int) -> None:
        try:
            await self._client.write_gatt_char(
                ALERT_LEVEL_UUID, bytes([max(0, min(2, level))]), response=False
            )
        except Exception as exc:  # noqa: BLE001
            self._info(f"wearable vibrate failed: {exc}")
