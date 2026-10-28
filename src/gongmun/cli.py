"""명령줄 진입점."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .ir import Document
from .llm.client import LLM, estimate_unit_cost
from .llm.requirements import extract, to_document
from .writers.docx_writer import write_docx
from .writers.hwpx import write_hwpx

WRITERS = {"hwpx": write_hwpx, "docx": write_docx}


def _emit(doc: Document, out: Path, fmt: str) -> list[Path]:
    formats = list(WRITERS) if fmt == "both" else [fmt]
    written = []
    for name in formats:
        written.append(WRITERS[name](doc, out.with_suffix(f".{name}")))
    return written


def cmd_checklist(args) -> int:
    text = Path(args.notice).read_text(encoding="utf-8")
    llm = LLM()
    reqs = extract(text, llm)
    if not reqs:
        print("요건을 찾지 못했습니다. 공고문 본문을 확인하세요.", file=sys.stderr)
        return 1

    doc = to_document(reqs, title=args.title, meta={"출처": Path(args.notice).name})
    for path in _emit(doc, Path(args.out), args.format):
        print(f"생성: {path}")
    print(f"\n요건 {len(reqs)}개 (필수 {sum(r.blocking for r in reqs)}개)")
    print(llm.usage.report())
    return 0


def cmd_demo(args) -> int:
    """API 키 없이 두 writer 출력물을 만들어 본다."""
    doc = Document(
        "문서 자동화 시스템 구축 제안서",
        meta={"공고번호": "DEMO-0001", "수요기관": "○○청"},
    )
    doc.heading("1. 사업 개요", 1)
    doc.para("공고 요건을 반영하여 작성한 제안서 초안입니다.")
    doc.heading("1.1 추진 배경", 2)
    doc.para("공공문서 작성 업무의 반복 공정을 자동화하여 처리 기간을 단축합니다.")
    doc.table(
        [
            ["구분", "내용", "비고"],
            ["사업기간", "착수일로부터 12개월", "검수 2주 포함"],
            ["사업금액", "250,000,000원", "부가세 포함"],
            ["수행인력", "5명", "PM 1, 개발 3, QA 1"],
        ]
    )
    doc.page_break()
    doc.heading("2. 수행 계획", 1)
    doc.para("3단계로 추진합니다.")
    for path in _emit(doc, Path(args.out), args.format):
        print(f"생성: {path} ({path.stat().st_size:,} bytes)")
    return 0


def cmd_cost(args) -> int:
    result = estimate_unit_cost(
        cached_tokens=args.cached,
        fresh_input_tokens=args.fresh,
        output_tokens=args.output,
        model=args.model,
    )
    print(f"모델 {args.model}")
    print(f"건당 원가  ${result['usd']:.4f} ≈ {result['krw']:,.1f}원")
    print(f"캐싱 미적용 ${result['usd_without_cache']:.4f} "
          f"(절감 {result['saved_pct']}%)")
    if args.price:
        cost = result["krw"] * args.volume
        margin = args.price - cost
        print(f"\n월 {args.volume}건 / 청구 {args.price:,}원")
        print(f"  원가 {cost:,.0f}원 · 마진 {margin:,.0f}원 "
              f"({margin / args.price * 100:.1f}%)")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="gongmun", description="공공 제출문서 자동 생성 엔진"
    )
    subs = parser.add_subparsers(dest="command", required=True)

    def add_format(p):
        p.add_argument("--format", choices=["hwpx", "docx", "both"], default="both")

    p = subs.add_parser("checklist", help="공고문 -> 요건 체크리스트")
    p.add_argument("notice", help="공고문 본문 텍스트 파일")
    p.add_argument("--out", default="out/checklist")
    p.add_argument("--title", default="입찰 요건 체크리스트")
    add_format(p)
    p.set_defaults(func=cmd_checklist)

    p = subs.add_parser("demo", help="API 키 없이 샘플 문서 생성")
    p.add_argument("--out", default="out/demo")
    add_format(p)
    p.set_defaults(func=cmd_demo)

    p = subs.add_parser("cost", help="건당 원가와 마진 계산")
    p.add_argument("--cached", type=int, default=150_000)
    p.add_argument("--fresh", type=int, default=8_000)
    p.add_argument("--output", type=int, default=30_000)
    p.add_argument("--model", default="claude-opus-5-5")
    p.add_argument("--price", type=int, help="월 청구액(원)")
    p.add_argument("--volume", type=int, default=20, help="월 처리 건수")
    p.set_defaults(func=cmd_cost)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
