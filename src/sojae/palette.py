"""상품 사진에서 강조색을 뽑는다.

배지와 밑줄 색을 상품 색에서 가져오면 소재가 브랜드처럼 보인다.
무채색·흰배경 상품이 많으므로 채도가 낮은 색은 걸러낸다.
"""

from __future__ import annotations

import colorsys

from PIL import Image


def _hsv(rgb: tuple[int, int, int]) -> tuple[float, float, float]:
    r, g, b = (c / 255 for c in rgb)
    return colorsys.rgb_to_hsv(r, g, b)


def accent(image: Image.Image, *, fallback: tuple[int, int, int] = (230, 57, 70)):
    """가장 눈에 띄는 유채색을 고른다. 없으면 기본 강조색."""
    small = image.convert("RGB").resize((96, 96), Image.Resampling.BILINEAR)
    reduced = small.quantize(colors=12, method=Image.Quantize.FASTOCTREE)
    palette = reduced.getpalette() or []
    counts = sorted(reduced.getcolors() or [], reverse=True)

    best = None
    best_score = 0.0
    for count, index in counts:
        rgb = tuple(palette[index * 3 : index * 3 + 3])
        if len(rgb) != 3:
            continue
        _, saturation, value = _hsv(rgb)
        if saturation < 0.35 or value < 0.25 or value > 0.95:
            continue
        score = saturation * value * (count ** 0.4)
        if score > best_score:
            best_score, best = score, rgb
    return best or fallback


def readable_on(rgb: tuple[int, int, int]) -> tuple[int, int, int]:
    """해당 색 위에 올릴 글자색."""
    luminance = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255
    return (24, 24, 28) if luminance > 0.6 else (255, 255, 255)
