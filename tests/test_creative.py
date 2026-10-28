import pytest

from sojae.creative import Creative, _clip


@pytest.mark.parametrize(
    "text",
    ["국내 최고 품질", "효과 100% 보장", "업계 1위", "부작용 없는", "평생 무료"],
)
def test_banned_expressions_are_detected(text):
    assert Creative(headline=text).violations()


@pytest.mark.parametrize(
    "text", ["얇지만 따뜻한", "하루 종일 가볍게", "19,900원 특가", "최고급 원단"]
)
def test_safe_expressions_pass(text):
    assert Creative(headline=text).violations() == []


def test_violations_scan_every_field():
    c = Creative(headline="가벼운 패딩", sub="보통", badge="1위", cta="구매")
    assert "1위" in c.violations()


def test_violations_are_deduplicated():
    c = Creative(headline="100% 좋고", sub="100% 편한")
    assert c.violations().count("100%") == 1


def test_clip_enforces_length_and_strips_newlines():
    assert _clip("가나다라마바사", 3) == "가나다"
    assert _clip(" 앞뒤\n공백 ", 99) == "앞뒤 공백"
    assert _clip(None, 5) == ""
