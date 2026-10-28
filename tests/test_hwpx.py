"""HWPX 출력이 KS X 6101 패키지 규격을 지키는지 검사한다.

실제 워드프로세서에서 열리는지는 사람이 확인해야 한다(docs/01-architecture.md
의 검증 항목 참고). 이 테스트가 보장하는 범위는 패키지 구조와 내용 왕복까지다.
"""

import io
import zipfile

import pytest
from lxml import etree

from gongmun.ir import Align, Document
from gongmun.writers.hwpx import MIMETYPE, NS, HwpxWriter, write_hwpx

HP = f"{{{NS['hp']}}}"

REQUIRED_ENTRIES = [
    "mimetype",
    "version.xml",
    "settings.xml",
    "Contents/content.hpf",
    "Contents/header.xml",
    "Contents/section0.xml",
    "META-INF/container.xml",
    "META-INF/manifest.xml",
]


@pytest.fixture
def doc():
    d = Document("테스트 제안서", meta={"공고번호": "2026-0001"})
    d.heading("1. 개요", 1)
    d.para("본문 단락입니다.", align=Align.JUSTIFY)
    d.heading("1.1 배경", 2)
    d.table([["구분", "내용"], ["기간", "12개월"], ["금액", "250,000,000원"]])
    d.page_break()
    d.heading("2. 계획", 1)
    return d


@pytest.fixture
def archive(doc):
    return zipfile.ZipFile(io.BytesIO(HwpxWriter(doc).to_bytes()))


def test_mimetype_is_first_and_stored(archive):
    """OWPML 패키지 규격: mimetype 은 첫 엔트리이며 무압축이어야 한다."""
    assert archive.namelist()[0] == "mimetype"
    assert archive.getinfo("mimetype").compress_type == zipfile.ZIP_STORED
    assert archive.read("mimetype").decode() == MIMETYPE


def test_all_required_entries_present(archive):
    names = set(archive.namelist())
    assert not set(REQUIRED_ENTRIES) - names


def test_archive_is_not_corrupt(archive):
    assert archive.testzip() is None


def test_every_xml_part_is_wellformed(archive):
    parts = [n for n in archive.namelist() if n.endswith((".xml", ".hpf"))]
    assert parts
    for name in parts:
        etree.fromstring(archive.read(name))


def test_text_survives_round_trip(archive):
    section = etree.fromstring(archive.read("Contents/section0.xml"))
    texts = [t.text for t in section.iter(f"{HP}t") if t.text]
    assert "테스트 제안서" in texts
    assert "1. 개요" in texts
    assert "본문 단락입니다." in texts
    assert "250,000,000원" in texts


def test_table_geometry_matches_ir(archive):
    section = etree.fromstring(archive.read("Contents/section0.xml"))
    tables = list(section.iter(f"{HP}tbl"))
    assert len(tables) == 1
    assert tables[0].get("rowCnt") == "3"
    assert tables[0].get("colCnt") == "2"
    assert len(list(tables[0].iter(f"{HP}tc"))) == 6


def test_cell_addresses_are_unique_and_complete(archive):
    section = etree.fromstring(archive.read("Contents/section0.xml"))
    addrs = {
        (a.get("rowAddr"), a.get("colAddr"))
        for a in section.iter(f"{HP}cellAddr")
    }
    assert addrs == {(str(r), str(c)) for r in range(3) for c in range(2)}


def test_page_break_is_marked(archive):
    section = etree.fromstring(archive.read("Contents/section0.xml"))
    assert any(p.get("pageBreak") == "1" for p in section.iter(f"{HP}p"))


def test_section_properties_declare_a4(archive):
    section = etree.fromstring(archive.read("Contents/section0.xml"))
    page = next(section.iter(f"{HP}pagePr"))
    # A4 = 210mm x 297mm, 1/7200 inch 단위
    assert int(page.get("width")) == 59528
    assert int(page.get("height")) == 84188


def test_paragraph_ids_are_unique(archive):
    section = etree.fromstring(archive.read("Contents/section0.xml"))
    ids = [p.get("id") for p in section.iter(f"{HP}p")]
    assert len(ids) == len(set(ids))


def test_header_declares_referenced_styles(archive):
    header = etree.fromstring(archive.read("Contents/header.xml"))
    section = etree.fromstring(archive.read("Contents/section0.xml"))
    hh = f"{{{NS['hh']}}}"

    declared_styles = {s.get("id") for s in header.iter(f"{hh}style")}
    declared_chars = {c.get("id") for c in header.iter(f"{hh}charPr")}
    declared_paras = {p.get("id") for p in header.iter(f"{hh}paraPr")}

    for p in section.iter(f"{HP}p"):
        assert p.get("styleIDRef") in declared_styles
        assert p.get("paraPrIDRef") in declared_paras
    for run in section.iter(f"{HP}run"):
        assert run.get("charPrIDRef") in declared_chars


def test_preview_text_included(archive):
    preview = archive.read("Preview/PrvText.txt").decode("utf-8")
    assert "테스트 제안서" in preview


def test_write_hwpx_creates_parent_directories(tmp_path, doc):
    out = write_hwpx(doc, tmp_path / "nested" / "deep" / "a.hwpx")
    assert out.exists() and out.stat().st_size > 0
