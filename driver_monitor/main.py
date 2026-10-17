"""Guardian Drive driver monitor — real facial drowsiness signals from a webcam.

Usage: python main.py [--video FILE] [--record FILE.jsonl] [--label drowsy|alert] [--offline]

Camera → face detection → landmarks → EAR → PERCLOS (30 s) → head pose → POST /api/ingest
every POST_INTERVAL_MS (never per frame). Ctrl+C or 'q' exits cleanly.
"""

from __future__ import annotations

import argparse
import signal
import sys
import time
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

import cv2
import numpy as np

import config
from detectors.blink import BlinkDetector
from detectors.distraction import DistractionDetector
from detectors.ear import average_ear
from detectors.eye_state import EyeStateModel, crop_eye
from detectors.face_detector import FaceBox
from detectors.head_nod import NodDetector
from detectors.head_pose import HeadPose, estimate_head_pose
from detectors.landmarks import Points, pose_points
from detectors.low_light import NightVision
from detectors.mouth import YawnDetector, mouth_aspect_ratio
from detectors.perclos import PerclosTracker
from fusion.fuzzy import FatigueFuzzy, FuzzyResult
from fusion.scorer import IntervalAggregator
from fusion.watch_alerts import WatchAlerter
from sensors.heart_rate import BreathingState, HeartRateState, pick_heart
from transport.driver_identity import DriverIdentity
from transport.gps import LocationSource, NoLocation, make_location_source
from transport.ingest_client import IngestClient, build_payload, encode_snapshot
from transport.model_sync import eye_model_path, fetch_device_config, local_eye_version, save_eye_model
from transport.outbox import Outbox, StoreAndForward
from ui import hud
from utils.logger import get_logger
from utils.recorder import SessionRecorder


class Detector(Protocol):
    def detect(self, rgb: np.ndarray) -> FaceBox | None: ...


class Landmarker(Protocol):
    def extract(self, rgb: np.ndarray) -> Points | None: ...


class Poster(Protocol):
    def post(self, payload: dict[str, Any]) -> dict[str, Any]: ...


@dataclass
class FrameResult:
    face: FaceBox | None = None
    landmarks: Points | None = None
    ear: float | None = None
    perclos: float = 0.0
    pose: HeadPose | None = None
    eye_closed_prob: float | None = None
    mar: float | None = None
    yawning: bool = False
    nodded: bool = False  # a head nod was counted on this frame
    eyes_reliable: bool = False  # EAR usable for drowsiness (face fully in view, facing forward)


