"""Text in any language on the OpenCV screen.

cv2.putText only draws ASCII (Chinese, ñ or é come out as "???"), so text with other characters is
drawn with Pillow and a system font that has them. Without Pillow or a font, it falls back to ASCII.
"""

from __future__ import annotations

import os
from functools import lru_cache

import numpy as np

from ui.lang import detect

_WIN = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts")
_NOTO_CJK = [
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
]
_LATIN = ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf"]
# Fonts to try per language (Windows first, then Raspberry Pi OS / Debian packages).
_FONTS = {
    "ko": [os.path.join(_WIN, "malgun.ttf"), *_NOTO_CJK],
    "hi": [os.path.join(_WIN, "Nirmala.ttc"), "/usr/share/fonts/truetype/noto/NotoSansDevanagari-Regular.ttf"],
    "th": [os.path.join(_WIN, "LeelawUI.ttf"), "/usr/share/fonts/truetype/noto/NotoSansThai-Regular.ttf"],
    "ar": [os.path.join(_WIN, "segoeui.ttf"), "/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf"],
    # Microsoft YaHei / Noto CJK also cover Latin letters with accents and Cyrillic
    "default": [os.path.join(_WIN, "msyh.ttc"), os.path.join(_WIN, "segoeui.ttf"), *_NOTO_CJK, *_LATIN],
}


def needs_unicode(text: str) -> bool:
    return any(ord(ch) > 126 for ch in text)


@lru_cache(maxsize=32)
def _font(lang: str, px: int):  # noqa: ANN202 - PIL type only when installed
    try:
        from PIL import ImageFont
    except ImportError:
        return None
    for path in [*_FONTS.get(lang, []), *_FONTS["default"]]:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, px)
            except OSError:
                continue
    return None


def font_for(text: str, px: int):  # noqa: ANN201
    return _font(detect(text) if detect(text) in _FONTS else "default", px)


def wrap(text: str, font, max_w: int, max_lines: int = 2) -> list[str]:  # noqa: ANN001
    """Lines that fit max_w pixels; by word, or by character for text without spaces (Chinese)."""
    units = text.split(" ") if " " in text.strip() else list(text)
    sep = " " if " " in text.strip() else ""
    lines: list[str] = []
    cur = ""
    for u in units:
        cand = f"{cur}{sep}{u}" if cur else u
        if font.getlength(cand) <= max_w:
            cur = cand
            continue
        if cur:
            lines.append(cur)
        cur = u
        if len(lines) == max_lines:
            break
    if cur and len(lines) < max_lines:
        lines.append(cur)
    if len(lines) == max_lines and font.getlength(sep.join(lines)) < font.getlength(text) - 1:
        lines[-1] = lines[-1].rstrip()[:-1] + "…"
    return lines


def draw_lines(
    img: np.ndarray,
    lines: list[str],
    x: int,
    top: int,
    px: int,
    color: tuple[int, int, int],
    font=None,  # noqa: ANN001
    gap: int = 4,
) -> bool:
    """Draw lines (BGR colour) starting at the top-left corner; False when Pillow/font is missing."""
    font = font or font_for(" ".join(lines), px)
    if font is None:
        return False
    from PIL import Image, ImageDraw

    h = (px + gap) * len(lines) + gap
    w = int(max(font.getlength(ln) for ln in lines)) + 4 if lines else 0
    y0, y1 = max(0, top), min(img.shape[0], top + h)
    x0, x1 = max(0, x), min(img.shape[1], x + w)
    if y1 <= y0 or x1 <= x0:
        return True
    region = Image.fromarray(img[y0:y1, x0:x1][:, :, ::-1].copy())
    d = ImageDraw.Draw(region)
    for i, ln in enumerate(lines):
        d.text((x - x0, top - y0 + i * (px + gap)), ln, font=font, fill=(color[2], color[1], color[0]))
    img[y0:y1, x0:x1] = np.asarray(region)[:, :, ::-1]
    return True
