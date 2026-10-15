"""Who is driving? Automatic driver recognition for a car shared by a family.

The car is registered to the parent's account (FAMILY_EMAIL). When a face appears, a camera frame
goes to POST /api/ingest/identify, which compares it with that family's enrolled drivers (the face
photos taken when each driver was registered in the app). Readings are sent for the recognised
driver only. When the seat has been empty for a while, the driver may have changed, so the next
face is identified again. A fixed DRIVER_ID turns all of this off (one-driver car / testing).

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
        if self.driver_id and t - self._absent_since >= self.absent_reset_s:
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
