"""Who is driving? Automatic driver recognition for a car shared by a family.

The car is registered to the parent's account (FAMILY_EMAIL). When a face appears, a camera frame
goes to POST /api/ingest/identify, which compares it with that family's enrolled drivers (the face
photos taken when each driver was registered in the app). Readings are sent for the recognised
driver only. When the seat has been empty for a while, the driver may have changed, so the next
face is identified again. A fixed DRIVER_ID turns all of this off (one-driver car / testing).

While the seat is empty (gas station, takeout) the car keeps the last driver as `away_driver`
for `away_max_s`, so the parent sees "Away from the car" instead of "Offline". A face that stays
unrecognised in the driver's seat for `unknown_after_s` is reported once per episode
(`should_report_unknown`): someone who isn't a registered driver is driving the family car.

Pure state machine (no camera, no network) so it can be unit-tested.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class DriverIdentity:
    fixed_id: str = ""
    retry_s: float = 4.0  # no match yet: try again this often while a face is visible
    absent_reset_s: float = 20.0  # seat empty this long -> the driver may have changed
    recheck_s: float = 300.0  # while driving: confirm the driver every 5 minutes
    error_retry_s: float = 10.0
    unknown_after_s: float = 30.0
    away_max_s: float = 30 * 60.0

    driver_id: str = ""
    name: str = ""
    confidence: float = 0.0
    # Other registered family members recognised in the car (not driving).
    passengers: tuple[str, ...] = ()
    status: str = "identifying"  # identifying | identified | unknown | ambiguous | error | fixed
    detail: str = ""
    _next_try: float = 0.0
    _absent_since: float | None = None
    _pending: bool = False
    last_driver_id: str = ""  # who was driving before the seat became empty
    _unknown_since: float | None = None
    _unknown_reported: bool = False

    def __post_init__(self) -> None:
        if self.fixed_id:
            self.driver_id = self.fixed_id
            self.status = "fixed"

    @property
    def automatic(self) -> bool:
        return not self.fixed_id

    def on_face(self, face_visible: bool, t: float) -> bool:
        """Track whether someone is in the seat. Returns True when the current driver was cleared."""
        if not self.automatic:
            return False
        if face_visible:
            self._absent_since = None
            return False
        if self._absent_since is None:
            self._absent_since = t
            return False
        if t - self._absent_since >= self.absent_reset_s:
            self._unknown_since, self._unknown_reported = None, False
        if self.driver_id and t - self._absent_since >= self.absent_reset_s:
            self.last_driver_id = self.driver_id
            self.driver_id, self.name, self.confidence = "", "", 0.0
            self.status, self.detail = "identifying", ""
            self._next_try = 0.0
            return True
        return False

    def should_identify(self, face_visible: bool, t: float) -> bool:
        return self.automatic and face_visible and not self._pending and t >= self._next_try

    def started(self) -> None:
        self._pending = True

    def on_result(self, res: dict[str, Any], t: float) -> bool:
        """Apply an /identify answer. Returns True when the active driver changed."""
        self._pending = False
        driver_id = res.get("driverId")
        if driver_id:
            changed = driver_id != self.driver_id
            self.driver_id = str(driver_id)
            self.name = str(res.get("name") or "")
            self.confidence = float(res.get("confidence") or 0.0)
            self.passengers = tuple(str(p.get("name") or "") for p in res.get("passengers") or [])
            self.status, self.detail = "identified", ""
            self._next_try = t + self.recheck_s
            self.last_driver_id = self.driver_id
            self._unknown_since, self._unknown_reported = None, False
            return changed
        if self.driver_id:
            # A routine re-check that didn't get a clear look (bad angle, hand over the face):
            # keep the current driver; only a confident different match switches.
            self._next_try = t + 60.0
            return False
        reason = str(res.get("reason") or "unknown")
        self.status = (
            "ambiguous" if reason == "ambiguous" else "unknown" if reason == "unknown" else "identifying"
        )
        if self.status == "unknown":
            if self._unknown_since is None:
                self._unknown_since = t
        elif reason != "no_face":
            self._unknown_since = None
        candidates = res.get("candidates") or []
        self.detail = " / ".join(str(c) for c in candidates)
        self._next_try = t + self.retry_s
        return False

    def on_error(self, message: str, t: float) -> None:
        self._pending = False
        if not self.driver_id:
            self.status = "error"
        self.detail = message[:120]
        self._next_try = t + self.error_retry_s

    def away_driver(self, t: float) -> str:
        """The driver whose car this is while the seat is empty ('' when someone is in it, or after
        `away_max_s`): the parent sees "Away from the car"."""
        if not self.automatic or self.driver_id or self._absent_since is None:
            return ""
        if t - self._absent_since > self.away_max_s:
            return ""
        return self.last_driver_id

    def should_report_unknown(self, face_visible: bool, t: float) -> bool:
        """An unrecognised face has been in the driver's seat for `unknown_after_s`."""
        return (
            self.automatic
            and face_visible
            and not self._unknown_reported
            and self._unknown_since is not None
            and t - self._unknown_since >= self.unknown_after_s
        )

    def reported_unknown(self) -> None:
        self._unknown_reported = True

    def label(self) -> str:
        """One line for the preview window."""
        if self.status == "fixed":
            return f"Driver {self.driver_id[-6:]} (DRIVER_ID)"
        if self.driver_id:
            with_passengers = f"  + passenger {', '.join(self.passengers)}" if self.passengers else ""
            return (
                f"Driver: {self.name or self.driver_id[-6:]} ({self.confidence * 100:.0f}%){with_passengers}"
            )
        if self.status == "unknown":
            return "Unknown face: not a registered driver"
        if self.status == "ambiguous":
            return f"Not sure: {self.detail or 'look-alike drivers'}"
        if self.status == "error":
            return f"Identify failed: {self.detail}"
        return "Identifying driver... look at the camera"
