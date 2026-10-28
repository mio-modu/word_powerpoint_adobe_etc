from gongmun.llm.requirements import (
    CATEGORY_ORDER,
    Requirement,
    _parse_json,
    as_json,
    to_document,
)


def test_parse_plain_json():
    assert _parse_json('{"requirements": []}') == {"requirements": []}


def test_parse_json_inside_code_fence():
    raw = '```json\n{"requirements": [{"item": "x"}]}\n```'
    assert _parse_json(raw)["requirements"][0]["item"] == "x"


def test_parse_json_with_surrounding_prose():
    raw = '다음과 같습니다.\n{"requirements": []}\n이상입니다.'
    assert _parse_json(raw) == {"requirements": []}


def test_parse_json_failure_is_explicit():
    import pytest

    with pytest.raises(ValueError):
        _parse_json("JSON 이 전혀 없는 문장")


def _sample():
    return [
        Requirement("자격", "제조업 등록", "직접생산확인증명서 보유", "...", True),
        Requirement("제출서류", "사업자등록증", "사본 1부", "...", False),
        Requirement("기한", "제출 마감", "2026-11-20 18:00", "...", True),
    ]


def test_document_includes_blocking_section():
    doc = to_document(_sample(), title="체크리스트")
    text = doc.plain_text
    assert "필수 요건" in text
    assert "제조업 등록" in text
    assert "사업자등록증" in text


def test_document_groups_by_category_in_fixed_order():
    doc = to_document(_sample(), title="체크리스트")
    text = doc.plain_text
    present = [c for c in CATEGORY_ORDER if f"\n{c}\n" in f"\n{text}\n"]
    assert present == [c for c in CATEGORY_ORDER if c in present]


def test_document_carries_disclaimer():
    doc = to_document(_sample(), title="체크리스트")
    assert "법률 자문이 아닙니다" in doc.plain_text


def test_empty_requirements_still_builds():
    doc = to_document([], title="체크리스트")
    assert "0개 요건" in doc.plain_text


def test_as_json_is_readable_korean():
    out = as_json(_sample())
    assert "제조업 등록" in out
