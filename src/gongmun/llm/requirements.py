"""공고문 -> 요건 체크리스트.

이 단계가 무료로 뿌리는 미끼 제품이다. Haiku 로 돌려 건당 원가를
10원 아래로 유지한다. 유료 제안서 생성은 여기서 나온 체크리스트를
입력으로 받는다.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, asdict

from ..ir import Document
from .client import LLM

SYSTEM = """\
당신은 한국 공공조달 입찰 실무자입니다. 입찰공고문에서 '제출자가 지켜야 \
하는 요건'만 빠짐없이 뽑아 정리합니다.

규칙:
- 공고문에 명시된 내용만 쓰십시오. 추측하거나 일반론을 더하지 마십시오.
- 근거를 찾을 수 없는 항목은 만들지 말고 생략하십시오.
- 각 요건에 공고문의 해당 문구를 `source` 로 그대로 인용하십시오.
- category 는 자격 / 제출서류 / 서식 / 기한 / 평가 / 기타 중 하나입니다.
- blocking 은 미충족 시 입찰 자체가 무효가 되는 요건에만 true 입니다.

반드시 아래 JSON 만 출력하십시오. 설명을 덧붙이지 마십시오.
{"requirements":[{"category":"...","item":"...","detail":"...",
"source":"...","blocking":true}]}"""


@dataclass
class Requirement:
    category: str
    item: str
    detail: str
    source: str
    blocking: bool = False


CATEGORY_ORDER = ["자격", "제출서류", "서식", "기한", "평가", "기타"]


def extract(notice_text: str, llm: LLM, *, max_tokens: int = 8_000) -> list[Requirement]:
    """공고문 원문에서 요건 목록을 뽑는다."""
    if not notice_text.strip():
        raise ValueError("공고문 본문이 비어 있습니다")

    raw, _ = llm.complete(
        "extract",
        system=SYSTEM,
        messages=[{"role": "user", "content": notice_text}],
        effort="low",
        max_tokens=max_tokens,
    )

    payload = _parse_json(raw)
    out: list[Requirement] = []
    for row in payload.get("requirements", []):
        category = row.get("category", "기타")
        out.append(
            Requirement(
                category=category if category in CATEGORY_ORDER else "기타",
                item=str(row.get("item", "")).strip(),
                detail=str(row.get("detail", "")).strip(),
                source=str(row.get("source", "")).strip(),
                blocking=bool(row.get("blocking", False)),
            )
        )
    return [r for r in out if r.item]


def _parse_json(raw: str) -> dict:
    """모델이 코드펜스를 씌워 보내는 경우까지 받아낸다."""
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text
        text = text.rsplit("```", 1)[0]
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end <= start:
            raise ValueError(f"JSON 을 찾을 수 없습니다: {raw[:200]}") from None
        return json.loads(text[start : end + 1])


def to_document(
    requirements: list[Requirement], *, title: str, meta: dict[str, str] | None = None
) -> Document:
    """체크리스트를 제출 가능한 문서 IR 로 바꾼다."""
    doc = Document(title, meta=meta or {})

    blocking = [r for r in requirements if r.blocking]
    doc.heading("요약", 1)
    doc.para(
        f"총 {len(requirements)}개 요건을 확인했습니다. "
        f"이 중 {len(blocking)}개는 미충족 시 입찰이 무효가 되는 필수 요건입니다."
    )

    if blocking:
        doc.heading("필수 요건 (미충족 시 무효)", 1)
        doc.table(
            [["구분", "요건", "세부 내용"]]
            + [[r.category, r.item, r.detail] for r in blocking]
        )

    doc.heading("전체 요건 체크리스트", 1)
    for category in CATEGORY_ORDER:
        rows = [r for r in requirements if r.category == category]
        if not rows:
            continue
        doc.heading(category, 2)
        doc.table(
            [["확인", "요건", "세부 내용", "공고문 근거"]]
            + [
                ["[ ]", r.item, r.detail, r.source[:120]]
                for r in rows
            ]
        )

    doc.heading("유의사항", 1)
    doc.para(
        "본 체크리스트는 공고문 원문을 자동 분석한 결과입니다. "
        "최종 제출 전 공고문과 관련 법령을 직접 확인하십시오. "
        "본 문서는 법률 자문이 아닙니다."
    )
    return doc


def as_json(requirements: list[Requirement]) -> str:
    return json.dumps(
        [asdict(r) for r in requirements], ensure_ascii=False, indent=2
    )
