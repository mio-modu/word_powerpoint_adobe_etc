"""소재 한 장의 내용 모델과 AI 생성.

광고는 표시광고법의 규제를 받는다. 근거 없는 최상급 표현과 효과 보증은
생성 단계에서 막는다 - 사후에 걸러내는 것보다 애초에 만들지 않는 쪽이 안전하다.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from .gemini import Gemini

# 표시광고법 위반 소지가 큰 표현. 생성 금지 + 사후 검출 양쪽에 쓴다.
BANNED_PATTERNS = [
    r"최고(?!급)", r"최상", r"유일", r"1위", r"１위", r"국내\s*최", r"세계\s*최",
    r"100\s*%", r"완치", r"치료", r"효과\s*보장", r"부작용\s*없", r"무조건",
    r"평생", r"영구", r"공짜", r"전액\s*환불\s*보장",
]
_BANNED = re.compile("|".join(BANNED_PATTERNS))


@dataclass
class Creative:
    """소재 한 장에 들어갈 문구."""

    headline: str
    sub: str = ""
    badge: str = ""
    cta: str = ""
    angle: str = ""

    def violations(self) -> list[str]:
        found: list[str] = []
        for text in (self.headline, self.sub, self.badge, self.cta):
            found.extend(m.group(0) for m in _BANNED.finditer(text or ""))
        return sorted(set(found))


@dataclass
class Product:
    """상품 분석 결과."""

    name: str
    category: str = ""
    selling_points: list[str] = field(default_factory=list)
    target: str = ""
    tone: str = ""
    scene_hint: str = ""


VISION_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "category": {"type": "STRING"},
        "selling_points": {"type": "ARRAY", "items": {"type": "STRING"}},
        "target": {"type": "STRING"},
        "tone": {"type": "STRING"},
        "scene_hint": {"type": "STRING"},
    },
    "required": ["category", "selling_points", "target", "tone", "scene_hint"],
}

COPY_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "creatives": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "angle": {"type": "STRING"},
                    "headline": {"type": "STRING"},
                    "sub": {"type": "STRING"},
                    "badge": {"type": "STRING"},
                    "cta": {"type": "STRING"},
                },
                "required": ["angle", "headline", "sub", "badge", "cta"],
            },
        }
    },
    "required": ["creatives"],
}

VISION_PROMPT = """\
이 상품 사진을 보고 광고 제작에 필요한 정보를 뽑으십시오.

- category: 상품 분류 (한국어, 10자 이내)
- selling_points: 사진에서 **실제로 확인되는** 특징 3~5개. 추측하지 마십시오.
- target: 주요 구매층 (한국어, 20자 이내)
- tone: 어울리는 광고 톤 (예: 담백하고 실용적, 고급스럽고 차분한)
- scene_hint: 이 상품이 놓이면 좋을 배경 장면 묘사 (영어, 25단어 이내, 글자·로고 없이)
"""

COPY_PROMPT = """\
아래 상품의 광고 소재 문구를 {count}종 만드십시오. 서로 **다른 각도**로 접근하십시오.
(예: 가격, 사용 순간, 문제 해결, 비교, 계절성, 수량 한정, 후기 인용)

상품명: {name}
분류: {category}
특징: {points}
타겟: {target}
톤: {tone}
{extra}

각 소재는 다음을 지킵니다.
- angle: 어떤 각도인지 (한국어 10자 이내)
- headline: **14자 이내**. 가장 먼저 읽히는 한 줄. 숫자나 구체어를 넣으십시오.
- sub: **28자 이내**. 헤드라인을 뒷받침하는 한 줄.
- badge: **8자 이내**. 가격이나 혜택. 없으면 빈 문자열.
- cta: **8자 이내**. 행동 유도.

반드시 지킬 것:
- 과장광고 금지. 다음 표현을 쓰지 마십시오: 최고, 최상, 유일, 1위, 100%, 완치,
  효과 보장, 부작용 없음, 무조건, 평생, 영구, 공짜.
- 사실로 확인되지 않은 수치·효과·수상 이력을 쓰지 마십시오.
- 제공된 특징 안에서만 말하십시오.
- 글자 수 제한을 반드시 지키십시오. 넘으면 소재에 들어가지 않습니다.
"""


def analyze(image: Path, name: str, gemini: Gemini) -> Product:
    """상품 사진에서 광고 제작 정보를 뽑는다."""
    data = gemini.json("vision", VISION_PROMPT, VISION_SCHEMA, image=Path(image),
                       temperature=0.4)
    return Product(
        name=name,
        category=str(data.get("category", "")).strip(),
        selling_points=[str(s).strip() for s in data.get("selling_points", [])][:5],
        target=str(data.get("target", "")).strip(),
        tone=str(data.get("tone", "")).strip(),
        scene_hint=str(data.get("scene_hint", "")).strip(),
    )


def write_copy(
    product: Product,
    gemini: Gemini,
    *,
    count: int = 8,
    price: str = "",
    benefit: str = "",
) -> list[Creative]:
    """서로 다른 각도의 소재 문구를 생성한다."""
    extra_lines = []
    if price:
        extra_lines.append(f"가격: {price}")
    if benefit:
        extra_lines.append(f"혜택: {benefit}")

    prompt = COPY_PROMPT.format(
        count=count,
        name=product.name,
        category=product.category or "미지정",
        points=", ".join(product.selling_points) or "미지정",
        target=product.target or "미지정",
        tone=product.tone or "담백하고 실용적",
        extra="\n".join(extra_lines),
    )
    data = gemini.json("copy", prompt, COPY_SCHEMA, temperature=1.0)

    out: list[Creative] = []
    for row in data.get("creatives", []):
        creative = Creative(
            headline=_clip(row.get("headline"), 14),
            sub=_clip(row.get("sub"), 28),
            badge=_clip(row.get("badge"), 8),
            cta=_clip(row.get("cta"), 8),
            angle=_clip(row.get("angle"), 10),
        )
        if not creative.headline:
            continue
        # 모델이 지시를 어겨 금지 표현을 넣으면 그 소재는 버린다.
        if creative.violations():
            continue
        out.append(creative)
    return out


def _clip(value, limit: int) -> str:
    text = str(value or "").strip().replace("\n", " ")
    return text[:limit]
