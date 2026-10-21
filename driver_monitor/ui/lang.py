"""Which language a parent's message is written in, so the car can pick a matching voice.

Offline and dependency-free: the writing system decides for non-Latin scripts (Chinese, Japanese,
Korean, Thai, Arabic, Cyrillic, Hindi); for Latin-script text, common words tell Tagalog / Filipino
(and Taglish, which mixes it with English), Cebuano / Bisaya and Spanish apart from English.
"""

from __future__ import annotations

import re

NAMES = {
    "en": "English",
    "fil": "Filipino",
    "ceb": "Bisaya",
    "es": "Spanish",
    "zh": "Chinese",
    "ja": "Japanese",
    "ko": "Korean",
    "th": "Thai",
    "ar": "Arabic",
    "ru": "Russian",
    "hi": "Hindi",
}

# Ranges of the writing systems the car may receive.
_SCRIPTS = [
    ("ja", re.compile(r"[぀-ヿ]")),  # hiragana / katakana (checked before Chinese characters)
    ("ko", re.compile(r"[가-힯ᄀ-ᇿ]")),
    ("zh", re.compile(r"[一-鿿㐀-䶿]")),
    ("th", re.compile(r"[฀-๿]")),
    ("ar", re.compile(r"[؀-ۿ]")),
    ("ru", re.compile(r"[Ѐ-ӿ]")),
    ("hi", re.compile(r"[ऀ-ॿ]")),
]

# Short, frequent words; a message is scored by how many of its words appear in each list.
_WORDS = {
    "fil": set(
        "ang ng mga sa po opo ka ko mo na ikaw ako ikaw kayo tayo natin namin ninyo ito iyan yan "
        "hindi wag huwag ingat mag magpahinga pahinga muna ba naman lang talaga nasaan saan kailan "
        "anak inay itay nanay tatay mahal kita uwi umuwi kain kumain gising tulog antok inaantok "
        "dahan dahan bilis bagal tigil huminto sige salamat pakiusap paki kasi kung pag pero rin din "
        "ngayon mamaya bukas kanina dito diyan doon".split()
    ),
    "ceb": set(
        "ug og sa nga ang ka ko mo nimo imo imong akong ako ikaw kamo kita ta ni kini kana diha dinhi "
        "didto dili ayaw amping pag-amping palihug palihog salamat kaayo unsa asa kanus-a karon "
        "unya ugma ganina lang gyud jud na pa ra man diay kay kung pero sab usab pahuway pahulay "
        "katulog tulog kaon mokaon uli mouli hinay paspas hunong mohunong anak nanay tatay gihigugma".split()
    ),
    "es": set(
        "el la los las de del que y en un una por para con no si muy pero como cuando donde "
        "hijo hija mamá papá cuidado despacio descansa descansar gracias por favor ahora".split()
    ),
    "en": set(
        "the a an and is are be to of you your please stop drive driving rest take break now home "
        "call me when safe slow down careful love we i it this that with for on at in".split()
    ),
}
# Words both Filipino lists share don't decide between them.
_SHARED = _WORDS["fil"] & _WORDS["ceb"]


def detect(text: str) -> str:
    """Language code from NAMES ('en' when unsure)."""
    t = text or ""
    for code, rx in _SCRIPTS:
        if rx.search(t):
            return code
    words = re.findall(r"[a-zA-ZñÑáéíóúü'-]+", t.lower())
    if not words:
        return "en"
    score = {k: sum(w in v for w in words) for k, v in _WORDS.items()}
    # Cebuano and Tagalog share many words; only the words that differ decide between them.
    fil_only = sum(w in _WORDS["fil"] and w not in _SHARED for w in words)
    ceb_only = sum(w in _WORDS["ceb"] and w not in _SHARED for w in words)
    filipino = max(score["fil"], score["ceb"])
    if filipino >= max(1, score["es"]) and filipino * 3 >= score["en"]:
        # Taglish ("Ingat ka, text me pag nasa bahay ka na") counts as Filipino.
        return "ceb" if ceb_only > fil_only else "fil"
    if score["es"] > score["en"]:
        return "es"
    return "en"


def is_latin(code: str) -> bool:
    """Written in Latin letters, so an English voice can still sound it out."""
    return code in ("en", "fil", "ceb", "es")
