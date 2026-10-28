"""한글 타이포 엔진 검사. 제품의 핵심이므로 가장 촘촘히 본다."""

import pytest
from PIL import Image

from sojae import fonts, typo


@pytest.fixture(scope="module")
def face():
    return fonts.pick("bold")


@pytest.fixture(scope="module")
def font(face):
    return face.load(40)


def test_korean_font_is_found_and_renders(face):
    assert typo.measure(face.load(40), "한글") > 40


def test_wrap_breaks_on_word_boundaries(font):
    text = "겨울 한정 세일 지금 주문하면 당일 출고"
    lines = typo.wrap(text, font, 300)
    assert len(lines) > 1
    # 원문의 어절이 쪼개지지 않아야 한다. 줄을 이을 때 공백을 넣어야
    # 줄 끝과 다음 줄 머리의 어절이 붙지 않는다.
    assert " ".join(lines).split() == text.split()


def test_wrap_respects_hard_newlines(font):
    lines = typo.wrap("첫째 줄\n둘째 줄", font, 9999)
    assert lines == ["첫째 줄", "둘째 줄"]


def test_long_word_splits_only_when_necessary(font):
    long_word = "가" * 60
    lines = typo.wrap(long_word, font, 200)
    assert len(lines) > 1
    assert "".join(lines) == long_word


def test_no_forbidden_character_starts_a_line(font):
    text = "지금 주문하면 당일 출고 (무료배송) 적용됩니다"
    for width in (220, 300, 420, 560):
        lines = [l for l in typo.wrap(text, font, width) if l]
        for line in lines[1:]:
            assert line[0] not in typo.NO_LINE_START, (width, lines)


def test_fit_shrinks_to_stay_inside_box(face):
    small = typo.fit("아주 긴 광고 문구가 여기에 들어갑니다", face,
                     box_width=200, box_height=120, max_size=90)
    big = typo.fit("짧다", face, box_width=800, box_height=400, max_size=90)
    assert small.font_size < big.font_size
    assert small.height <= 120


def test_fit_honours_max_lines(face):
    block = typo.fit("한 두 세 네 다섯 여섯 일곱 여덟", face,
                     box_width=260, box_height=600, max_size=80, max_lines=2)
    assert len(block.lines) <= 2


def test_fit_rejects_empty_text(face):
    with pytest.raises(ValueError):
        typo.fit("   ", face, box_width=100, box_height=100, max_size=40)


def test_luminance_detects_light_and_dark():
    dark = Image.new("RGB", (50, 50), (0, 0, 0))
    light = Image.new("RGB", (50, 50), (255, 255, 255))
    assert typo.mean_luminance(dark, (0, 0, 50, 50)) < 0.1
    assert typo.mean_luminance(light, (0, 0, 50, 50)) > 0.9


def test_contrast_color_flips_with_background():
    assert typo.contrast_color(0.9)[0] == (24, 24, 28)
    assert typo.contrast_color(0.1)[0] == (255, 255, 255)


@pytest.mark.parametrize("direction", ["up", "down", "both"])
def test_scrim_darkens_its_anchor_edge(direction):
    base = Image.new("RGB", (60, 120), (255, 255, 255))
    out = typo.scrim(base, (0, 0, 60, 120), opacity=255, direction=direction)
    top = typo.mean_luminance(out, (0, 0, 60, 12))
    bottom = typo.mean_luminance(out, (0, 108, 60, 120))
    if direction == "down":
        assert top < bottom
    elif direction == "up":
        assert bottom < top
    else:
        middle = typo.mean_luminance(out, (0, 54, 60, 66))
        assert middle < top and middle < bottom


def test_draw_block_actually_changes_pixels(face):
    base = Image.new("RGB", (400, 200), (255, 255, 255))
    block = typo.fit("광고", face, box_width=360, box_height=160, max_size=80)
    out = typo.draw_block(base, block, face, box=(20, 20, 380, 180))
    assert typo.mean_luminance(out, (0, 0, 400, 200)) < 0.99
