"""IR -> HWPX(OWPML) 변환기.

HWPX 는 KS X 6101(OWPML)로 공개된 국가표준이며, 물리 구조는
ZIP 컨테이너 안의 XML 묶음이다. 이 모듈은 그 공개 규격만을 근거로
문서를 새로 **생성**한다. 특정 제품을 역공학하거나 바이너리 포맷을
해석하지 않는다.

좌표 단위는 HWPUNIT = 1/7200 인치.
글자 크기 단위는 1/100 pt.
"""

from __future__ import annotations

import zipfile
from pathlib import Path

from lxml import etree

from ..ir import Align, Block, Document, Heading, PageBreak, Paragraph, Table

# ---------------------------------------------------------------- 네임스페이스
NS = {
    "ha": "http://www.hancom.co.kr/hwpml/2011/app",
    "hp": "http://www.hancom.co.kr/hwpml/2011/paragraph",
    "hh": "http://www.hancom.co.kr/hwpml/2011/head",
    "hs": "http://www.hancom.co.kr/hwpml/2011/section",
    "hc": "http://www.hancom.co.kr/hwpml/2011/core",
    "opf": "http://www.idpf.org/2007/opf/",
    "ocf": "urn:oasis:names:tc:opendocument:xmlns:container",
    "dc": "http://purl.org/dc/elements/1.1/",
}

MIMETYPE = "application/hwp+zip"

# ------------------------------------------------------------------ 치수 상수
HWPUNIT_PER_MM = 7200 / 25.4

# A4 는 210mm x 297mm 이지만, 값을 매번 반올림하면 기존 문서와 1단위씩
# 어긋난다. HWPX 파일들이 실제로 쓰는 관례값을 그대로 둔다.
A4_WIDTH = 59528
A4_HEIGHT = 84188
MARGIN = round(20 * HWPUNIT_PER_MM)         # 5669
HEADER_FOOTER = round(10 * HWPUNIT_PER_MM)

# 개요 수준별 글자 크기(1/100 pt)와 굵기
HEADING_SIZES = {1: 1600, 2: 1400, 3: 1200, 4: 1100, 5: 1000, 6: 1000}
BODY_SIZE = 1000

# charPr 인덱스: 0=본문, 1=굵은본문, 2..7=제목1..6
CHARPR_BODY = 0
CHARPR_BOLD = 1
CHARPR_HEADING_BASE = 2

# paraPr 인덱스: 0=양쪽, 1=왼쪽, 2=가운데, 3=오른쪽
PARAPR_BY_ALIGN = {
    Align.JUSTIFY: 0,
    Align.LEFT: 1,
    Align.CENTER: 2,
    Align.RIGHT: 3,
}


def _q(prefix: str, tag: str) -> str:
    return f"{{{NS[prefix]}}}{tag}"


def _el(parent, prefix: str, tag: str, **attrs):
    """속성값을 전부 문자열로 바꿔 자식 엘리먼트를 만든다."""
    node = etree.SubElement(parent, _q(prefix, tag))
    for key, value in attrs.items():
        if value is None:
            continue
        key = key.rstrip("_")
        if isinstance(value, bool):
            value = "1" if value else "0"
        node.set(key, str(value))
    return node


def _serialize(root) -> bytes:
    return etree.tostring(
        root, xml_declaration=True, encoding="UTF-8", standalone=True, pretty_print=True
    )


