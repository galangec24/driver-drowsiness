"""Voice calls from the parent's app to the car (WebRTC audio), answered hands-free.

The in-car device keeps a Socket.io connection to the backend (authenticated with the ingest key
and the recognised driver). When the parent presses "Call":
  1. `call:incoming` -> the voice says "<name> is calling. Answering in 3 seconds."
  2. after CALL_AUTO_ANSWER_S the call is answered automatically: the driver never touches a screen
  3. the parent's offer arrives (`call:signal`); we answer; audio flows directly (or via TURN)
  4. `call:ended` (parent hung up) -> "Call ended."
Microphone and speaker: the system defaults (sounddevice / PortAudio). For a car, a USB
speakerphone with built-in echo cancellation gives the clearest calls.

Optional dependencies (pip install aiortc sounddevice "python-socketio[asyncio_client]" aiohttp;
on the Pi also: sudo apt install libportaudio2). Without them, calls are simply off.
"""

from __future__ import annotations

import asyncio
import contextlib
import fractions
import threading
import time
from collections.abc import Callable
from typing import Any

from loguru import logger as log

SAMPLE_RATE = 48000
FRAME_SAMPLES = 960  # 20 ms


def available() -> str | None:
    """None when calls can work here, else what is missing."""
    try:
        import aiortc  # noqa: F401
        import av  # noqa: F401
        import socketio  # noqa: F401
    except ImportError as exc:
        return (
            f"missing package ({exc.name}): "
            "pip install aiortc sounddevice 'python-socketio[asyncio_client]' aiohttp"
        )
    return None


# ----------------------------------------------------------------------------------- audio
def make_mic_track():
    """Microphone -> WebRTC audio track (48 kHz mono, 20 ms frames)."""
    import numpy as np
    import sounddevice as sd
    from aiortc import MediaStreamTrack
    from av import AudioFrame

    class MicTrack(MediaStreamTrack):
        kind = "audio"

        def __init__(self) -> None:
            super().__init__()
            self._q: asyncio.Queue[np.ndarray] = asyncio.Queue(maxsize=50)
            self._loop = asyncio.get_event_loop()
            self._pts = 0

            def cb(indata: Any, _frames: int, _time: Any, _status: Any) -> None:
                data = indata.copy()
                with contextlib.suppress(RuntimeError):
                    self._loop.call_soon_threadsafe(self._put, data)

            self._stream = sd.InputStream(
                samplerate=SAMPLE_RATE, channels=1, dtype="int16", blocksize=FRAME_SAMPLES, callback=cb
            )
            self._stream.start()

        def _put(self, data: Any) -> None:
            if self._q.full():
                self._q.get_nowait()  # drop the oldest: keep latency low
            self._q.put_nowait(data)

        async def recv(self):
            data = await self._q.get()
            frame = AudioFrame.from_ndarray(data.reshape(1, -1), format="s16", layout="mono")
            frame.sample_rate = SAMPLE_RATE
            frame.pts = self._pts
            frame.time_base = fractions.Fraction(1, SAMPLE_RATE)
            self._pts += data.shape[0]
            return frame

        def stop(self) -> None:
            super().stop()
            with contextlib.suppress(Exception):
                self._stream.stop()
                self._stream.close()

    return MicTrack()


class SpeakerSink:
    """Plays a remote WebRTC audio track on the default speaker."""

    def __init__(self) -> None:
        import sounddevice as sd
        from av import AudioResampler

        self._resampler = AudioResampler(format="s16", layout="mono", rate=SAMPLE_RATE)
        self._out = sd.RawOutputStream(samplerate=SAMPLE_RATE, channels=1, dtype="int16")
        self._out.start()
        self._task: asyncio.Task | None = None

    def play(self, track: Any) -> None:
        self._task = asyncio.ensure_future(self._run(track))

    async def _run(self, track: Any) -> None:
        loop = asyncio.get_event_loop()
        try:
            while True:
                frame = await track.recv()
                for f in self._resampler.resample(frame):
                    pcm = bytes(f.planes[0])[: f.samples * 2]
                    await loop.run_in_executor(None, self._out.write, pcm)
        except Exception:  # noqa: BLE001 - track ended
            pass

    def stop(self) -> None:
        if self._task:
            self._task.cancel()
        with contextlib.suppress(Exception):
            self._out.stop()
            self._out.close()


# ----------------------------------------------------------------------------------- session
class CallSession:
    """One call: answers the parent's offer. Audio sources are injectable (tests use silence)."""

    def __init__(
        self,
        ice_servers: list[dict[str, Any]],
        mic_factory: Callable[[], Any] = make_mic_track,
        sink_factory: Callable[[], Any] = SpeakerSink,
    ) -> None:
        from aiortc import RTCConfiguration, RTCIceServer, RTCPeerConnection

        servers = [
            RTCIceServer(urls=s.get("urls"), username=s.get("username"), credential=s.get("credential"))
            for s in ice_servers or []
        ]
        self.pc = RTCPeerConnection(RTCConfiguration(iceServers=servers))
        self.mic = mic_factory()
        self.pc.addTrack(self.mic)
        self.sink = None
        self._sink_factory = sink_factory

        @self.pc.on("track")
        def on_track(track: Any) -> None:
            if track.kind == "audio":
                self.sink = self._sink_factory()
                self.sink.play(track)

    async def answer(self, offer: dict[str, str]) -> dict[str, str]:
        from aiortc import RTCSessionDescription

        await self.pc.setRemoteDescription(RTCSessionDescription(sdp=offer["sdp"], type=offer["type"]))
        await self.pc.setLocalDescription(await self.pc.createAnswer())
        # aiortc gathers every candidate before resolving: the answer is complete (no trickle).
        return {"type": self.pc.localDescription.type, "sdp": self.pc.localDescription.sdp}

    async def close(self) -> None:
        with contextlib.suppress(Exception):
            self.mic.stop()
        if self.sink is not None:
            self.sink.stop()
        await self.pc.close()


