"""Parents' messages in Tagalog, Bisaya, Taglish, Chinese and other languages."""

from __future__ import annotations

import numpy as np
import pytest

from ui import hud, unitext
from ui.lang import detect
from ui.voice import _clean, speak_message


@pytest.mark.parametrize(
    ("text", "lang"),
    [
        ("Please take a break and drive safely", "en"),
        ("Call me when you stop", "en"),
        ("Ingat ka anak, magpahinga ka muna", "fil"),
        ("Text me pag nasa bahay ka na, ingat", "fil"),  # Taglish
        ("Okay ka lang ba? Huminto ka muna", "fil"),
        ("Amping kaayo, palihug pahuway sa", "ceb"),
        ("Hinay-hinay lang, ayaw pagdali nimo", "ceb"),
        ("Cuidado hijo, descansa por favor", "es"),
        ("小心驾驶，请休息一下", "zh"),
        ("気をつけて運転してね", "ja"),
        ("조심히 운전해", "ko"),
        ("Будь осторожен", "ru"),
    ],
)
def test_language_is_detected(text: str, lang: str) -> None:
    assert detect(text) == lang


class FakeSpeaker:
    def __init__(self, voices: set[str]) -> None:
        self.voices = voices
        self.said: list = []

    def __call__(self, text: str, lang: str = "en") -> None:
        self.said.append(text)

    def has_voice(self, lang: str) -> bool:
        return lang == "en" or lang in self.voices

    def say_parts(self, parts: list) -> None:
        self.said.append(parts)


def test_a_message_is_read_in_its_own_voice_when_the_car_has_one() -> None:
    sp = FakeSpeaker({"zh"})
    assert speak_message(sp, "Message from Mom", "小心驾驶") == "zh"
    assert sp.said == [[("Message from Mom.", "en"), ("小心驾驶", "zh")]]


def test_tagalog_and_bisaya_are_sounded_out_by_the_english_voice() -> None:
    sp = FakeSpeaker(set())
    speak_message(sp, "Reminder from Mom", "Ingat ka anak")
    assert sp.said == ["Reminder from Mom. Ingat ka anak"]


def test_unpronounceable_text_is_announced_and_left_on_screen() -> None:
    sp = FakeSpeaker(set())
    speak_message(sp, "Message from Dad", "小心驾驶")
    assert "written in Chinese" in sp.said[0] and "on the screen" in sp.said[0]


def test_letters_of_any_language_survive_sanitising() -> None:
    assert _clean("小心驾驶，请休息'); rm -rf") == "小心驾驶，请休息 rm -rf"
    assert _clean("Mag-ingat ka, anak ñ é!") == "Mag-ingat ka, anak ñ é!"


def test_the_screen_draws_chinese_text() -> None:
    if unitext.font_for("小心", 16) is None:
        pytest.skip("no CJK font / Pillow on this machine")
    frame = np.full((480, 640, 3), 90, np.uint8)
    a = hud.render(frame, hud.HudState(message=("Message from Mom", "小心驾驶，请休息一下")), 0.0)
    b = hud.render(frame, hud.HudState(message=("Message from Mom", "请您注意安全驾驶")), 0.0)
    assert (a != b).any()  # different characters drawn, not the same "???"


def test_long_text_wraps_to_two_lines() -> None:
    font = unitext.font_for("Ingat ka", 16)
    if font is None:
        pytest.skip("no font / Pillow on this machine")
    lines = unitext.wrap("Ingat ka anak, magpahinga ka muna bago ka magmaneho ulit pauwi " * 3, font, 300, 2)
    assert len(lines) == 2 and lines[-1].endswith("…")


def test_the_language_chosen_in_the_app_wins_over_detection() -> None:
    sp = FakeSpeaker({"fil"})
    # "Okay" alone looks English, but the parent picked Filipino in the app
    assert speak_message(sp, "Message from Mom", "Okay", "fil") == "fil"
    assert sp.said == [[("Message from Mom.", "en"), ("Okay", "fil")]]
    assert speak_message(FakeSpeaker(set()), "M", "Ingat ka", "auto") == "fil"
