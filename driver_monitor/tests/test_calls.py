"""Voice calls: a real WebRTC connection between a "parent" peer and the car's CallSession.

Audio devices are replaced by a tone generator and a frame counter, so this runs anywhere.
"""

from __future__ import annotations

import asyncio
import fractions

import numpy as np
import pytest

aiortc = pytest.importorskip("aiortc")
from aiortc import MediaStreamTrack, RTCPeerConnection, RTCSessionDescription  # noqa: E402
from av import AudioFrame  # noqa: E402

from transport.calls import FRAME_SAMPLES, SAMPLE_RATE, CallSession, available  # noqa: E402


class Tone(MediaStreamTrack):
    kind = "audio"

    def __init__(self, hz: float) -> None:
        super().__init__()
        self.hz = hz
        self.pts = 0

    async def recv(self):
        await asyncio.sleep(FRAME_SAMPLES / SAMPLE_RATE)
        t = (np.arange(FRAME_SAMPLES) + self.pts) / SAMPLE_RATE
        data = (np.sin(2 * np.pi * self.hz * t) * 8000).astype(np.int16).reshape(1, -1)
        frame = AudioFrame.from_ndarray(data, format="s16", layout="mono")
        frame.sample_rate = SAMPLE_RATE
        frame.pts = self.pts
        frame.time_base = fractions.Fraction(1, SAMPLE_RATE)
        self.pts += FRAME_SAMPLES
        return frame


class CountingSink:
    def __init__(self) -> None:
        self.frames = 0
        self.task = None

    def play(self, track) -> None:
        async def run() -> None:
            try:
                while True:
                    await track.recv()
                    self.frames += 1
            except Exception:  # noqa: BLE001 - track ended
                pass

        self.task = asyncio.ensure_future(run())

    def stop(self) -> None:
        if self.task:
            self.task.cancel()


def test_calls_are_available_here() -> None:
    assert available() is None


def test_audio_flows_both_ways_through_a_real_webrtc_call() -> None:
    async def scenario() -> tuple[int, int]:
        sinks: list[CountingSink] = []

        def sink() -> CountingSink:
            s = CountingSink()
            sinks.append(s)
            return s

        car = CallSession([], mic_factory=lambda: Tone(440), sink_factory=sink)  # no STUN needed locally

        parent = RTCPeerConnection()
        parent.addTrack(Tone(880))
        heard_from_car = CountingSink()
        parent.on("track", lambda track: heard_from_car.play(track))

        await parent.setLocalDescription(await parent.createOffer())
        answer = await car.answer({"type": parent.localDescription.type, "sdp": parent.localDescription.sdp})
        assert answer["type"] == "answer" and "m=audio" in answer["sdp"]
        await parent.setRemoteDescription(RTCSessionDescription(**answer))

        for _ in range(100):  # up to 10 s for ICE + DTLS + some audio
            await asyncio.sleep(0.1)
            if sinks and sinks[0].frames > 10 and heard_from_car.frames > 10:
                break
        result = (sinks[0].frames if sinks else 0, heard_from_car.frames)
        heard_from_car.stop()
        await car.close()
        await parent.close()
        return result

    car_heard, parent_heard = asyncio.run(scenario())
    assert car_heard > 10, "the car did not receive the parent's voice"
    assert parent_heard > 10, "the parent did not receive the car's microphone"
