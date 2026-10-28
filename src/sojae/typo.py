"""한글 타이포 합성 엔진.

이 모듈이 제품의 핵심이다. 이미지 생성 모델은 한글 글자를 정확히 그리지
못하므로, 배경만 모델에 맡기고 글자는 여기서 코드로 정확히 올린다.

한글에 필요한 처리가 영문과 다르다.
  - 어절(공백) 단위로 끊는다. 단어 중간에서 끊으면 가독성이 무너진다.
  - 금칙 처리: 줄 끝에 여는 괄호, 줄 머리에 닫는 괄호나 문장부호를 두지 않는다.
  - 한 어절이 한 줄보다 길면 그때만 글자 단위로 끊는다.
"""

from __future__ import annotations

from dataclasses import dataclass

from PIL import Image, ImageDraw, ImageFilter, ImageFont

# 줄 머리에 올 수 없는 글자
NO_LINE_START = set("..,,!?)]}>』」”’%‰℃원개월년일시분초")
# 줄 끝에 올 수 없는 글자
NO_LINE_END = set("([{<『「“‘₩$")


@dataclass
class TextBlock:
    """맞춤이 끝난 텍스트 묶음."""

    lines: list[str]
    font_size: int
    line_height: int
    width: int
    height: int


def measure(font: ImageFont.FreeTypeFont, text: str) -> int:
    if not text:
        return 0
    box = font.getbbox(text)
    return box[2] - box[0]


def _split_long_word(
    word: str, font: ImageFont.FreeTypeFont, max_width: int
) -> list[str]:
    """한 어절이 한 줄을 넘을 때만 글자 단위로 끊는다."""
    parts: list[str] = []
    current = ""
    for ch in word:
        if current and measure(font, current + ch) > max_width:
            parts.append(current)
            current = ch
        else:
            current += ch
    if current:
        parts.append(current)
    return parts


def _apply_prohibition(lines: list[str]) -> list[str]:
    """금칙 처리: 줄 머리의 문장부호를 앞 줄로 넘긴다."""
    out = [list(line) for line in lines]
    for i in range(1, len(out)):
        while out[i] and out[i][0] in NO_LINE_START and len(out[i]) > 1:
            out[i - 1].append(out[i].pop(0))
        # 앞 줄 끝이 여는 괄호면 다음 줄로 내린다.
        while out[i - 1] and out[i - 1][-1] in NO_LINE_END:
            out[i].insert(0, out[i - 1].pop())
    return ["".join(line).strip() for line in out if line]