@dataclass
class Monitor:
    """Camera-independent pipeline so it can be driven by a mock camera in tests."""

    driver_id: str
    detector: Detector
    landmarker: Landmarker
    poster: Poster | None
    perclos: PerclosTracker
    interval_s: float = 1.0
    analyze_every: int = config.ANALYZE_EVERY_N_FRAMES
    eye_model: EyeStateModel | None = None
    eye_controls_perclos: bool = False  # False = shadow mode
    aggregator: IntervalAggregator = field(default_factory=IntervalAggregator)
    last: FrameResult = field(default_factory=FrameResult)
    last_response: dict[str, Any] | None = None
    location: LocationSource = field(default_factory=NoLocation)
    yawn: YawnDetector = field(default_factory=YawnDetector)
    nod: NodDetector = field(default_factory=NodDetector)
    blink: BlinkDetector = field(default_factory=BlinkDetector)
    # Fuzzy-logic fatigue over all the eye / mouth / head signs (fusion/fuzzy.py)
    fuzzy: FatigueFuzzy = field(default_factory=FatigueFuzzy)
    fatigue: FuzzyResult = field(default_factory=lambda: FuzzyResult(0.0))
    distraction: DistractionDetector = field(default_factory=DistractionDetector)
    hearts: list[HeartRateState] = field(default_factory=list)  # BLE HR sources, priority order
    breathing: BreathingState | None = None  # dashboard radar
    wearable_status: Any = None  # callable -> dict for the payload's `wearable` field
    radar_status: Any = None  # callable -> dict for the payload's `radar` field
    # Night mode: averages + contrast-stretches dark frames for the detectors (detectors/low_light.py)
    night: NightVision = field(default_factory=NightVision)
    _frame_no: int = 0
    _next_post: float = 0.0

    def process_frame(self, bgr: np.ndarray, t: float) -> FrameResult:
        """Analyse every Nth frame; other frames reuse the last result for the overlay."""
        self._frame_no += 1
        self.night.push(bgr)  # every frame: night mode averages consecutive frames
        if self._frame_no % self.analyze_every != 0:
            return self.last

        bgr = self.night.frame(bgr)  # unchanged in daylight
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        h, w = rgb.shape[:2]
        result = FrameResult(face=self.detector.detect(rgb))
        if result.face is not None:
            result.landmarks = self.landmarker.extract(rgb)
        if result.landmarks:
            result.ear = average_ear(result.landmarks)
            closed = None
            if self.eye_model is not None:
                result.eye_closed_prob = self.eye_closed_prob(bgr, result.landmarks)
                if result.eye_closed_prob is not None and self.eye_controls_perclos:
                    closed = result.eye_closed_prob >= self.eye_model.threshold
            result.pose = estimate_head_pose(pose_points(result.landmarks), w, h)
            result.mar = mouth_aspect_ratio(result.landmarks)
            self.distraction.update(result.pose, t)
            # Face half out of the picture, just back in view, or turned far aside: EAR is not
            # meaningful there (it reads as "closed"), so it must not count as drowsiness.
            f = result.face
            in_frame = (
                f is not None and f.x > 2 and f.y > 2 and f.x + f.width < w - 2 and f.y + f.height < h - 2
            )
            result.eyes_reliable = in_frame and self.distraction.eyes_reliable(result.pose, t)
            result.perclos = self.perclos.update(result.ear, t, closed, reliable=result.eyes_reliable)
            calibrated = self.perclos.baseline is not None or closed is not None
            self.blink.update(self.perclos.is_closed if result.eyes_reliable and calibrated else None, t)
        else:
            self.perclos.mark_no_face(t)
            result.perclos = self.perclos.value
            self.distraction.update(None, t)
            self.blink.update(None, t)
        result.nodded = self.nod.update(
            # Closed for a moment already (not one frame), so lids lowered to look down don't count.
            result.pose.pitch if result.pose else None,
            self.perclos.closed_for(t) >= 0.4,
            t,
        )
        self.yawn.update(result.mar, t)
        result.yawning = self.yawn.yawning
        face = result.landmarks is not None
        self.fatigue = self.fuzzy.evaluate(
            perclos=self.perclos.effective(t) if face else None,
            closure_s=self.perclos.closed_for(t) if face else None,
            blink_rate=self.blink.rate(t),
            long_blinks=self.blink.long_blinks(t) if self.blink.observed_s() >= 60 else None,
            yawns=self.yawn.sustained(t),  # 10-minute span, fades 2 min after the latest yawn
            nods=self.nod.recent(t),
        )

        self.aggregator.add(
            result.ear if result.eyes_reliable else None,
            result.face.score if result.face else 0.0,
            result.mar,
        )
        self.last = result
        return result

    def switch_driver(self, driver_id: str) -> None:
        """A different person is driving: start their personal baselines (eyes, head, yawns) fresh."""
        self.driver_id = driver_id
        p, n, y = self.perclos, self.nod, self.yawn
        self.perclos = PerclosTracker(window_s=p.window_s, closure_ratio=p.closure_ratio)
        self.nod = NodDetector(drop_deg=n.drop_deg, min_drop_speed=n.min_drop_speed)
        self.yawn = YawnDetector(
            open_threshold=y.open_threshold,
            close_threshold=y.close_threshold,
            min_duration_s=y.min_duration_s,
        )
        self.distraction = DistractionDetector()
        self.blink = BlinkDetector()
        self.fatigue = FuzzyResult(0.0)
        self.aggregator = IntervalAggregator()
        self.last_response = None

    def eye_crops(self, bgr: np.ndarray, landmarks: Points) -> list[np.ndarray]:
        from detectors.landmarks import eye_points

        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        crops = [crop_eye(gray, pts) for pts in eye_points(landmarks)]
        return [c for c in crops if c is not None]

    def eye_closed_prob(self, bgr: np.ndarray, landmarks: Points) -> float | None:
        """Mean closed-probability of both eyes (None if the eyes could not be cropped)."""
        crops = self.eye_crops(bgr, landmarks)
        if not crops or self.eye_model is None:
            return None
        return float(self.eye_model.predict_crops(crops).mean())

    def due(self, t: float) -> bool:
        if self._next_post == 0.0:
            self._next_post = t + self.interval_s
        return t >= self._next_post

    def make_payload(self, t: float) -> dict[str, Any]:
        """Build one interval's payload and schedule the next POST."""
        self._next_post = t + self.interval_s
        ear, face_conf = self.aggregator.flush()
        extra: dict[str, Any] = {
            "yawnCount": self.yawn.count(t),
            "nodCount": self.nod.count(t),
            "distractionCount": self.distraction.count(t),
            "longBlinkCount": self.blink.long_blinks(t),
            "fuzzyScore": self.fatigue.score,
        }
        if self.fatigue.level > 0 and self.fatigue.reason:
            # Shown to the family on the alert: "Fatigue signs: repeated yawning (3+ in 10 min)"
            extra["fatigueReason"] = f"{self.fatigue.category}: {self.fatigue.reason}"[:120]
        rate = self.blink.rate(t)
        if rate is not None:
            extra["blinkRate"] = round(rate, 1)
        if self.perclos.baseline is not None:
            # The server's EAR cut-off follows this driver's own open eyes (narrow eyes).
            extra["earBaseline"] = round(self.perclos.baseline, 3)
        if self.aggregator.last_mar_max is not None:
            extra["mar"] = round(self.aggregator.last_mar_max, 3)
        if self.hearts:
            extra.update(pick_heart(self.hearts))
        if self.breathing is not None:
            extra.update(self.breathing.snapshot())
        return build_payload(
            self.driver_id,
            ear,
            self.perclos.value if ear is not None else None,
            face_conf,
            location=self.location.current(),
            extra_signals=extra,
            wearable=self.wearable_status() if self.wearable_status else None,
            radar=self.radar_status() if self.radar_status else None,
        )


