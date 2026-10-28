import pytest

from gongmun.ir import Align, Document, Heading, Paragraph, Run, Table


def test_paragraph_text_shortcut():
    p = Paragraph.text("안녕하세요", align=Align.CENTER)
    assert p.plain == "안녕하세요"
    assert p.align is Align.CENTER


def test_run_rejects_non_string():
    with pytest.raises(TypeError):
        Run(123)


def test_heading_level_bounds():
    Heading("제목", 1)
    Heading("제목", 6)
    for bad in (0, 7, -1):
        with pytest.raises(ValueError):
            Heading("제목", bad)


def test_table_requires_rectangular_rows():
    Table([["a", "b"], ["c", "d"]])
    with pytest.raises(ValueError):
        Table([["a", "b"], ["c"]])
    with pytest.raises(ValueError):
        Table([])


def test_table_widths_must_match_columns():
    Table([["a", "b"]], widths=[100, 200])
    with pytest.raises(ValueError):
        Table([["a", "b"]], widths=[100])


def test_builder_chain_and_plain_text():
    doc = (
        Document("보고서")
        .heading("1. 개요")
        .para("본문입니다")
        .table([["항목", "값"], ["기간", "12개월"]])
        .page_break()
    )
    assert len(doc.blocks) == 4
    text = doc.plain_text
    assert "보고서" in text
    assert "1. 개요" in text
    assert "항목\t값" in text
