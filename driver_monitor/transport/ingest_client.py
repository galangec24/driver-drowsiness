"""POST to /api/ingest — the same contract as cv-simulator/ (only "source" differs)."""

from __future__ import annotations

import base64
from datetime import UTC, datetime
from typing import Any

import cv2
import numpy as np
import requests

SNAPSHOT_MAX_WIDTH = 640
SNAPSHOT_JPEG_QUALITY = 75


def build_payload(
    driver_id: str,
    ear: float | None,
    perclos: float | None,
    face_conf: float,
    heart_rate: int | None = None,
    now: datetime | None = None,
    location: dict[str, Any] | None = None,
    extra_signals: dict[str, Any] | None = None,
    wearable: dict[str, Any] | None = None,
    radar: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Exact root-contract shape. Never rename keys or add required fields.

    When no face was seen during the interval, ear/perclos are omitted (they are optional
    server-side) rather than sent as fake values. `location` (GPS fix) is an optional additive
    field, appended only when known.
    """
    signals: dict[str, Any] = {}
    if ear is not None:
        signals["ear"] = round(ear, 3)
    if perclos is not None:
        signals["perclos"] = round(perclos, 3)
    signals["heartRate"] = heart_rate or 0  # rPPG skipped in MVP
    signals["faceConfidence"] = round(face_conf, 3)
    signals["matchedDriver"] = driver_id  # MVP: assume match; recognition is server-side
    # Optional additive signals (wearable HRV/baseline, yawnCount, mar). Appended after the
    # contract keys; heartRate from the wearable overrides the default 0.
    for key, value in (extra_signals or {}).items():
        if value is not None:
            signals[key] = value
    ts = (now or datetime.now(UTC)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    payload: dict[str, Any] = {
        "driverId": driver_id,
        "source": "driver_monitor",
        "signals": signals,
        "timestamp": ts,
    }
    if location:
        payload["location"] = location
    if wearable:
        payload["wearable"] = wearable
    if radar:
        payload["radar"] = radar
    return payload


def encode_snapshot(bgr: np.ndarray) -> bytes:
    """Camera frame → small JPEG (<= 640 px wide) for /api/ingest/snapshot."""
    h, w = bgr.shape[:2]
    if w > SNAPSHOT_MAX_WIDTH:
        bgr = cv2.resize(
            bgr, (SNAPSHOT_MAX_WIDTH, round(h * SNAPSHOT_MAX_WIDTH / w)), interpolation=cv2.INTER_AREA
        )
    ok, buf = cv2.imencode(".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, SNAPSHOT_JPEG_QUALITY])
    if not ok:
        raise ValueError("could not encode snapshot")
    return buf.tobytes()


class IngestClient:
    def __init__(self, api_url: str, api_key: str, timeout_s: float = 5.0) -> None:
        self.url = f"{api_url.rstrip('/')}/api/ingest"
        self.timeout_s = timeout_s
        self.session = requests.Session()
        self.session.headers.update({"x-api-key": api_key, "Content-Type": "application/json"})

    def post(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Returns the backend response ({classification, fusionScore, alertTriggered, alertId})."""
        res = self.session.post(self.url, json=payload, timeout=self.timeout_s)
        res.raise_for_status()
        return res.json()

    def post_snapshot(self, driver_id: str, alert_id: str, jpeg: bytes) -> dict[str, Any]:
        """Attach the camera frame to an alert this device just triggered."""
        image = "data:image/jpeg;base64," + base64.b64encode(jpeg).decode("ascii")
        res = self.session.post(
            f"{self.url}/snapshot",
            json={"driverId": driver_id, "alertId": alert_id, "image": image},
            timeout=self.timeout_s * 2,
        )
        res.raise_for_status()
        return res.json()

    def identify(self, family_email: str, jpeg: bytes) -> dict[str, Any]:
        """Which of the family's registered drivers is in this frame?
        {driverId, name, confidence} or {driverId: None, reason: no_face|unknown|ambiguous}."""
        image = "data:image/jpeg;base64," + base64.b64encode(jpeg).decode("ascii")
        res = self.session.post(
            f"{self.url}/identify",
            json={"family": family_email, "image": image},
            timeout=self.timeout_s * 4,  # face recognition on a free server can take a few seconds
        )
        if res.status_code in (404, 409):  # wrong FAMILY_EMAIL / nobody enrolled: say why
            raise RuntimeError(res.json().get("error", res.text))
        res.raise_for_status()
        return res.json()

    def get_thresholds(self, driver_id: str) -> dict[str, Any]:
        """{personalThresholds, device}: the driver's thresholds for on-device checks plus
        admin-promoted device settings (transport/model_sync.py)."""
        res = self.session.get(f"{self.url}/drivers/{driver_id}/thresholds", timeout=self.timeout_s)
        res.raise_for_status()
        return res.json()

    def get_eye_model(self) -> dict[str, Any]:
        """{version, model}: the eye open/closed model promoted in the admin console."""
        res = self.session.get(f"{self.url}/models/eye-state", timeout=self.timeout_s * 4)
        res.raise_for_status()
        return res.json()

    def close(self) -> None:
        self.session.close()
