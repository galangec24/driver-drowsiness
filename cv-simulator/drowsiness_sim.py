"""Guardian Drive CV simulator — POSTs plausible fake sensor JSON to /api/ingest.

No camera, no ML, no database: it samples from the profiles in scenarios/ and sends the
exact same payload shape as driver_monitor/ (only "source" differs).

Also simulates a GPS route (optional "location" field) and, when an alert fires, uploads a
stand-in driver photo to /api/ingest/snapshot so the parent map/snapshot views can be tested.
"""

from __future__ import annotations

import argparse
import base64
import json
import math
import os
import random
import signal
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv

from utils.logger import get_logger

SCENARIO_DIR = Path(__file__).parent / "scenarios"
# Stand-in "camera frame" for alert snapshots: the seeded demo driver's enrollment photo.
DEFAULT_SNAPSHOT = (
    Path(__file__).resolve().parent.parent / "backend" / "tests" / "fixtures" / "personA_front.jpg"
)
# Ayala Avenue, Makati. Any start point works (SIM_START=lat,lng).
DEFAULT_START = (14.5547, 121.0244)
EARTH_RADIUS_M = 6_371_000.0


@dataclass(frozen=True)
class Config:
    api_url: str
    api_key: str
    driver_id: str
    scenario: str
    interval_ms: int
    log_level: str
    gps: bool = True
    start: tuple[float, float] = DEFAULT_START
    snapshot_image: str = ""


@dataclass(frozen=True)
class Phase:
    profile: dict[str, Any]
    seconds: float
    label: str


def load_config() -> Config:
    load_dotenv(Path(__file__).parent / ".env")
    cfg = Config(
        api_url=os.getenv("API_URL", "http://localhost:3000").rstrip("/"),
        api_key=os.getenv("INGEST_API_KEY", ""),
        driver_id=os.getenv("DRIVER_ID", ""),
        scenario=os.getenv("SCENARIO", "mixed"),
        interval_ms=int(os.getenv("POST_INTERVAL_MS", "1000")),
        log_level=os.getenv("LOG_LEVEL", "INFO"),
        gps=os.getenv("SIM_GPS", "1") != "0",
        start=parse_latlng(os.getenv("SIM_START", "")) or DEFAULT_START,
        snapshot_image=os.getenv("SNAPSHOT_IMAGE")
        or (str(DEFAULT_SNAPSHOT) if DEFAULT_SNAPSHOT.exists() else ""),
    )
    missing = [k for k, v in (("INGEST_API_KEY", cfg.api_key), ("DRIVER_ID", cfg.driver_id)) if not v]
    if missing:
        raise SystemExit(f"Missing required env vars: {', '.join(missing)} (see .env.example)")
    return cfg


def parse_latlng(text: str) -> tuple[float, float] | None:
    try:
        lat, lng = (float(x) for x in text.split(","))
    except ValueError:
        return None
    return (lat, lng) if -90 <= lat <= 90 and -180 <= lng <= 180 else None


class RouteSimulator:
    """A car driving at city/highway speed with a gently wandering heading (one fix per tick)."""

    def __init__(self, start: tuple[float, float], rng: random.Random) -> None:
        self.lat, self.lng = start
        self.rng = rng
        self.heading = rng.uniform(0, 360)
        self.speed = rng.uniform(35, 60)  # km/h

    def step(self, dt_s: float) -> dict[str, float]:
        self.heading = (self.heading + self.rng.gauss(0, 6)) % 360
        self.speed = min(90.0, max(15.0, self.speed + self.rng.gauss(0, 2)))
        dist = self.speed / 3.6 * dt_s
        rad = math.radians(self.heading)
        self.lat += math.degrees(dist * math.cos(rad) / EARTH_RADIUS_M)
        self.lng += math.degrees(dist * math.sin(rad) / (EARTH_RADIUS_M * math.cos(math.radians(self.lat))))
        return {
            "lat": round(self.lat, 6),
            "lng": round(self.lng, 6),
            "heading": round(self.heading, 1),
            "speed": round(self.speed, 1),
            "accuracy": round(self.rng.uniform(4, 12), 1),
        }


def snapshot_payload(driver_id: str, alert_id: str, image_path: str) -> dict[str, str]:
    data = base64.b64encode(Path(image_path).read_bytes()).decode("ascii")
    return {"driverId": driver_id, "alertId": alert_id, "image": f"data:image/jpeg;base64,{data}"}


def load_profile(name: str) -> dict[str, Any]:
    path = SCENARIO_DIR / f"{name}.json"
    if not path.exists():
        options = sorted(p.stem for p in SCENARIO_DIR.glob("*.json"))
        raise SystemExit(f"Unknown SCENARIO '{name}'. Options: {', '.join(options)}")
    return json.loads(path.read_text(encoding="utf-8"))


def load_phases(name: str) -> list[Phase]:
    """A plain profile is one endless phase; a 'cycle' scenario is a repeating list."""
    data = load_profile(name)
    if "replay" in data:  # recorded/exported tick sequence, played in order and looped
        return [Phase(profile=data, seconds=float(len(data["replay"])), label=name)]
    if "cycle" not in data:
        return [Phase(profile=data, seconds=float("inf"), label=name)]
    return [
        Phase(profile=load_profile(step["profile"]), seconds=float(step["seconds"]), label=step["label"])
        for step in data["cycle"]
    ]


