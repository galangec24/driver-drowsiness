"""Spoken guidance for the driver: short, calm instructions when the in-car alarm changes level.

Works offline (no cloud speech), so it keeps talking without internet:
  - Windows laptop: the built-in Windows speech voice (System.Speech, no extra install)
  - Raspberry Pi / Linux: Piper neural voice ("AI voice") when VOICE_MODEL points to a Piper .onnx
    voice, else eSpeak NG
VOICE_ENGINE=auto | sapi | piper | espeak | off.

What it says (never more than one sentence at a time, so it doesn't distract):
  - greeting when the driver is recognised
  - drowsy (eyes closed / head nod / strong fatigue): pull over and rest
  - fatigue signs (warning): consider a break soon, with the reason
  - eyes off the road / restless movement: eyes on the road
  - back to normal after an alarm: thank you, stay alert
  - every BREAK_EVERY_S of driving (default 2 h): take a 15-minute break
Messages repeat at most every `repeat_s` (same message) and never closer than `gap_s` (any),
except that a more serious level always speaks at once.
"""

from __future__ import annotations

import os
import queue
import shutil
import subprocess
import sys
import threading
from collections.abc import Callable
from dataclasses import dataclass, field

from loguru import logger as log

NONE, MILD, HIGH = 0, 1, 2


def message_for(level: int, reason: str) -> str:
    """The sentence for an alarm level and its reason (WatchAlerter.reason_now)."""
    r = (reason or "").lower()
    if level >= HIGH:
        if "eyes closed" in r:
            return "Your eyes have been closing. Please pull over safely and rest."
        if "nod" in r:
            return "You are nodding off. Please pull over safely and take a break."
        if "eyes off the road" in r:
            return "Eyes on the road, please. Look ahead now."
        return "You seem very drowsy. Please pull over safely and rest before driving on."
    if level == MILD:
        if "eyes off the road" in r:
            return "Please keep your eyes on the road."
        if "restless" in r:
            return "Please settle down and focus on the road."
        if "yawn" in r:
            return "You are yawning a lot. Consider taking a break soon."
        if "blink" in r:
            return "Your eyes look tired. Consider taking a break soon."
        return "You are showing signs of fatigue. Consider taking a break soon."
    return ""


@dataclass
class VoiceGuide:
    speak: Callable[[str], None]
    repeat_s: float = 30.0
    gap_s: float = 8.0
    break_every_s: float = 2 * 3600.0
    _last_text: dict[str, float] = field(default_factory=dict)
    _last_any: float = -1e9
    _level: int = NONE
    _driving_since: float | None = None
    _last_break_note: float | None = None
    greeted: str | None = None
    # After "Thank you" (awake again), mild fatigue reminders wait this long: one blink or a
    # leftover sign must not start the voice again. Drowsy alarms and eyes-off-road still speak.
    settle_s: float = 60.0
    _recovered_at: float = -1e9

    def _say(self, text: str, now: float, urgent: bool = False, repeat_ok: bool = False) -> bool:
        """urgent: skip the gap between sentences; repeat_ok: may repeat the same sentence at once."""
        if not text:
            return False
        if not urgent and now - self._last_any < self.gap_s:
            return False
        if not repeat_ok and now - self._last_text.get(text, -1e9) < self.repeat_s:
            return False
        self._last_text[text] = now
        self._last_any = now
        self.speak(text)
        return True

    def on_alert(self, level: int, reason: str, now: float) -> None:
        """Call when the in-car alarm level changes (WatchAlerter send callback)."""
        previous, self._level = self._level, level
        if level == NONE:
            if previous >= MILD and self._say("Thank you. Stay alert and drive safely.", now):
                self._recovered_at = now
            return
        r = (reason or "").lower()
        fatigue_only = level == MILD and not ("eyes off the road" in r or "restless" in r)
        if fatigue_only and now - self._recovered_at < self.settle_s:
            return
        # A more serious level speaks at once; only a drowsy alarm may repeat its sentence at once.
        self._say(
            message_for(level, reason),
            now,
            urgent=level > previous,
            repeat_ok=level >= HIGH and level > previous,
        )

    def greet(self, name: str | None, now: float) -> None:
        """Once per driver, when they are recognised (or at start in fixed-driver mode)."""
        who = (name or "").strip()
        if self.greeted == (who or "*"):
            return
        self.greeted = who or "*"
        text = (
            f"Hello {who}. Drive safely, I am watching for signs of fatigue."
            if who
            else ("Hello. Drive safely, I am watching for signs of fatigue.")
        )
        self._say(text, now, urgent=True)

    def tick(self, now: float, driving: bool) -> None:
        """Every frame: break reminder after `break_every_s` of continuous driving."""
        if not driving:
            return
        if self._driving_since is None:
            self._driving_since = now
            self._last_break_note = now
            return
        last = self._last_break_note if self._last_break_note is not None else now
        if now - last >= self.break_every_s:
            hours = (now - self._driving_since) / 3600
            span = f"{hours:.0f} hours" if hours >= 1.5 else "a long time"
            if self._say(f"You have been driving for {span}. Please take a fifteen minute break.", now):
                self._last_break_note = now


