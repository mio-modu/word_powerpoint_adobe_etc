"""명령줄 진입점."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import fonts, render
from .gemini import Gemini
from .pipeline import run
from .spec import SPECS


def cmd_make(args) -> int:
    gemini = Gemini()
    try:
        batch = run(
            Path(args.photo),
            args.name,
            Path(args.out),
            count=args.count,
            specs=args.specs,
            layouts=args.layouts,
            price=args.price,
            benefit=args.benefit,
            scenes=args.scenes,
            gemini=gemini,
        )
    except FileNotFoundError as exc:
        print(exc, file=sys.stderr)
        return 1

    print(f"분류 {batch.product.category} · 타겟 {batch.product.target}")
    print(f"\n문구 {len(batch.creatives)}종")
    for i, c in enumerate(batch.creatives, 1):
        print(f"  {i:2}. [{c.angle}] {c.headline} / {c.sub}")

    print(f"\n소재 {len(batch.files)}장 -> {args.out}")
    if batch.warnings:
        print(f"\n경고 {len(batch.warnings)}건")
        for w in batch.warnings[:10]:
            print(f"  - {w}")

    per = batch.cost_krw / max(1, len(batch.files))
    print(f"\n{gemini.usage.report()}")
    print(f"소재 1장당 {per:.2f}원")
    return 0


def cmd_specs(args) -> int:
    for key, spec in SPECS.items():
        safe = ""
        if spec.safe_top or spec.safe_bottom:
            safe = f"  세이프존 상 {spec.safe_top:.0%} / 하 {spec.safe_bottom:.0%}"
        print(f"{key:10} {spec.width:>5}x{spec.height:<5} {spec.label}{safe}")
    print(f"\n레이아웃: {', '.join(render.LAYOUTS)}")
    return 0


def cmd_doctor(args) -> int:
    """판매 전 환경 점검."""
    ok = True
    faces = fonts.available()
    if faces:
        print(f"✓ 한글 폰트 {len(faces)}종")
        for f in faces[:3]:
            print(f"    {Path(f.path).name}  ({f.license})")
    else:
        ok = False
        print("✗ 한글 폰트 없음 -> apt-get install fonts-noto-cjk")

    try:
        Gemini().text("copy", "'확인' 두 글자만 출력하십시오.", temperature=0)
        print("✓ Gemini 연결")
    except Exception as exc:
        ok = False
        print(f"✗ Gemini 연결 실패: {str(exc)[:160]}")

    print("\n판매 전 확인:")
    print("  - 폰트 라이선스가 상업적 이용을 허용하는지")
    print("  - 생성 이미지에 AI 생성 표기를 넣을지 (EU 판매 시 의무)")
    print("  - 상품 사진의 권리를 고객이 보유하는지")
    return 0 if ok else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="sojae", description="상품 사진 1장 -> 규격별 한글 광고 소재 묶음"
    )
    subs = parser.add_subparsers(dest="command", required=True)

    p = subs.add_parser("make", help="소재 생성")
    p.add_argument("photo", help="상품 사진 경로")
    p.add_argument("name", help="상품명")
    p.add_argument("--out", default="out", help="출력 폴더")
    p.add_argument("--count", type=int, default=8, help="문구 종수")
    p.add_argument("--specs", nargs="*", help=f"규격 ({', '.join(SPECS)})")
    p.add_argument("--layouts", nargs="*", help=f"레이아웃 ({', '.join(render.LAYOUTS)})")
    p.add_argument("--price", default="", help="가격 표기")
    p.add_argument("--benefit", default="", help="혜택 표기")
    p.add_argument("--scenes", type=int, default=0, help="AI 배경 장면 생성 수")
    p.set_defaults(func=cmd_make)

    p = subs.add_parser("specs", help="지원 규격·레이아웃 목록")
    p.set_defaults(func=cmd_specs)

    p = subs.add_parser("doctor", help="환경 점검")
    p.set_defaults(func=cmd_doctor)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