def wrap(text: str, font: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
    """어절 단위로 줄을 나눈다. 줄바꿈 문자는 그대로 존중한다."""
    lines: list[str] = []
    for hard_line in text.split("\n"):
        words = hard_line.split()
        if not words:
            lines.append("")
            continue
        current = ""
        for word in words:
            if measure(font, word) > max_width:
                if current:
                    lines.append(current)
                    current = ""
                chunks = _split_long_word(word, font, max_width)
                lines.extend(chunks[:-1])
                current = chunks[-1]
                continue
            trial = f"{current} {word}".strip()
            if current and measure(font, trial) > max_width:
                lines.append(current)
                current = word
            else:
                current = trial
        if current:
            lines.append(current)
    return _apply_prohibition(lines) or [""]


def fit(
    text: str,
    face,
    *,
    box_width: int,
    box_height: int,
    max_size: int,
    min_size: int = 18,
    line_spacing: float = 1.22,
    max_lines: int | None = None,
) -> TextBlock:
    """상자 안에 들어가는 가장 큰 글자 크기를 찾는다.

    이진 탐색이 아니라 큰 쪽에서 내려온다. 큰 글자가 광고 성과에 유리하므로
    조건을 만족하는 첫 크기에서 멈춘다.
    """
    if not text.strip():
        raise ValueError("빈 문자열은 배치할 수 없습니다")

    for size in range(max_size, min_size - 1, -2):
        font = face.load(size)
        lines = wrap(text, font, box_width)
        if max_lines is not None and len(lines) > max_lines:
            continue
        line_height = round(size * line_spacing)
        total = line_height * len(lines)
        if total <= box_height:
            widest = max((measure(font, line) for line in lines), default=0)
            return TextBlock(lines, size, line_height, widest, total)

    # 최소 크기로도 안 들어가면 줄 수를 제한해서라도 넣는다.
    font = face.load(min_size)
    lines = wrap(text, font, box_width)
    line_height = round(min_size * line_spacing)
    allowed = max(1, box_height // line_height)
    if len(lines) > allowed:
        lines = lines[:allowed]
        lines[-1] = lines[-1][: max(1, len(lines[-1]) - 1)] + "…"
    widest = max((measure(font, line) for line in lines), default=0)
    return TextBlock(lines, min_size, line_height, widest, line_height * len(lines))


def mean_luminance(image: Image.Image, box: tuple[int, int, int, int]) -> float:
    """영역의 평균 밝기(0~1). 글자 색을 자동으로 고르는 데 쓴다."""
    left, top, right, bottom = box
    left, top = max(0, left), max(0, top)
    right = min(image.width, right)
    bottom = min(image.height, bottom)
    if right <= left or bottom <= top:
        return 0.5
    patch = image.convert("RGB").crop((left, top, right, bottom))
    # 1x1 로 줄이면 그 픽셀이 곧 영역 평균색이다.
    r, g, b = patch.resize((1, 1), Image.Resampling.BILINEAR).getpixel((0, 0))
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255


def contrast_color(luminance: float) -> tuple[tuple[int, int, int], tuple[int, int, int]]:
    """(글자색, 그림자색). 밝은 배경에는 검정, 어두운 배경에는 흰색."""
    if luminance > 0.55:
        return (24, 24, 28), (255, 255, 255)
    return (255, 255, 255), (0, 0, 0)


def scrim(
    image: Image.Image,
    box: tuple[int, int, int, int],
    *,
    opacity: int = 120,
    dark: bool = True,
    direction: str = "both",
) -> Image.Image:
    """텍스트 영역에 그라데이션 막을 덮어 가독성을 확보한다.

    direction 은 어디가 가장 진한지를 정한다.
      "down" 위가 진하고 아래로 갈수록 투명 (상단 밴드)
      "up"   아래가 진하고 위로 갈수록 투명 (하단 밴드)
      "both" 가운데가 진하고 양끝이 투명 (중앙 밴드)

    화면 가장자리에 붙는 밴드를 "both" 로 깔면 정작 글자가 앉는 가장자리가
    투명해져 대비가 무너진다.
    """
    left, top, right, bottom = box
    height = max(1, bottom - top)
    base = (0, 0, 0) if dark else (255, 255, 255)
    layer = Image.new("RGBA", (max(1, right - left), height), base + (0,))
    draw = ImageDraw.Draw(layer)
    for y in range(height):
        pos = y / height
        if direction == "down":
            weight = (1 - pos) ** 0.9
        elif direction == "up":
            weight = pos ** 0.9
        else:
            weight = 1 - abs(2 * pos - 1) ** 1.8
        draw.line([(0, y), (layer.width, y)], fill=base + (int(opacity * weight),))
    layer = layer.filter(ImageFilter.GaussianBlur(2))
    out = image.convert("RGBA")
    out.alpha_composite(layer, dest=(left, top))
    return out


def draw_block(
    image: Image.Image,
    block: TextBlock,
    face,
    *,
    box: tuple[int, int, int, int],
    align: str = "center",
    valign: str = "middle",
    color: tuple[int, int, int] | None = None,
    shadow: tuple[int, int, int] | None = None,
    shadow_offset: int = 3,
    stroke: int = 0,
) -> Image.Image:
    """맞춤이 끝난 텍스트를 실제로 그린다."""
    left, top, right, bottom = box
    font = face.load(block.font_size)

    if color is None:
        luminance = mean_luminance(image, box)
        color, shadow = contrast_color(luminance)

    if valign == "middle":
        y = top + (bottom - top - block.height) // 2
    elif valign == "bottom":
        y = bottom - block.height
    else:
        y = top

    canvas = image.convert("RGBA")
    draw = ImageDraw.Draw(canvas)
    for line in block.lines:
        line_width = measure(font, line)
        if align == "center":
            x = left + (right - left - line_width) // 2
        elif align == "right":
            x = right - line_width
        else:
            x = left
        if shadow is not None:
            draw.text(
                (x + shadow_offset, y + shadow_offset),
                line,
                font=font,
                fill=shadow + (150,),
            )
        draw.text(
            (x, y),
            line,
            font=font,
            fill=color,
            stroke_width=stroke,
            stroke_fill=shadow if stroke else None,
        )
        y += block.line_height
    return canvas


def text_area_ratio(block: TextBlock, spec_size: tuple[int, int]) -> float:
    """소재에서 글자가 차지하는 면적 비율.

    글자가 너무 많으면 광고 성과가 떨어진다. 경고용 지표로 쓴다.
    """
    width, height = spec_size
    return (block.width * block.height) / (width * height)