# ----------------------------------------------------------------------------------- client
class CallClient:
    """Background thread: Socket.io connection for the current driver + the active call."""

    def __init__(
        self,
        api_url: str,
        device_key: str,
        driver_id: Callable[[], str | None],
        say: Callable[[str], None],
        auto_answer_s: float = 3.0,
        on_message: Callable[[str, str], None] | None = None,
    ) -> None:
        self.api_url = api_url.rstrip("/")
        self.on_message = on_message
        self.device_key = device_key
        self.driver_id = driver_id
        self.say = say
        self.auto_answer_s = auto_answer_s
        self.in_call = False
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True, name="calls")

    def start(self) -> CallClient:
        self._thread.start()
        return self

    def stop(self) -> None:
        self._stop.set()

    def _run(self) -> None:
        asyncio.run(self._main())

    async def _main(self) -> None:
        current: str | None = None
        sio: Any = None
        session: dict[str, Any] = {}

        async def hang_up(reason: str = "") -> None:
            s = session.pop("call", None)
            session.pop("id", None)
            self.in_call = False
            if s is not None:
                await s.close()
                self.say("Call ended.")
                log.info(f"call ended {reason}")

        while not self._stop.is_set():
            want = self.driver_id()
            if want != current or (sio is not None and not sio.connected):
                if sio is not None:
                    await hang_up("(reconnecting)")
                    with contextlib.suppress(Exception):
                        await sio.disconnect()
                    sio = None
                current = want
                if want:
                    sio = self._client(session, hang_up)
                    try:
                        await sio.connect(
                            self.api_url,
                            auth={"deviceKey": self.device_key, "driverId": want},
                            transports=["websocket"],
                            wait_timeout=10,
                        )
                        log.info("calls: ready (the parent can call this car)")
                    except Exception as exc:  # noqa: BLE001 - offline: retry
                        log.debug(f"calls: connect failed ({exc})")
                        sio = None
                        current = None
            await asyncio.sleep(2.0)
        await hang_up()
        if sio is not None:
            with contextlib.suppress(Exception):
                await sio.disconnect()

    def _client(self, session: dict[str, Any], hang_up: Callable[[str], Any]) -> Any:
        """A Socket.io client whose handlers always reply on *this* connection."""
        import socketio

        sio = socketio.AsyncClient(reconnection=False)

        @sio.on("call:incoming")
        async def incoming(data: dict) -> None:
            if session.get("id"):
                await sio.emit("call:decline", {"callId": data["callId"]})
                return
            session["id"] = data["callId"]
            session["ice"] = data.get("iceServers") or []
            name = (data.get("callerName") or "Your parent").split(" ")[0]
            self.say(f"{name} is calling. Answering in {int(self.auto_answer_s)} seconds.")
            log.info(f"incoming call from {data.get('callerName')}")
            await asyncio.sleep(self.auto_answer_s)
            if session.get("id") != data["callId"]:
                return  # the parent hung up while it was ringing
            try:
                session["call"] = CallSession(session["ice"])
            except Exception as exc:  # noqa: BLE001 - no microphone, etc.
                log.warning(f"cannot answer the call: {exc}")
                await sio.emit("call:decline", {"callId": data["callId"]})
                session.clear()
                return
            self.in_call = True
            await sio.emit("call:accept", {"callId": data["callId"]})

        @sio.on("call:signal")
        async def signal(data: dict) -> None:
            s = session.get("call")
            payload = data.get("data") or {}
            if s is not None and payload.get("type") == "offer":
                answer = await s.answer(payload)
                await sio.emit("call:signal", {"callId": data["callId"], "data": answer})
                log.info("call connected")

        @sio.on("driver:message")
        async def message(data: dict) -> None:
            """A parent's message or reminder: read aloud, shown on screen, confirmed."""
            who = (data.get("fromName") or "your family").split(" ")[0]
            text = str(data.get("text") or "").strip()
            if not text:
                return
            label = "Reminder" if data.get("kind") == "reminder" else "Message"
            self.say(f"{label} from {who}. {text}")
            log.info(f"{label.lower()} from {data.get('fromName')}: {text}")
            if self.on_message:
                self.on_message(f"{label} from {who}", text)
            await sio.emit("message:delivered", {"id": data.get("id")})

        @sio.on("call:ended")
        async def ended(data: dict) -> None:
            if data.get("callId") == session.get("id"):
                if "call" not in session:
                    session.clear()  # ended while still ringing
                await hang_up(f"({data.get('reason')})")

        return sio


def start_calls(
    api_url: str,
    device_key: str,
    driver_id: Callable[[], str | None],
    say: Callable[[str], None],
    auto_answer_s: float,
    on_message: Callable[[str, str], None] | None = None,
) -> CallClient | None:
    missing = available()
    if missing:
        log.info(f"calls off: {missing}")
        return None
    return CallClient(api_url, device_key, driver_id, say, auto_answer_s, on_message).start()


__all__ = ["CallClient", "CallSession", "available", "start_calls", "time"]
