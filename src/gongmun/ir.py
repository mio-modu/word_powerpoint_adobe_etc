"""문서 중간표현(IR).

AI가 만드는 것은 이 IR 하나다. 출력 포맷(HWPX / DOCX / PDF)은
writers 패키지가 IR을 받아 변환한다. 포맷이 늘어나도 생성 로직은
건드리지 않는다.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class Align(str, Enum):
    LEFT = "left"
    CENTER = "center"
    RIGHT = "right"
    JUSTIFY = "justify"


@dataclass
class Run:
    """하나의 서식을 공유하는 연속된 글자."""

    text: str
    bold: bool = False
    italic: bool = False
    underline: bool = False

    def __post_init__(self) -> None:
        if not isinstance(self.text, str):
            raise TypeError(f"Run.text 는 str 이어야 합니다: {type(self.text)!r}")


@dataclass
class Paragraph:
    runs: list[Run] = field(default_factory=list)
    style: str = "본문"
    align: Align = Align.JUSTIFY
    # 0 = 본문, 1~6 = 개요 수준
    level: int = 0

    @classmethod
    def text(cls, value: str, **kwargs) -> Paragraph:
        """평문 한 줄로 단락을 만드는 단축 생성자."""
        return cls(runs=[Run(value)], **kwargs)

    @property
    def plain(self) -> str:
        return "".join(r.text for r in self.runs)


@dataclass
class Heading:
    text: str
    level: int = 1

    def __post_init__(self) -> None:
        if not 1 <= self.level <= 6:
            raise ValueError(f"제목 수준은 1~6 입니다: {self.level}")


@dataclass
class Table:
    """표. rows[0] 을 머리행으로 쓸지는 header 로 정한다."""

    rows: list[list[str]]
    header: bool = True
    widths: list[int] | None = None

    def __post_init__(self) -> None:
        if not self.rows:
            raise ValueError("표에 행이 없습니다")
        width = len(self.rows[0])
        for i, row in enumerate(self.rows):
            if len(row) != width:
                raise ValueError(
                    f"{i}행의 칸 수({len(row)})가 머리행({width})과 다릅니다"
                )
        if self.widths is not None and len(self.widths) != width:
            raise ValueError("widths 길이가 열 수와 다릅니다")

    @property
    def n_cols(self) -> int:
        return len(self.rows[0])


@dataclass
class PageBreak:
    pass


Block = Paragraph | Heading | Table | PageBreak


@dataclass
class Document:
    """완성된 제출문서 한 건."""

    title: str
    blocks: list[Block] = field(default_factory=list)
    # 공고번호, 수요기관 등. 머리말/꼬리말과 파일명에 쓴다.
    meta: dict[str, str] = field(default_factory=dict)

    def heading(self, text: str, level: int = 1) -> Document:
        self.blocks.append(Heading(text, level))
        return self

    def para(self, text: str, **kwargs) -> Document:
        self.blocks.append(Paragraph.text(text, **kwargs))
        return self

    def table(self, rows: list[list[str]], **kwargs) -> Document:
        self.blocks.append(Table(rows, **kwargs))
        return self

    def page_break(self) -> Document:
        self.blocks.append(PageBreak())
        return self

    @property
    def plain_text(self) -> str:
        """미리보기(Preview/PrvText.txt)와 토큰 수 추정에 쓴다."""
        out: list[str] = [self.title, ""]
        for b in self.blocks:
            match b:
                case Heading(text=t):
                    out.append(t)
                case Paragraph() as p:
                    out.append(p.plain)
                case Table(rows=rows):
                    out.extend("\t".join(r) for r in rows)
                case PageBreak():
                    out.append("")
        return "\n".join(out)