# ----------------------------------------------------------------------------------- engines
def _clean(text: str) -> str:
    """Letters, digits and plain punctuation only: no quotes or shell characters reach the engine
    command (the driver's name comes from the server)."""
    return " ".join("".join(ch for ch in text if ch.isalnum() or ch in " .,!?-").split())


class Speaker:
    """Speaks one sentence at a time on a background thread; never blocks the camera loop.

    If a new sentence arrives while one is queued, the queued one is replaced (the newest
    situation matters most)."""

    def __init__(self, command: Callable[[str], list[str]] | None, name: str) -> None:
        self.command = command
        self.name = name
        self._q: queue.Queue[str] = queue.Queue(maxsize=1)
        if command is not None:
            threading.Thread(target=self._loop, daemon=True).start()

    def __call__(self, text: str) -> None:
        if self.command is None:
            return
        log.info(f"voice: {text}")
        try:
            self._q.put_nowait(text)
        except queue.Full:
            try:
                self._q.get_nowait()
            except queue.Empty:
                pass
            self._q.put_nowait(text)

    def _loop(self) -> None:
        while True:
            text = self._q.get()
            try:
                subprocess.run(
                    self.command(_clean(text)),  # noqa: S603 - fixed engine command, sanitised text
                    check=False,
                    timeout=30,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                )
            except (OSError, subprocess.SubprocessError) as exc:
                log.warning(f"voice ({self.name}) failed: {exc}")


def _sapi(rate: int) -> Callable[[str], list[str]]:
    def cmd(text: str) -> list[str]:
        script = (
            "Add-Type -AssemblyName System.Speech;"
            "$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;"
            f"$s.Rate={rate};$s.Speak('{text}')"
        )
        return ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script]

    return cmd


def _piper(model: str) -> Callable[[str], list[str]]:
    # piper reads text on stdin; a shell pipe to aplay plays it (Pi: ALSA)
    def cmd(text: str) -> list[str]:
        return [
            "sh",
            "-c",
            f"echo '{text}' | piper --model '{model}' --output-raw | aplay -q -r 22050 -f S16_LE -t raw -",
        ]

    return cmd


def _espeak(rate: int) -> Callable[[str], list[str]]:
    exe = shutil.which("espeak-ng") or "espeak"
    return lambda text: [exe, "-s", str(150 + rate * 10), text]


def make_speaker(engine: str = "auto", model: str = "", rate: int = 0) -> Speaker:
    engine = (engine or "auto").lower()
    if engine == "off":
        return Speaker(None, "off")
    if engine == "auto":
        if sys.platform == "win32":
            engine = "sapi"
        elif model and os.path.exists(model) and shutil.which("piper") and shutil.which("aplay"):
            engine = "piper"
        elif shutil.which("espeak-ng") or shutil.which("espeak"):
            engine = "espeak"
        else:
            log.warning(
                "voice guidance off: install Piper (VOICE_MODEL) or espeak-ng (sudo apt install espeak-ng)"
            )
            return Speaker(None, "off")
    if engine == "sapi":
        return Speaker(_sapi(rate), "Windows voice")
    if engine == "piper":
        return Speaker(_piper(model), "Piper AI voice")
    return Speaker(_espeak(rate), "eSpeak")