def draw_overlay(
    frame: np.ndarray,
    r: FrameResult,
    response: dict[str, Any] | None,
    baseline: float | None,
    extra: list[str] | None = None,
) -> None:
    colors = {"alert": (129, 185, 16), "warning": (11, 158, 245), "drowsy": (68, 68, 239)}
    if r.face:
        cv2.rectangle(
            frame,
            (r.face.x, r.face.y),
            (r.face.x + r.face.width, r.face.y + r.face.height),
            (241, 102, 99),
            2,
        )
    if r.landmarks:
        from detectors.landmarks import eye_points

        for eye in eye_points(r.landmarks):
            cv2.polylines(frame, [np.array(eye, dtype=np.int32)], True, (248, 140, 129), 1)

    panel = frame.copy()
    extra = extra or []
    cv2.rectangle(panel, (8, 8), (300, 174 + 24 * len(extra)), (15, 13, 11), -1)
    cv2.addWeighted(panel, 0.6, frame, 0.4, 0, frame)
    lines = [
        f"EAR      {r.ear:.3f}" if r.ear is not None else "EAR      -- (no face)",
        f"PERCLOS  {r.perclos * 100:5.1f}%",
        f"Baseline {baseline:.3f}" if baseline else "Baseline calibrating...",
        (f"Pose  p{r.pose.pitch:+4.0f} y{r.pose.yaw:+4.0f} r{r.pose.roll:+4.0f}" if r.pose else "Pose  --"),
        (
            f"Eyes closed p={r.eye_closed_prob:.2f}"
            if r.eye_closed_prob is not None
            else "Eyes  -- (EAR rule)"
        ),
        *extra,
    ]
    for i, text in enumerate(lines):
        cv2.putText(
            frame, text, (18, 34 + i * 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (240, 240, 240), 1, cv2.LINE_AA
        )
    if response:
        cls = response.get("classification", "?")
        cv2.putText(
            frame,
            f"{cls.upper()}  {response.get('fusionScore', 0):.2f}",
            (18, 162 + 24 * len(extra)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            colors.get(cls, (240, 240, 240)),
            2,
            cv2.LINE_AA,
        )


def open_camera(index: int, backend_name: str = "opencv") -> cv2.VideoCapture:
    if backend_name == "picamera2":  # Raspberry Pi camera module (CSI)
        from utils.picamera import PiCamera

        return PiCamera(config.FRAME_WIDTH, config.FRAME_HEIGHT, index)  # type: ignore[return-value]
    backend = {"win32": cv2.CAP_DSHOW, "linux": cv2.CAP_V4L2}.get(sys.platform, cv2.CAP_ANY)
    cap = cv2.VideoCapture(index, backend)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, config.FRAME_WIDTH)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, config.FRAME_HEIGHT)
    if not cap.isOpened():
        raise SystemExit(f"Could not open camera {index}. Set CAMERA_INDEX in .env.")
    return cap