class HwpxWriter:
    """IR Document 를 HWPX 바이트열로 직렬화한다."""

    def __init__(self, doc: Document):
        self.doc = doc
        self._para_id = 0

    # ------------------------------------------------------------ 공개 API
    def to_bytes(self) -> bytes:
        import io

        buf = io.BytesIO()
        # mimetype 은 반드시 첫 엔트리이고 무압축이어야 한다.
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr(
                zipfile.ZipInfo("mimetype"), MIMETYPE, compress_type=zipfile.ZIP_STORED
            )
            z.writestr("version.xml", _serialize(self._version_xml()))
            z.writestr("settings.xml", _serialize(self._settings_xml()))
            z.writestr("Contents/content.hpf", _serialize(self._content_hpf()))
            z.writestr("Contents/header.xml", _serialize(self._header_xml()))
            z.writestr("Contents/section0.xml", _serialize(self._section_xml()))
            z.writestr("META-INF/container.xml", _serialize(self._container_xml()))
            z.writestr("META-INF/manifest.xml", _serialize(self._manifest_xml()))
            z.writestr(
                "Preview/PrvText.txt", self.doc.plain_text.encode("utf-8")
            )
        return buf.getvalue()

    def save(self, path: str | Path) -> Path:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(self.to_bytes())
        return path

    # -------------------------------------------------------- 패키지 메타
    def _version_xml(self):
        return etree.Element(
            _q("ha", "HCFVersion"),
            {
                "tagetApplication": "WORDPROCESSOR",
                "major": "5",
                "minor": "1",
                "micro": "1",
                "buildNumber": "0",
                "os": "1",
                "application": "gongmun",
            },
            nsmap={"ha": NS["ha"]},
        )

    def _settings_xml(self):
        root = etree.Element(_q("ha", "HWPApplicationSetting"), nsmap={"ha": NS["ha"]})
        cfg = _el(root, "ha", "CaretPosition", listIDRef="0", paraIDRef="0", pos="0")
        del cfg
        return root

    def _content_hpf(self):
        root = etree.Element(
            _q("opf", "package"),
            {"version": "", "unique-identifier": "", "id": ""},
            nsmap={"opf": NS["opf"], "dc": NS["dc"], "ha": NS["ha"]},
        )
        meta = _el(root, "opf", "metadata")
        _el(meta, "opf", "title").text = self.doc.title
        _el(meta, "opf", "language").text = "ko"
        for key, value in self.doc.meta.items():
            _el(meta, "opf", "meta", name=key).text = value

        manifest = _el(root, "opf", "manifest")
        for item_id, href, media in (
            ("header", "Contents/header.xml", "application/xml"),
            ("section0", "Contents/section0.xml", "application/xml"),
            ("settings", "settings.xml", "application/xml"),
        ):
            _el(manifest, "opf", "item", id=item_id, href=href, **{"media-type": media})

        spine = _el(root, "opf", "spine")
        _el(spine, "opf", "itemref", idref="header", linear="yes")
        _el(spine, "opf", "itemref", idref="section0", linear="yes")
        return root

    def _container_xml(self):
        root = etree.Element(_q("ocf", "container"), nsmap={"ocf": NS["ocf"]})
        files = _el(root, "ocf", "rootfiles")
        _el(
            files,
            "ocf",
            "rootfile",
            **{"full-path": "Contents/content.hpf", "media-type": MIMETYPE},
        )
        return root

    def _manifest_xml(self):
        root = etree.Element(_q("ocf", "manifest"), nsmap={"ocf": NS["ocf"]})
        for path in (
            "Contents/content.hpf",
            "Contents/header.xml",
            "Contents/section0.xml",
            "settings.xml",
            "Preview/PrvText.txt",
        ):
            _el(root, "ocf", "file-entry", **{"full-path": path, "media-type": ""})
        return root

    # --------------------------------------------------------- header.xml
    def _header_xml(self):
        root = etree.Element(
            _q("hh", "head"),
            {"version": "1.4", "secCnt": "1"},
            nsmap={"hh": NS["hh"], "hc": NS["hc"]},
        )
        _el(root, "hh", "beginNum", page="1", footnote="1", endnote="1",
            pic="1", tbl="1", equation="1")

        ref = _el(root, "hh", "refList")
        self._fontfaces(ref)
        self._border_fills(ref)
        self._char_properties(ref)
        self._para_properties(ref)
        self._styles(ref)
        return root

    def _fontfaces(self, ref):
        faces = _el(ref, "hh", "fontfaces", itemCnt="2")
        for lang in ("HANGUL", "LATIN"):
            group = _el(faces, "hh", "fontface", lang=lang, fontCnt="2")
            for idx, name in enumerate(("함초롬바탕", "맑은 고딕")):
                font = _el(group, "hh", "font", id=idx, face=name, type="TTF",
                           isEmbedded="0")
                _el(font, "hh", "typeInfo", familyType="FCAT_GOTHIC", weight="0",
                    proportion="0", contrast="0", strokeVariation="1",
                    armStyle="0", letterform="0", midline="0", xHeight="0")

    def _border_fills(self, ref):
        """0 = 테두리 없음, 1 = 표 칸용 실선."""
        fills = _el(ref, "hh", "borderFills", itemCnt="2")
        for fill_id, border_type in ((1, "NONE"), (2, "SOLID")):
            bf = _el(fills, "hh", "borderFill", id=fill_id,
                     threeD="0", shadow="0", centerLine="NONE", breakCellSeparateLine="0")
            _el(bf, "hh", "slash", type="NONE", Crooked="0", isCounter="0")
            _el(bf, "hh", "backSlash", type="NONE", Crooked="0", isCounter="0")
            for side in ("leftBorder", "rightBorder", "topBorder", "bottomBorder"):
                _el(bf, "hh", side, type=border_type, width="0.12 mm", color="#000000")
            _el(bf, "hh", "diagonal", type="SOLID", width="0.1 mm", color="#000000")

    def _char_properties(self, ref):
        specs = [(BODY_SIZE, False)] + [(BODY_SIZE, True)]
        specs += [(HEADING_SIZES[lv], True) for lv in range(1, 7)]
        props = _el(ref, "hh", "charProperties", itemCnt=len(specs))
        for idx, (height, bold) in enumerate(specs):
            cp = _el(props, "hh", "charPr", id=idx, height=height,
                     textColor="#000000", shadeColor="none", useFontSpace="0",
                     useKerning="0", symMark="NONE", borderFillIDRef="1")
            fonts = _el(cp, "hh", "fontRef")
            ratio = _el(cp, "hh", "ratio")
            spacing = _el(cp, "hh", "spacing")
            rel = _el(cp, "hh", "relSz")
            offset = _el(cp, "hh", "offset")
            for node, attr, value in (
                (fonts, None, 0), (ratio, None, 100), (spacing, None, 0),
                (rel, None, 100), (offset, None, 0),
            ):
                del attr
                for lang in ("hangul", "latin", "hanja", "japanese",
                             "other", "symbol", "user"):
                    node.set(lang, str(value))
            if bold:
                _el(cp, "hh", "bold")

    def _para_properties(self, ref):
        props = _el(ref, "hh", "paraProperties", itemCnt=len(PARAPR_BY_ALIGN))
        align_names = {
            Align.JUSTIFY: "JUSTIFY",
            Align.LEFT: "LEFT",
            Align.CENTER: "CENTER",
            Align.RIGHT: "RIGHT",
        }
        for align, idx in PARAPR_BY_ALIGN.items():
            pp = _el(props, "hh", "paraPr", id=idx, tabPrIDRef="0",
                     condense="0", fontLineHeight="0", snapToGrid="1",
                     suppressLineNumbers="0", checked="0")
            _el(pp, "hh", "align", horizontal=align_names[align], vertical="BASELINE")
            _el(pp, "hh", "heading", type="NONE", idRef="0", level="0")
            _el(pp, "hh", "breakSetting", breakLatinWord="KEEP_WORD",
                breakNonLatinWord="KEEP_WORD", widowOrphan="0",
                keepWithNext="0", keepLines="0", pageBreakBefore="0",
                lineWrap="BREAK")
            _el(pp, "hh", "margin")
            _el(pp, "hh", "lineSpacing", type="PERCENT", value="160", unit="HWPUNIT")
            _el(pp, "hh", "border", borderFillIDRef="1", offsetLeft="0",
                offsetRight="0", offsetTop="0", offsetBottom="0",
                connect="0", ignoreMargin="0")

    def _styles(self, ref):
        entries = [("본문", "Normal", 0, CHARPR_BODY)]
        entries += [
            (f"개요 {lv}", f"Heading {lv}", 1, CHARPR_HEADING_BASE + lv - 1)
            for lv in range(1, 7)
        ]
        styles = _el(ref, "hh", "styles", itemCnt=len(entries))
        for idx, (name, eng, para_pr, char_pr) in enumerate(entries):
            _el(styles, "hh", "style", id=idx, type="PARA", name=name,
                engName=eng, paraPrIDRef=para_pr, charPrIDRef=char_pr,
                nextStyleIDRef="0", langID="1042", lockForm="0")

    # -------------------------------------------------------- section0.xml
    def _section_xml(self):
        root = etree.Element(
            _q("hs", "sec"),
            nsmap={"hs": NS["hs"], "hp": NS["hp"], "hc": NS["hc"]},
        )
        # 표지 제목
        first = self._paragraph(
            root,
            [(self.doc.title, True)],
            char_pr=CHARPR_HEADING_BASE,
            para_pr=PARAPR_BY_ALIGN[Align.CENTER],
            style=1,
            with_sec_pr=True,
        )
        del first

        for block in self.doc.blocks:
            self._emit(root, block)
        return root

    def _emit(self, parent, block: Block) -> None:
        match block:
            case Heading(text=text, level=level):
                self._paragraph(
                    parent,
                    [(text, True)],
                    char_pr=CHARPR_HEADING_BASE + level - 1,
                    para_pr=PARAPR_BY_ALIGN[Align.LEFT],
                    style=level,
                )
            case Paragraph() as para:
                self._paragraph(
                    parent,
                    [(r.text, r.bold) for r in para.runs] or [("", False)],
                    char_pr=CHARPR_BODY,
                    para_pr=PARAPR_BY_ALIGN[para.align],
                    style=0,
                )
            case Table() as table:
                self._table(parent, table)
            case PageBreak():
                self._paragraph(
                    parent, [("", False)], char_pr=CHARPR_BODY,
                    para_pr=0, style=0, page_break=True,
                )
            case _:
                raise TypeError(f"지원하지 않는 블록입니다: {type(block).__name__}")

    def _paragraph(
        self,
        parent,
        runs: list[tuple[str, bool]],
        *,
        char_pr: int,
        para_pr: int,
        style: int,
        with_sec_pr: bool = False,
        page_break: bool = False,
    ):
        self._para_id += 1
        p = _el(parent, "hp", "p", id=self._para_id, paraPrIDRef=para_pr,
                styleIDRef=style, pageBreak=page_break, columnBreak="0",
                merged="0")
        for text, bold in runs:
            run = _el(p, "hp", "run",
                      charPrIDRef=CHARPR_BOLD if (bold and char_pr == CHARPR_BODY)
                      else char_pr)
            if with_sec_pr:
                self._sec_pr(run)
                with_sec_pr = False
            t = _el(run, "hp", "t")
            t.text = text
        return p

    def _sec_pr(self, run) -> None:
        sec = _el(run, "hp", "secPr", id="", textDirection="HORIZONTAL",
                  spaceColumns="1134", tabStop="8000", tabStopVal="4000",
                  tabStopUnit="MM", outlineShapeIDRef="1", memoShapeIDRef="0",
                  textVerticalWidthHead="0", masterPageCnt="0")
        _el(sec, "hp", "grid", lineGrid="0", charGrid="0", wonggojiFormat="0",
            strtnum="0")
        _el(sec, "hp", "startNum", pageStartsOn="BOTH", page="0", pic="0",
            tbl="0", equation="0")
        page = _el(sec, "hp", "pagePr", landscape="WIDELY", width=A4_WIDTH,
                   height=A4_HEIGHT, gutterType="LEFT_ONLY")
        _el(page, "hp", "margin", header=HEADER_FOOTER, footer=HEADER_FOOTER,
            gutter="0", left=MARGIN, right=MARGIN, top=MARGIN, bottom=MARGIN)

    def _table(self, parent, table: Table) -> None:
        self._para_id += 1
        holder = _el(parent, "hp", "p", id=self._para_id, paraPrIDRef="0",
                     styleIDRef="0", pageBreak="0", columnBreak="0", merged="0")
        run = _el(holder, "hp", "run", charPrIDRef=CHARPR_BODY)

        usable = A4_WIDTH - 2 * MARGIN
        widths = table.widths or [usable // table.n_cols] * table.n_cols
        total = sum(widths)
        row_height = round(8 * HWPUNIT_PER_MM)

        tbl = _el(run, "hp", "tbl", id=self._para_id, zOrder="0", numberingType="TABLE",
                  textWrap="TOP_AND_BOTTOM", textFlow="BOTH_SIDES", lock="0",
                  dropcapstyle="None", pageBreak="CELL", repeatHeader=table.header,
                  rowCnt=len(table.rows), colCnt=table.n_cols,
                  cellSpacing="0", borderFillIDRef="2", noAdjust="0")
        _el(tbl, "hp", "sz", width=total, widthRelTo="ABSOLUTE",
            height=row_height * len(table.rows), heightRelTo="ABSOLUTE",
            protect="0")
        _el(tbl, "hp", "pos", treatAsChar="0", affectLSpacing="0",
            flowWithText="1", allowOverlap="0", holdAnchorAndSO="0",
            vertRelTo="PARA", horzRelTo="COLUMN", vertAlign="TOP",
            horzAlign="LEFT", vertOffset="0", horzOffset="0")
        _el(tbl, "hp", "outMargin", left="0", right="0", top="0", bottom="0")
        _el(tbl, "hp", "inMargin", left="510", right="510", top="141", bottom="141")

        for r, row in enumerate(table.rows):
            tr = _el(tbl, "hp", "tr")
            for c, cell in enumerate(row):
                is_head = table.header and r == 0
                tc = _el(tr, "hp", "tc", name="", header=is_head,
                         hasMargin="0", protect="0", editable="0",
                         dirty="0", borderFillIDRef="2")
                sub = _el(tc, "hp", "subList", id="", textDirection="HORIZONTAL",
                          lineWrap="BREAK", vertAlign="CENTER",
                          linkListIDRef="0", linkListNextIDRef="0",
                          textWidth="0", textHeight="0", hasTextRef="0",
                          hasNumRef="0")
                self._paragraph(
                    sub, [(cell, is_head)],
                    char_pr=CHARPR_BODY,
                    para_pr=PARAPR_BY_ALIGN[
                        Align.CENTER if is_head else Align.LEFT
                    ],
                    style=0,
                )
                _el(tc, "hp", "cellAddr", colAddr=c, rowAddr=r)
                _el(tc, "hp", "cellSpan", colSpan="1", rowSpan="1")
                _el(tc, "hp", "cellSz", width=widths[c], height=row_height)
                _el(tc, "hp", "cellMargin", left="510", right="510",
                    top="141", bottom="141")


def write_hwpx(doc: Document, path: str | Path) -> Path:
    """편의 함수: IR 문서를 지정 경로에 HWPX 로 저장한다."""
    return HwpxWriter(doc).save(path)
