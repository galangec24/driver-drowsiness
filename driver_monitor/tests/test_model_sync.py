"""Admin-promoted settings and models reach the in-car monitor."""

import json
from types import SimpleNamespace

import pytest

from transport.model_sync import fetch_device_config, local_eye_version, save_eye_model


class FakeClient:
    def __init__(self, device: dict) -> None:
        self.device = device
        self.eye_calls = 0

    def get_thresholds(self, driver_id: str) -> dict:
        return {"personalThresholds": {"drowsyDurationMs": 1500}, "device": self.device}

    def get_eye_model(self) -> dict:
        self.eye_calls += 1
        return {"version": "v2", "model": {"kind": "mlp"}}


def test_new_eye_model_is_downloaded_once() -> None:
    client = FakeClient({"yawnMar": 0.46, "eyeStateVersion": "v2"})
    conf = fetch_device_config(client, "d1", current_eye_version="v1")
    assert conf["thresholds"] == {"drowsyDurationMs": 1500}
    assert conf["device"]["yawnMar"] == 0.46
    assert conf["eye"]["version"] == "v2"
    again = fetch_device_config(client, "d1", current_eye_version="v2")
    assert again["eye"] is None and client.eye_calls == 1


def test_nothing_promoted_means_no_download() -> None:
    client = FakeClient({"yawnMar": None, "eyeStateVersion": None})
    assert fetch_device_config(client, "d1", None)["eye"] is None


def test_eye_model_saved_with_version(tmp_path) -> None:
    model, version = tmp_path / "eye_state.json", tmp_path / "eye_state.version"
    assert local_eye_version(version) is None
    save_eye_model({"version": "v2", "model": {"kind": "mlp"}}, model, version)
    assert json.loads(model.read_text()) == {"kind": "mlp"}
    assert local_eye_version(version) == "v2"
    assert not (tmp_path / "eye_state.json.tmp").exists()


def test_apply_device_config_updates_yawn_threshold_and_respects_model_sync() -> None:
    from detectors.mouth import YawnDetector
    from fusion.fuzzy import FatigueFuzzy
    from main import apply_device_config

    logs: list[str] = []
    log = SimpleNamespace(info=logs.append)
    monitor = SimpleNamespace(yawn=YawnDetector(), eye_model=None, fuzzy=FatigueFuzzy())
    conf = {"thresholds": {}, "device": {"yawnMar": 0.46}, "eye": None}
    apply_device_config(conf, monitor, None, SimpleNamespace(model_sync=False, eye_state="shadow"), log)
    assert monitor.yawn.open_threshold == 0.5  # MODEL_SYNC=0 keeps the local value
    apply_device_config(conf, monitor, None, SimpleNamespace(model_sync=True, eye_state="shadow"), log)
    assert monitor.yawn.open_threshold == 0.46
    assert monitor.yawn.close_threshold == pytest.approx(0.322)
    assert "admin calibration" in logs[0]