def open_source(cfg: config.Config, video: Path | None) -> tuple[cv2.VideoCapture, float | None]:
    """Webcam (live) or a video file (offline; timestamps from frame index). Returns (cap, video_fps)."""
    if video is None:
        return open_camera(cfg.camera_index, cfg.camera_backend), None
    cap = cv2.VideoCapture(str(video))
    if not cap.isOpened():
        raise SystemExit(f"Could not open video {video}")
    return cap, cap.get(cv2.CAP_PROP_FPS) or 30.0


def run(
    cfg: config.Config,
    duration_s: float | None = None,
    video: Path | None = None,
    record: Path | None = None,
    label: int | None = None,
    state: str = "unlabelled",
    post: bool = True,
    save_eyes: Path | None = None,
) -> None:
    from detectors.face_detector import FaceDetector
    from detectors.landmarks import LandmarkExtractor

    log = get_logger(cfg.log_level)
    config.ensure_models()
    detector = FaceDetector(config.FACE_DETECTOR_MODEL)
    landmarker = LandmarkExtractor(config.FACE_LANDMARKER_MODEL)
    client = IngestClient(cfg.api_url, cfg.api_key) if post else None
    # No internet: readings (and in-car alarm snapshots) wait in data/outbox.sqlite and are sent,
    # oldest first, when the connection is back (transport/outbox.py).
    outbox = Outbox(config.OUTBOX_PATH) if client is not None else None
    sender = StoreAndForward(client, outbox, log) if outbox is not None else None
    if outbox is not None and outbox.count():
        log.info(f"{outbox.count()} readings from an earlier offline period will be sent first")
    recorder = SessionRecorder(record, label, state) if record else None
    cap, video_fps = open_source(cfg, video)
    # Analyse ~10 frames/s regardless of the source frame rate (30 fps camera -> every 3rd frame).
    every = max(1, round(video_fps / 10)) if video_fps else config.ANALYZE_EVERY_N_FRAMES
    monitor = Monitor(
        driver_id=cfg.driver_id,
        detector=detector,
        landmarker=landmarker,
        poster=client,
        perclos=PerclosTracker(window_s=config.PERCLOS_WINDOW_S, closure_ratio=cfg.perclos_closure_ratio),
        interval_s=cfg.post_interval_ms / 1000,
        analyze_every=every,
        eye_model=(
            EyeStateModel.load(eye_model_path())
            if cfg.eye_state in ("on", "shadow") and eye_model_path().exists()
            else None
        ),
    )
    monitor.location = make_location_source(
        cfg.gps_source,
        cfg.gps_fixed,
        cfg.gps_port,
        cfg.gps_baud,
        google_key=cfg.google_geolocation_key,
        google_every_s=cfg.geolocation_every_s,
    )
    if cfg.gps_source != "none":
        fallback = " + Google Wi-Fi fallback" if cfg.google_geolocation_key else ""
        log.info(f"Location source: {cfg.gps_source}{fallback}")
    # ---- Bluetooth wearable (heart rate in, vibration out) and in-car watch alerts
    from sensors.ble_wearable import BleWearable

    wearable = radar = None
    watch_hr, radar_hr = HeartRateState(), HeartRateState()
    if cfg.vitals == "ble":
        monitor.breathing = BreathingState()
        radar = BleWearable(
            radar_hr, cfg.vitals_name, cfg.vitals_address, log, breathing=monitor.breathing, label="radar"
        ).start()
        monitor.radar_status = radar.radar_status
        log.info(f"Dashboard radar: BLE, looking for {cfg.vitals_address or cfg.vitals_name}")
    if cfg.wearable == "ble":
        wearable = BleWearable(watch_hr, cfg.wearable_name, cfg.wearable_address, log, label="watch").start()
        monitor.wearable_status = wearable.status
        log.info(f"Wearable: BLE, looking for {cfg.wearable_address or cfg.wearable_name or 'any HR device'}")
    order = [(radar, radar_hr), (wearable, watch_hr)]
    if cfg.hr_priority == "watch":
        order.reverse()
    monitor.hearts = [hr for dev, hr in order if dev is not None]
    monitor.nod = NodDetector(drop_deg=cfg.nod_deg, min_drop_speed=cfg.nod_speed)
    monitor.yawn = YawnDetector(
        open_threshold=cfg.yawn_mar, close_threshold=cfg.yawn_mar * 0.7, min_duration_s=cfg.yawn_min_s
    )

    def vibrate(level: int) -> None:
        log.info(f"in-car alert level {level} ({alerter.reason_now or alerter.last_reason or 'calm'})")
        if wearable is not None:
            wearable.vibrate(level)
        if level >= 1 and cfg.local_beep and not cfg.alarm_cmd:
            beep(level)
        if level >= 2 and cfg.alarm_cmd:
            import shlex
            import subprocess

            try:  # fire-and-forget: never block the camera loop
                subprocess.Popen(shlex.split(cfg.alarm_cmd))  # noqa: S603 - command from the owner's .env
            except OSError as exc:
                log.warning(f"ALARM_CMD failed: {exc}")

    alerter = WatchAlerter(send=vibrate) if cfg.watch_alerts else None
    pool = ThreadPoolExecutor(max_workers=1)  # POSTs never block the camera loop
    snap_pool = ThreadPoolExecutor(max_workers=1)  # alert snapshots, separate from 1 Hz ingest
    flush_pool = ThreadPoolExecutor(max_workers=1)  # sends the offline backlog
    flush_job: Future[Any] | None = None
    next_flush = 0.0
    last_offline_snap = -1e9
    inflight: Future[dict[str, Any]] | None = None
    stop = {"flag": False}
    signal.signal(signal.SIGINT, lambda *_: stop.__setitem__("flag", True))
    # systemd stops services with SIGTERM: exit through `finally` so the camera is released.
    signal.signal(signal.SIGTERM, lambda *_: stop.__setitem__("flag", True))
    source = f"video {video}" if video else f"camera {cfg.camera_index}"
    target = client.url if client else "no POST (offline)"
    identity = DriverIdentity(fixed_id=cfg.driver_id)
    identify_job: Future[dict[str, Any]] | None = None
    if identity.automatic:
        log.info(f"Automatic driver recognition for {cfg.family_email or '?'} on {source} -> {target}")
    else:
        log.info(f"Monitoring driver {cfg.driver_id or '-'} on {source} -> {target}")
    monitor.eye_controls_perclos = monitor.eye_model is not None and cfg.eye_state == "on"
    rule = "eye-state image model" if monitor.eye_controls_perclos else "EAR ratio"
    shadow = (
        " (eye model in shadow mode: shown, not used)"
        if monitor.eye_model and not monitor.eye_controls_perclos
        else ""
    )
    log.info(f"PERCLOS closed-frame rule: {rule}{shadow}")
    if save_eyes:
        save_eyes.mkdir(parents=True, exist_ok=True)
        log.info(f"Saving eye crops to {save_eyes} (sort them into Open/ and Closed/ folders afterwards)")
    saved = 0
    last_save = 0.0
    if recorder:
        log.info(f"Recording to {record} (hotkeys: 1 drowsy, 0 alert, 9 ignore, t/m/p/s confounders)")

    started = time.monotonic()
    window_ready = False
    frame_no = 0
    thresholds_job: Future[dict[str, Any]] | None = None
    thresholds_at = -1e9
    try:
        while not stop["flag"]:
            if duration_s is not None and time.monotonic() - started > duration_s:
                break
            ok, frame = cap.read()
            if not ok:
                if video:
                    break  # end of file
                log.warning("Camera frame not available")
                time.sleep(0.1)
                continue
            frame_no += 1
            if not video:
                frame = cv2.flip(frame, 1)
            t = frame_no / video_fps if video_fps else time.monotonic()
            result = monitor.process_frame(frame, t)
            now = time.monotonic()
            if alerter is not None:
                ds = monitor.distraction.state
                alerter.on_frame(
                    monitor.perclos.closed_for(t),
                    monitor.perclos.effective(t),
                    now,
                    result.nodded,
                    away_for_s=ds.away_for_s,
                    restless=ds.restless,
                    away_s=monitor.distraction.away_s,
                    away_long_s=monitor.distraction.away_long_s,
                    fatigue=monitor.fatigue.score,
                    fatigue_reason=monitor.fatigue.reason,
                )
            if result.nodded:
                log.info(f"head nod detected ({monitor.nod.count(t)} in 5 min)")

            # ---- Who is driving? (automatic mode: FAMILY_EMAIL, no fixed DRIVER_ID)
            face_visible = result.face is not None
            if identity.on_face(face_visible, now):
                log.info("seat empty for a while: the next face will be identified again")
                monitor.switch_driver("")
            if client is not None and cfg.family_email and identity.should_identify(face_visible, now):
                identity.started()
                # `frame` is still clean here: the overlay is drawn further down.
                identify_job = snap_pool.submit(client.identify, cfg.family_email, encode_snapshot(frame))
            if identify_job is not None and identify_job.done():
                try:
                    res = identify_job.result()
                    if identity.on_result(res, now):
                        monitor.switch_driver(identity.driver_id)
                        thresholds_at = -1e9  # fetch this driver's thresholds now
                        log.info(f"driver recognised: {identity.name} ({identity.confidence * 100:.0f}%)")
                    elif not identity.driver_id:
                        log.info(f"no match yet ({res.get('reason')}): {identity.label()}")
                except Exception as exc:  # noqa: BLE001 - keep trying; never kill the camera loop
                    identity.on_error(str(exc), now)
                    log.warning(f"identify failed: {exc}")
                identify_job = None

            # Personal thresholds + admin-promoted device settings: at start, then every 5 minutes.
            if client is not None and monitor.driver_id:
                if thresholds_job is None and now - thresholds_at > 300:
                    thresholds_job = snap_pool.submit(
                        fetch_device_config, client, monitor.driver_id, local_eye_version()
                    )
                    thresholds_at = now
                elif thresholds_job is not None and thresholds_job.done():
                    try:
                        apply_device_config(thresholds_job.result(), monitor, alerter, cfg, log)
                    except Exception as exc:  # noqa: BLE001 - keep defaults / last values
                        log.debug(f"device config fetch failed: {exc}")
                    thresholds_job = None
            if save_eyes and result.landmarks and t - last_save >= 0.5:
                for crop in monitor.eye_crops(frame, result.landmarks):
                    small = cv2.resize(crop, (64, 64), interpolation=cv2.INTER_AREA)
                    cv2.imwrite(str(save_eyes / f"eye_{int(t * 1000)}_{saved}.png"), small)
                    saved += 1
                last_save = t

            # Offline backlog: try to send it every 10 s (also right after a reading was stored).
            if sender is not None and flush_job is None and sender.backlog and now >= next_flush:
                flush_job = flush_pool.submit(sender.flush)
            elif flush_job is not None and flush_job.done():
                try:
                    fr = flush_job.result()
                    if fr.sent:
                        log.info(
                            f"back online: sent {fr.sent} stored readings ({fr.alerts} alerts), "
                            f"{sender.backlog} left"
                        )
                except Exception as exc:  # noqa: BLE001
                    log.warning(f"sending stored readings failed: {exc}")
                flush_job = None
                next_flush = now + 10.0

            if inflight is not None and inflight.done():
                try:
                    stored = inflight.result() is None
                    if stored:
                        inflight = None
                        raise _Stored()
                    monitor.last_response = inflight.result()
                    r = monitor.last_response
                    if alerter is not None:
                        alerter.on_backend(r, time.monotonic())
                    log.info(
                        f"POST ok -> classification={r['classification']:<7} "
                        f"fusionScore={r['fusionScore']:.3f} alertTriggered={r['alertTriggered']}"
                    )
                    if r.get("alertTriggered") and r.get("alertId") and cfg.send_snapshots and client:
                        # `frame` is still clean here: the overlay is drawn further down.
                        snap_pool.submit(
                            client.post_snapshot, monitor.driver_id, r["alertId"], encode_snapshot(frame)
                        )
                        log.info(f"alert {r['alertId']}: snapshot uploading")
                except _Stored:
                    pass
                except Exception as exc:  # noqa: BLE001 - network errors must not kill the loop
                    log.warning(f"POST failed: {exc}")
                inflight = None

            if monitor.due(t):
                payload = monitor.make_payload(t)
                s = payload["signals"]
                log.debug(f"payload ear={s.get('ear')} perclos={s.get('perclos')} face={s['faceConfidence']}")
                if recorder:
                    recorder.write(t, payload)
                # Nobody recognised yet: there is no driver to report for (and no parent to alert).
                if sender is not None and monitor.driver_id:
                    # Offline + the in-car alarm is sounding: keep a frame for the parent's alert.
                    snap = None
                    if (
                        not sender.online
                        and cfg.send_snapshots
                        and alerter is not None
                        and alerter.level >= 2
                        and now - last_offline_snap > 30
                    ):
                        snap = encode_snapshot(frame)
                        last_offline_snap = now
                    if inflight is None:
                        inflight = pool.submit(sender.send, payload, snap)
                    else:
                        log.warning("Previous POST still in flight; skipping this interval")

            if cfg.show_window:
                screen = hud.render(
                    frame, hud_state(monitor, result, alerter, identity, client, sender, t, now), now
                )
                if recorder:
                    cv2.putText(
                        screen,
                        f"REC [{recorder.state}]",
                        (420, 30),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.7,
                        (68, 68, 239),
                        2,
                        cv2.LINE_AA,
                    )
                if not window_ready:
                    # Resizable; keeps the camera's aspect ratio when maximised.
                    cv2.namedWindow(WINDOW_TITLE, cv2.WINDOW_NORMAL | cv2.WINDOW_KEEPRATIO)
                    cv2.resizeWindow(WINDOW_TITLE, screen.shape[1], screen.shape[0])
                    window_ready = True
                cv2.imshow(WINDOW_TITLE, screen)
                key = cv2.waitKey(1) & 0xFF
                if key == ord("q"):
                    break
                if recorder and recorder.handle_key(key):
                    log.info(f"label -> {recorder.state} ({recorder.label})")
    finally:
        cap.release()
        cv2.destroyAllWindows()
        pool.shutdown(wait=False, cancel_futures=True)
        snap_pool.shutdown(wait=False, cancel_futures=True)
        flush_pool.shutdown(wait=False, cancel_futures=True)
        if outbox is not None:
            if outbox.count():
                log.info(f"{outbox.count()} readings kept for the next start (no connection)")
            outbox.close()
        if wearable is not None:
            wearable.vibrate(0)
            wearable.close()
        if radar is not None:
            radar.close()
        monitor.location.close()
        if client is not None:
            client.close()
        if recorder:
            recorder.close()
            log.info(f"Recorded {recorder.rows} intervals to {record}")
        detector.close()
        landmarker.close()
        log.info("Driver monitor stopped.")


