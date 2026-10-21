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

from ui.lang import NAMES, detect, is_latin

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
# Sentence punctuation of Chinese / Japanese text is kept (it is not a shell character).
_PUNCT = " .,!?-、。，！？"


def _clean(text: str) -> str:
    """Letters (any language), digits and plain punctuation only: no quotes or shell characters
    reach the engine command (the driver's name and parents' messages come from the server)."""
    return " ".join("".join(ch for ch in text if ch.isalnum() or ch in _PUNCT).split())


# Parts of one utterance: (text, language code from ui.lang). Spoken in order, as one job.
Part = tuple[str, str]
Command = Callable[[str, str], list[str]]


class Speaker:
    """Speaks one utterance at a time on a background thread; never blocks the camera loop.

    If a new utterance arrives while one is queued, the queued one is replaced (the newest
    situation matters most). An utterance may switch language part way ("Message from Mom." in
    English, then the message in Chinese) when the engine has a voice for it."""

    def __init__(
        self,
        command: Command | None,
        name: str,
        languages: Callable[[], set[str]] | None = None,
    ) -> None:
        self.command = command
        self.name = name
        self._languages = languages
        self._known: set[str] | None = None
        self._q: queue.Queue[list[Part]] = queue.Queue(maxsize=1)
        if command is not None:
            threading.Thread(target=self._loop, daemon=True).start()

    def __call__(self, text: str, lang: str = "en") -> None:
        self.say_parts([(text, lang)])

    def has_voice(self, lang: str) -> bool:
        """True when the engine has a voice for this language (English always)."""
        if lang == "en":
            return True
        if self._known is None:
            try:
                self._known = self._languages() if self._languages else set()
            except Exception as exc:  # noqa: BLE001 - a failed probe just means "English only"
                log.warning(f"voice ({self.name}): could not list voices: {exc}")
                self._known = set()
            log.info(f"voice ({self.name}) languages: en {' '.join(sorted(self._known))}")
        return lang in self._known

    def say_parts(self, parts: list[Part]) -> None:
        if self.command is None or not parts:
            return
        log.info("voice: " + " ".join(t for t, _ in parts))
        try:
            self._q.put_nowait(parts)
        except queue.Full:
            try:
                self._q.get_nowait()
            except queue.Empty:
                pass
            self._q.put_nowait(parts)

    def _loop(self) -> None:
        assert self.command is not None
        while True:
            for text, lang in self._q.get():
                try:
                    subprocess.run(
                        self.command(_clean(text), lang),  # noqa: S603 - fixed command, sanitised text
                        check=False,
                        timeout=60,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                    )
                except (OSError, subprocess.SubprocessError) as exc:
                    log.warning(f"voice ({self.name}) failed: {exc}")


def speak_message(speaker: Callable[[str], None], intro: str, text: str) -> str:
    """Read a parent's message aloud in its own language when the car has a voice for it.

    - A voice for the language is installed: the intro in English, then the message in that voice.
    - No voice, but Latin letters (Tagalog, Bisaya, Taglish, Spanish): the English voice sounds it
      out, which is understandable for these phonetic spellings.
    - No voice and another writing system (e.g. Chinese without a Chinese voice): it can't be
      pronounced, so the car says which language it is and that it is on the screen.
    Returns the language code."""
    lang = detect(text)
    has_voice = getattr(speaker, "has_voice", None)
    say_parts = getattr(speaker, "say_parts", None)
    voiced = bool(has_voice and has_voice(lang))
    if lang != "en" and voiced and say_parts:
        say_parts([(f"{intro}.", "en"), (text, lang)])
    elif is_latin(lang):
        speaker(f"{intro}. {text}")
    else:
        speaker(
            f"{intro}, written in {NAMES.get(lang, 'another language')}. It is on the screen. "
            "Read it only when you have stopped safely."
        )
    return lang


