"""소재 합성.

배경 이미지 위에 한글 문구를 정확히 올린다. 글자는 생성 모델에 맡기지
않는다 - 이미지 모델은 한글 글리프를 제대로 그리지 못한다.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw

from . import fonts, palette, typo
from .creative import Creative
from .spec import Spec

LAYOUTS = ("top_band", "bottom_card", "center_hero", "split")


@dataclass
class Rendered:
    image: Image.Image
    layout: str
    spec: Spec
    creative: Creative
    headline_size: int
    text_ratio: float
    warnings: list[str]

    def save(self, path: str | Path) -> Path:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        self.image.convert("RGB").save(path, quality=92, optimize=True)
        return path


def cover_fit(image: Image.Image, spec: Spec) -> Image.Image:
    """규격을 꽉 채우도록 잘라낸다. 비율을 왜곡하지 않는다."""
    source = image.convert("RGB")
    target = spec.ratio
    width, height = source.size
    if width / height > target:
        new_width = round(height * target)
        left = (width - new_width) // 2
        source = source.crop((left, 0, left + new_width, height))
    else:
        new_height = round(width / target)
        # 상품 사진은 위쪽에 피사체가 오는 경우가 많아 상단을 조금 더 남긴다.
        top = max(0, round((height - new_height) * 0.4))
        source = source.crop((0, top, width, top + new_height))
    return source.resize(spec.size, Image.Resampling.LANCZOS)


def _pill(
    canvas: Image.Image,
    text: str,
    face,
    *,
    center: tuple[int, int],
    fill: tuple[int, int, int],
    size: int,
    pad: int = 0,
) -> None:
    """배지·CTA 용 둥근 사각형."""
    if not text:
        return
    font = face.load(size)
    pad = pad or round(size * 0.55)
    width = typo.measure(font, text) + pad * 2
    height = round(size * 1.9)
    x, y = center[0] - width // 2, center[1] - height // 2

    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle(
        [x, y, x + width, y + height], radius=height // 2, fill=fill + (245,)
    )
    color = palette.readable_on(fill)
    box = font.getbbox(text)
    draw.text(
        (center[0] - (box[2] - box[0]) // 2, center[1] - (box[3] + box[1]) // 2),
        text,
        font=font,
        fill=color,
    )


def compose(
    product_image: Image.Image,
    creative: Creative,
    spec: Spec,
    *,
    layout: str = "top_band",
    accent: tuple[int, int, int] | None = None,
) -> Rendered:
    if layout not in LAYOUTS:
        raise ValueError(f"알 수 없는 레이아웃: {layout} (가능: {', '.join(LAYOUTS)})")

    bold = fonts.pick("bold")
    light = fonts.pick("regular")
    accent = accent or palette.accent(product_image)
    warnings: list[str] = []

    canvas = cover_fit(product_image, spec)
    width, height = spec.size
    margin = round(width * 0.075)
    safe_top, safe_bottom = spec.safe_top, spec.safe_bottom

    # CTA 알약이 차지할 높이를 미리 빼둔다. 안 빼면 서브 카피를 덮는다.
    badge_px = round(width * 0.042)
    cta_reserve = round(badge_px * 1.9) + margin // 2 if creative.cta else 0

    if layout == "split":
        # 상단 이미지, 하단 단색 판. 글자 가독성이 가장 확실하다.
        image_h = round(height * 0.56)
        board = Image.new("RGB", (width, height), (250, 250, 250))
        board.paste(cover_fit(product_image, _ratio_spec(spec, width, image_h)), (0, 0))
        canvas = board
        text_box = (margin, image_h + margin // 2, width - margin,
                    height - margin - cta_reserve)
        force_color: tuple[int, int, int] | None = (24, 24, 28)
        align, valign = "left", "top"
    elif layout == "bottom_card":
        top = round(height * (0.60 - safe_bottom * 0.5))
        bottom = round(height * (1 - safe_bottom)) - margin // 2
        canvas = typo.scrim(canvas, (0, top - margin, width, height),
                            opacity=205, direction="up")
        text_box = (margin, top, width - margin, bottom - cta_reserve)
        force_color, align, valign = (255, 255, 255), "left", "top"
    elif layout == "center_hero":
        top = round(height * (0.30 + safe_top * 0.5))
        bottom = round(height * (0.72 - safe_bottom * 0.4))
        canvas = typo.scrim(canvas, (0, top - margin, width, bottom + margin),
                            opacity=175, direction="both")
        text_box = (margin, top, width - margin, bottom)
        force_color, align, valign = (255, 255, 255), "center", "middle"
    else:  # top_band
        top = round(height * (0.05 + safe_top))
        bottom = round(height * (0.40 + safe_top * 0.5))
        canvas = typo.scrim(canvas, (0, 0, width, bottom + margin),
                            opacity=195, direction="down")
        text_box = (margin, top, width - margin, bottom)
        force_color, align, valign = (255, 255, 255), "center", "top"

    box_w = text_box[2] - text_box[0]
    box_h = text_box[3] - text_box[1]
    sub_share = 0.34 if creative.sub else 0.0
    head_h = round(box_h * (1 - sub_share))

    head = typo.fit(
        creative.headline,
        bold,
        box_width=box_w,
        box_height=head_h,
        max_size=round(width * 0.135),
        min_size=round(width * 0.040),
        max_lines=3,
    )
    canvas = typo.draw_block(
        canvas,
        head,
        bold,
        box=(text_box[0], text_box[1], text_box[2], text_box[1] + head.height),
        align=align,
        valign="top",
        color=force_color,
        shadow=(0, 0, 0) if force_color == (255, 255, 255) else None,
        shadow_offset=max(2, width // 420),
    )

    cursor = text_box[1] + head.height + round(height * 0.018)
    if creative.sub and cursor < text_box[3]:
        sub = typo.fit(
            creative.sub,
            light,
            box_width=box_w,
            box_height=text_box[3] - cursor,
            max_size=round(head.font_size * 0.46),
            min_size=round(width * 0.025),
            max_lines=2,
        )
        canvas = typo.draw_block(
            canvas,
            sub,
            light,
            box=(text_box[0], cursor, text_box[2], cursor + sub.height),
            align=align,
            valign="top",
            color=force_color,
            shadow=(0, 0, 0) if force_color == (255, 255, 255) else None,
            shadow_offset=max(1, width // 700),
        )

    # 배지는 반대쪽 모서리에 둔다 - 텍스트 블록과 겹치지 않게.
    badge_size = badge_px
    if creative.badge:
        if layout in ("bottom_card", "split"):
            center = (margin + round(width * 0.14), round(height * (0.08 + safe_top)))
        else:
            center = (width - margin - round(width * 0.14),
                      round(height * (1 - safe_bottom) - 0.09 * height))
        _pill(canvas, creative.badge, bold, center=center, fill=accent, size=badge_size)

    if creative.cta:
        # 알약 높이의 절반 + 여백만큼 띄워야 아래가 잘리지 않는다.
        pill_half = round(badge_size * 0.92 * 1.9 / 2)
        floor = round(height * (1 - safe_bottom)) - pill_half - margin // 2
        cta_y = floor
        if layout in ("bottom_card", "split"):
            cta_y = min(text_box[3] + pill_half, floor)
        _pill(
            canvas,
            creative.cta,
            bold,
            center=(width // 2 if align == "center" else margin + round(width * 0.13),
                    cta_y),
            fill=accent,
            size=round(badge_size * 0.92),
        )

    ratio = typo.text_area_ratio(head, spec.size)
    if ratio > 0.30:
        warnings.append(f"글자 면적 {ratio:.0%} - 과도하면 노출 성과가 떨어집니다")
    if head.font_size <= round(width * 0.040):
        warnings.append("헤드라인이 최소 크기까지 줄었습니다 - 문구를 줄이십시오")
    violations = creative.violations()
    if violations:
        warnings.append(f"표시광고법 위험 표현: {', '.join(violations)}")

    return Rendered(canvas, layout, spec, creative, head.font_size, ratio, warnings)


def _ratio_spec(spec: Spec, width: int, height: int) -> Spec:
    from dataclasses import replace

    return replace(spec, width=width, height=height, safe_top=0.0, safe_bottom=0.0)
