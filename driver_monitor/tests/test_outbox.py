"""Store-and-forward: no internet -> readings are kept on disk and sent in order later."""

from __future__ import annotations

from typing import Any

import pytest
import requests

from transport.outbox import Outbox, StoreAndForward, is_retryable


class FakeClient:
    """Backend stand-in: `online` toggles the network; drowsy readings trigger alerts."""

    def __init__(self) -> None:
        self.online = True
        self.posted: list[dict[str, Any]] = []
        self.snapshots: list[tuple[str, str, bytes]] = []

    def post(self, payload: dict[str, Any]) -> dict[str, Any]:
        if not self.online:
            raise requests.ConnectionError("no route to host")
        self.posted.append(payload)
        drowsy = payload["signals"].get("perclos", 0) > 0.5
        return {
            "classification": "drowsy" if drowsy else "alert",
            "fusionScore": 0.9 if drowsy else 0.1,
            "alertTriggered": drowsy,
            "alertId": f"alert{len(self.posted)}" if drowsy else None,
        }

    def post_snapshot(self, driver_id: str, alert_id: str, jpeg: bytes) -> dict[str, Any]:
        self.snapshots.append((driver_id, alert_id, jpeg))
        return {"ok": True}


def reading(i: int, perclos: float = 0.05) -> dict[str, Any]:
    return {
        "driverId": "d" * 24,
        "source": "driver_monitor",
        "signals": {"perclos": perclos, "n": i},
        "timestamp": f"2026-10-15T12:00:{i:02d}.000Z",
    }


@pytest.fixture
def setup(tmp_path):
    client = FakeClient()
    box = Outbox(tmp_path / "outbox.sqlite")
    yield client, box, StoreAndForward(client, box)
    box.close()


def test_online_readings_go_straight_through(setup):
    client, box, sf = setup
    assert sf.send(reading(1))["classification"] == "alert"
    assert box.count() == 0 and sf.online


def test_offline_readings_are_kept_and_sent_in_order_with_the_queued_flag(setup):
    client, box, sf = setup
    client.online = False
    assert sf.send(reading(1)) is None
    assert not sf.online
    sf.send(reading(2, perclos=0.8), snapshot=b"jpeg-of-the-driver")
    client.online = True
    sf.send(reading(3))  # a backlog exists: joins the end of it so order is kept
    assert box.count() == 3

    result = sf.flush()
    assert (result.sent, result.alerts, result.online) == (3, 1, True)
    assert [p["signals"]["n"] for p in client.posted] == [1, 2, 3]
    assert all(p["queued"] is True for p in client.posted)
    assert [p["timestamp"] for p in client.posted][0] == "2026-10-15T12:00:01.000Z"  # original time kept
    # the in-car alarm frame is attached to the alert it produced
    assert client.snapshots == [("d" * 24, "alert2", b"jpeg-of-the-driver")]
    assert box.count() == 0
    # live again
    assert sf.send(reading(4)) is not None


def test_flush_stops_when_the_connection_drops_again(setup):
    client, box, sf = setup
    client.online = False
    for i in range(5):
        sf.send(reading(i))
    result = sf.flush()
    assert (result.sent, result.online) == (0, False)
    assert box.count() == 5


def test_backlog_survives_a_restart(tmp_path):
    client = FakeClient()
    client.online = False
    box = Outbox(tmp_path / "outbox.sqlite")
    StoreAndForward(client, box).send(reading(1))
    box.close()  # the car is switched off

    box2 = Outbox(tmp_path / "outbox.sqlite")
    client.online = True
    assert StoreAndForward(client, box2).flush().sent == 1
    box2.close()


def test_size_limit_and_age_limit_drop_the_oldest():
    box = Outbox(":memory:", max_rows=3)
    for i in range(5):
        box.put(reading(i), now=1000.0 + i)
    assert [p["signals"]["n"] for _, p, _ in box.peek()] == [2, 3, 4]
    assert box.prune(now=1000.0 + 4 + 23 * 3600, max_age_s=23 * 3600) == 2
    assert box.count() == 1


def test_which_errors_are_worth_retrying():
    resp = requests.Response()
    resp.status_code = 503
    assert is_retryable(requests.HTTPError(response=resp))
    assert is_retryable(requests.Timeout())
    resp404 = requests.Response()
    resp404.status_code = 404
    assert not is_retryable(requests.HTTPError(response=resp404))