WINDOW_TITLE = "Guardian Drive - driver monitor (q to quit)"


def beep(level: int) -> None:
    """Audible in-car alarm on the computer itself (Windows), never blocking the camera loop."""
    if sys.platform != "win32":
        return
    import threading
    import winsound

    def play() -> None:
        pattern = [(1800, 350), (1800, 350), (1800, 600)] if level >= 2 else [(1200, 250)]
        for freq, ms in pattern:
            winsound.Beep(freq, ms)

    threading.Thread(target=play, daemon=True).start()


def hud_state(
    monitor: Monitor,
    result: FrameResult,
    alerter: WatchAlerter | None,
    identity: DriverIdentity,
    client: Any,
    sender: Any,
    t: float,
    now: float,
) -> hud.HudState:
    """What the screen shows: the in-car alarm's decision (works offline) or the server's verdict."""
    from detectors.landmarks import eye_points

    level, reason = 0, ""
    if alerter is not None and alerter.level > 0:
        level, reason = alerter.level, alerter.reason_now or alerter.last_reason
    backend = (monitor.last_response or {}).get("classification")
    backend_level = {"drowsy": 2, "warning": 1}.get(backend or "", 0)
    if backend_level > level:
        level, reason = backend_level, f"server: {backend}"
    if not reason and level == 0 and result.face is None:
        reason = "No face: look at the camera"
    ds = monitor.distraction.state
    if level == 0 and ds.away_for_s >= 1.0:
        reason = "Looking away..."

    if client is None:
        connection = "Local only: readings are not sent"
        driver = identity.label() if not identity.automatic else "Driver recognition needs the server"
    else:
        driver = identity.label()
        if sender is not None and sender.backlog:
            connection = f"OFFLINE: {sender.backlog} readings saved"
        elif monitor.last_response is not None:
            connection = "Server: online, parent sees this live"
        else:
            connection = "Connecting to the server..."
    light = monitor.night.lighting
    hr = pick_heart(monitor.hearts) if monitor.hearts else None
    extra = []
    if hr is not None:
        extra.append(f"Heart rate {hr['heartRate'] or '--'} bpm (base {hr.get('hrBaseline', '..')})")
    if result.yawning:
        extra.append("Yawning")
    if monitor.nod.head_down:
        extra.append("Head down")
    return hud.HudState(
        level=level,
        reason=reason.capitalize() if reason else "",
        driver=driver,
        connection=connection,
        ear=result.ear,
        baseline=monitor.perclos.baseline,
        perclos=monitor.perclos.value,
        perclos_limit=alerter.perclos_threshold if alerter is not None else 0.4,
        closed_for_s=monitor.perclos.closed_for(t),
        movement=ds.speed,
        movement_limit=monitor.distraction.restless_speed,
        yawns=monitor.yawn.count(t),
        nods=monitor.nod.count(t),
        distractions=ds.count,
        fatigue=monitor.fatigue.score,
        fatigue_reason=monitor.fatigue.reason,
        blink_rate=monitor.blink.rate(t),
        long_blinks=monitor.blink.long_blinks(t),
        face=(result.face.x, result.face.y, result.face.width, result.face.height) if result.face else None,
        eyes=(
            [np.array(e, dtype=np.float32) for e in eye_points(result.landmarks)] if result.landmarks else []
        ),
        night=f"NIGHT MODE{' (IR)' if light.infrared else ''}" if light.night else "",
        extra=extra,
    )


