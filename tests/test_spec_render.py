import pytest
from PIL import Image, ImageDraw

from sojae import render, spec
from sojae.creative import Creative


@pytest.fixture
def photo():
    img = Image.new("RGB", (1400, 1000), (40, 60, 90))
    # 축소·양자화를 거쳐도 남도록 피사체는 꽉 찬 영역으로 둔다.
    ImageDraw.Draw(img).ellipse([400, 250, 1000, 750], fill=(230, 120, 50))
    return img


@pytest.fixture
def creative():
    return Creative(
        headline="얇지만 따뜻한",
        sub="하루 종일 가볍게 입는 겨울 패딩",
        badge="29,900원",
        cta="지금 구매",
        angle="가격",
    )


def test_unknown_spec_names_the_options():
    with pytest.raises(KeyError, match="square"):
        spec.get("없는규격")


def test_safe_box_shrinks_only_when_declared():
    assert spec.get("square").safe_box() == (0, 0, 1080, 1080)
    top, bottom = spec.get("story").safe_box()[1], spec.get("story").safe_box()[3]
    assert top > 0 and bottom < 1920


def test_cover_fit_matches_spec_exactly_without_distortion(photo):
    for key in spec.SPECS:
        target = spec.get(key)
        out = render.cover_fit(photo, target)
        assert out.size == target.size


@pytest.mark.parametrize("layout", render.LAYOUTS)
def test_every_layout_renders_every_spec(photo, creative, layout):
    for key in ("square", "portrait", "story"):
        result = render.compose(photo, creative, spec.get(key), layout=layout)
        assert result.image.size == spec.get(key).size
        assert result.headline_size > 0


def test_unknown_layout_is_rejected(photo, creative):
    with pytest.raises(ValueError, match="레이아웃"):
        render.compose(photo, creative, spec.get("square"), layout="없음")


def test_long_headline_shrinks_rather_than_overflowing(photo):
    long = Creative(headline="아주 긴 광고 헤드라인이 들어가는 경우를 확인합니다")
    short = Creative(headline="짧다")
    a = render.compose(photo, long, spec.get("square"))
    b = render.compose(photo, short, spec.get("square"))
    assert a.headline_size < b.headline_size


def test_banned_copy_surfaces_as_a_warning(photo):
    bad = Creative(headline="효과 100% 보장", cta="구매")
    result = render.compose(photo, bad, spec.get("square"))
    assert any("표시광고법" in w for w in result.warnings)


def test_accent_colour_comes_from_the_product(photo, creative):
    from sojae import palette

    r, g, b = palette.accent(photo)
    assert r > b, "주황 피사체에서 따뜻한 강조색이 나와야 한다"


def test_save_writes_a_real_jpeg(tmp_path, photo, creative):
    result = render.compose(photo, creative, spec.get("square"))
    path = result.save(tmp_path / "nested" / "ad.jpg")
    assert path.exists() and path.stat().st_size > 5000
    assert Image.open(path).size == (1080, 1080)