def phase_at(phases: list[Phase], elapsed_s: float) -> Phase:
    """Which phase of the (repeating) cycle is active after elapsed_s seconds."""
    total = sum(p.seconds for p in phases)
    if total == float("inf"):
        return phases[0]
    t = elapsed_s % total
    for phase in phases:
        if t < phase.seconds:
            return phase
        t -= phase.seconds
    return phases[-1]


def sample(dist: dict[str, float], lo: float, hi: float, rng: random.Random) -> float:
    return min(hi, max(lo, rng.gauss(dist["mean"], dist["std"])))


def build_payload(driver_id: str, profile: dict[str, Any], rng: random.Random) -> dict[str, Any]:
    """Exact /api/ingest contract (root CLAUDE.md § 5.1). Never rename keys."""
    return {
        "driverId": driver_id,
        "source": "simulated",
        "signals": {
            "ear": round(sample(profile["ear"], 0.0, 0.5, rng), 3),
            "perclos": round(sample(profile["perclos"], 0.0, 1.0, rng), 3),
            "heartRate": int(round(sample(profile["heartRate"], 35, 160, rng))),
            "faceConfidence": round(sample(profile["faceConfidence"], 0.0, 1.0, rng), 3),
            "matchedDriver": driver_id,
        },
        "timestamp": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
    }


def build_replay_payload(driver_id: str, tick: dict[str, Any]) -> dict[str, Any]:
    """Same contract as build_payload, with signal values taken from a replay scenario.
    Signals missing from the tick (e.g. no face seen) are omitted, exactly like driver_monitor."""
    signals: dict[str, Any] = {
        k: tick[k] for k in ("ear", "perclos", "heartRate", "faceConfidence") if k in tick
    }
    signals["matchedDriver"] = driver_id
    return {
        "driverId": driver_id,
        "source": "simulated",
        "signals": signals,
        "timestamp": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
    }


def fmt(v: Any, spec: str) -> str:
    return "  --  " if v is None else format(v, spec)


def run(cfg: Config, duration_s: float | None = None) -> None:
    log = get_logger(cfg.log_level)
    phases = load_phases(cfg.scenario)
    rng = random.Random()
    session = requests.Session()
    session.headers.update({"x-api-key": cfg.api_key, "Content-Type": "application/json"})
    url = f"{cfg.api_url}/api/ingest"
    route = RouteSimulator(cfg.start, rng) if cfg.gps else None

    stop = {"flag": False}

    def handle_sigint(_sig: int, _frame: object) -> None:
        stop["flag"] = True

    signal.signal(signal.SIGINT, handle_sigint)
    log.info(
        f"Simulating scenario='{cfg.scenario}' driver={cfg.driver_id} every {cfg.interval_ms}ms -> {url}"
    )

    started = time.monotonic()
    interval = cfg.interval_ms / 1000
    next_tick = started
    tick_no = 0
    while not stop["flag"]:
        if duration_s is not None and time.monotonic() - started >= duration_s:
            break
        phase = phase_at(phases, time.monotonic() - started)
        if "replay" in phase.profile:
            replay = phase.profile["replay"]
            payload = build_replay_payload(cfg.driver_id, replay[tick_no % len(replay)])
        else:
            payload = build_payload(cfg.driver_id, phase.profile, rng)
        tick_no += 1
        if route:
            payload["location"] = route.step(interval)
        sig = payload["signals"]
        try:
            res = session.post(url, json=payload, timeout=5)
            if res.ok:
                body = res.json()
                log.info(
                    f"[{phase.label:>7}] ear={fmt(sig.get('ear'), '.3f')} "
                    f"perclos={fmt(sig.get('perclos'), '.3f')} hr={fmt(sig.get('heartRate'), '>3')} -> "
                    f"classification={body['classification']:<7} fusionScore={body['fusionScore']:.3f} "
                    f"alertTriggered={body['alertTriggered']}"
                )
                if body["alertTriggered"] and body.get("alertId") and cfg.snapshot_image:
                    snap = session.post(
                        f"{url}/snapshot",
                        json=snapshot_payload(cfg.driver_id, body["alertId"], cfg.snapshot_image),
                        timeout=10,
                    )
                    if not snap.ok:
                        log.warning(f"snapshot upload failed: HTTP {snap.status_code} {snap.text[:120]}")
            else:
                log.error(f"HTTP {res.status_code}: {res.text[:200]}")
        except requests.RequestException as exc:
            log.warning(f"Backend unreachable: {exc}")

        next_tick += interval
        delay = next_tick - time.monotonic()
        if delay > 0:
            time.sleep(delay)
        else:
            next_tick = time.monotonic()

    session.close()
    log.info("Simulator stopped.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Guardian Drive CV simulator")
    parser.add_argument("--duration", type=float, default=None, help="stop after N seconds")
    parser.add_argument("--scenario", default=None, help="override SCENARIO from .env")
    parser.add_argument("--no-gps", action="store_true", help="omit the simulated location")
    parser.add_argument("--no-snapshot", action="store_true", help="don't upload alert snapshots")
    args = parser.parse_args()
    cfg = load_config()
    if args.scenario:
        cfg = Config(**{**cfg.__dict__, "scenario": args.scenario})
    if args.no_gps:
        cfg = Config(**{**cfg.__dict__, "gps": False})
    if args.no_snapshot:
        cfg = Config(**{**cfg.__dict__, "snapshot_image": ""})
    try:
        run(cfg, args.duration)
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