class _Stored(Exception):
    """The reading was stored for later (offline), there is no backend response to show."""


def apply_device_config(
    conf: dict[str, Any], monitor: Monitor, alerter: WatchAlerter | None, cfg: config.Config, log: Any
) -> None:
    """Thresholds for the in-car alarm, then (MODEL_SYNC) the admin-promoted yawn threshold / eye model."""
    if alerter is not None:
        alerter.apply_thresholds(conf["thresholds"])
    th = conf.get("thresholds") or {}
    monitor.fuzzy.set_limits(
        float(th.get("perclosThreshold") or 0.4),
        float(th.get("drowsyDurationMs") or 2000) / 1000.0,
        int(th.get("yawnThreshold") or 3),
    )
    if not cfg.model_sync:
        return
    yawn_mar = conf["device"].get("yawnMar")
    if isinstance(yawn_mar, int | float) and 0.1 < yawn_mar < 1.5 and yawn_mar != monitor.yawn.open_threshold:
        monitor.yawn.open_threshold = float(yawn_mar)
        monitor.yawn.close_threshold = float(yawn_mar) * 0.7
        log.info(f"yawn threshold set to {yawn_mar} (admin calibration)")
    eye = conf.get("eye")
    if eye and cfg.eye_state in ("on", "shadow"):
        model = EyeStateModel(eye["model"])  # validate before replacing anything
        save_eye_model(eye)
        monitor.eye_model = model
        log.info(f"eye-state model updated to version {eye['version']} (admin promotion)")


LABELS = {"drowsy": 1, "alert": 0, "ignore": -1}


def main() -> None:
    parser = argparse.ArgumentParser(description="Guardian Drive driver monitor")
    parser.add_argument("--duration", type=float, default=None, help="stop after N seconds")
    parser.add_argument("--no-window", action="store_true", help="run headless (no preview window)")
    parser.add_argument("--video", type=Path, default=None, help="process a video file instead of the webcam")
    parser.add_argument("--record", type=Path, default=None, help="append labelled intervals to this .jsonl")
    parser.add_argument("--label", choices=sorted(LABELS), default=None, help="label for every recorded row")
    parser.add_argument("--offline", action="store_true", help="do not POST to the backend (record only)")
    parser.add_argument("--save-eyes", type=Path, default=None, help="save eye crops (training data)")
    args = parser.parse_args()
    cfg = config.load_config(require_backend=not args.offline)
    if args.no_window:
        cfg = config.Config(**{**cfg.__dict__, "show_window": False})
    run(
        cfg,
        args.duration,
        video=args.video,
        record=args.record,
        label=LABELS[args.label] if args.label else None,
        state=args.label or "unlabelled",
        post=not args.offline,
        save_eyes=args.save_eyes,
    )


if __name__ == "__main__":
    main()