# Language code -> the voice culture prefix (Windows) / eSpeak NG voice names to try.
_SAPI_CULTURE = {
    "fil": "fil",
    "es": "es",
    "zh": "zh",
    "ja": "ja",
    "ko": "ko",
    "th": "th",
    "ar": "ar",
    "ru": "ru",
    "hi": "hi",
}
_ESPEAK_VOICES = {
    "fil": ["tl", "fil"],
    "ceb": ["ceb"],
    "es": ["es"],
    "zh": ["cmn", "zh"],
    "ja": ["ja"],
    "ko": ["ko"],
    "th": ["th"],
    "ar": ["ar"],
    "ru": ["ru"],
    "hi": ["hi"],
}


def _run_lines(cmd: list[str]) -> list[str]:
    out = subprocess.run(  # noqa: S603 - fixed command
        cmd,
        check=False,
        timeout=30,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    return [ln.strip() for ln in (out.stdout or "").splitlines() if ln.strip()]


_SAPI_LIST = (
    "Add-Type -AssemblyName System.Speech;"
    "(New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices()"
    "|?{$_.Enabled}|%{$_.VoiceInfo.Culture.Name}"
)


def _sapi_languages() -> set[str]:
    cultures = [c.lower() for c in _run_lines(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", _SAPI_LIST])]
    return {lang for lang, pre in _SAPI_CULTURE.items() if any(c.startswith(pre) for c in cultures)}


def _sapi(rate: int) -> Command:
    def cmd(text: str, lang: str) -> list[str]:
        pick = ""
        pre = _SAPI_CULTURE.get(lang)
        if pre:  # a voice of that language, when Windows has one installed
            pick = (
                "$v=$s.GetInstalledVoices()|?{$_.Enabled -and $_.VoiceInfo.Culture.Name -like "
                f"'{pre}*'}}|select -First 1;if($v){{$s.SelectVoice($v.VoiceInfo.Name)}};"
            )
        script = (
            "[Console]::OutputEncoding=[Text.Encoding]::UTF8;"
            "Add-Type -AssemblyName System.Speech;"
            "$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;"
            f"{pick}$s.Rate={rate};$s.Speak('{text}')"
        )
        return ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script]

    return cmd


def _piper_models(default: str) -> dict[str, str]:
    """VOICE_MODELS="fil=/home/pi/voices/fil.onnx,zh=/home/pi/voices/zh.onnx" adds voices for
    other languages; VOICE_MODEL stays the English one."""
    models = {"en": default}
    for item in os.environ.get("VOICE_MODELS", "").split(","):
        lang, _, path = item.partition("=")
        if lang.strip() and path.strip() and os.path.exists(path.strip()):
            models[lang.strip()] = path.strip()
    return models


def _piper(models: dict[str, str]) -> Command:
    # piper reads text on stdin; a shell pipe to aplay plays it (Pi: ALSA)
    def cmd(text: str, lang: str) -> list[str]:
        model = models.get(lang, models["en"])
        return [
            "sh",
            "-c",
            f"echo '{text}' | piper --model '{model}' --output-raw | aplay -q -r 22050 -f S16_LE -t raw -",
        ]

    return cmd


def _espeak_exe() -> str:
    return shutil.which("espeak-ng") or "espeak"


def _espeak_installed() -> set[str]:
    # "Pty Language Age/Gender VoiceName File Other Languages": the 2nd column is the voice code
    rows = _run_lines([_espeak_exe(), "--voices"])[1:]
    return {r.split()[1].lower() for r in rows if len(r.split()) > 1}


def _espeak(rate: int) -> tuple[Command, Callable[[], set[str]]]:
    exe = _espeak_exe()
    chosen: dict[str, str] = {}

    def languages() -> set[str]:
        have = _espeak_installed()
        for lang, names in _ESPEAK_VOICES.items():
            for n in names:
                if n in have:
                    chosen[lang] = n
                    break
        return set(chosen)

    def cmd(text: str, lang: str) -> list[str]:
        voice = ["-v", chosen[lang]] if lang in chosen else []
        return [exe, *voice, "-s", str(150 + rate * 10), text]

    return cmd, languages


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
        return Speaker(_sapi(rate), "Windows voice", _sapi_languages)
    if engine == "piper":
        models = _piper_models(model)
        return Speaker(_piper(models), "Piper AI voice", lambda: set(models) - {"en"})
    cmd, languages = _espeak(rate)
    return Speaker(cmd, "eSpeak", languages)
