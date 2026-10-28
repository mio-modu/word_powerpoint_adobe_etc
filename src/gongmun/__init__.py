"""공공 제출문서 자동 생성 엔진.

AI 는 중간표현(IR) 하나만 만들고, writer 가 출력 포맷을 책임진다.
"""

from .ir import Align, Document, Heading, PageBreak, Paragraph, Run, Table
from .writers.docx_writer import write_docx
from .writers.hwpx import write_hwpx

__version__ = "0.1.0"

__all__ = [
    "Align",
    "Document",
    "Heading",
    "PageBreak",
    "Paragraph",
    "Run",
    "Table",
    "write_docx",
    "write_hwpx",
]
