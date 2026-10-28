/**
 * 문서 포맷마다 길이 단위가 다르다. 변환의 90% 는 이 표에서 나온다.
 *
 * | 단위     | 1인치당 | 쓰는 곳                        |
 * |----------|---------|--------------------------------|
 * | HWPUNIT  | 7200    | HWP/HWPX 전반                  |
 * | twip     | 1440    | Word(DOCX) 문단·페이지          |
 * | EMU      | 914400  | OOXML 도형·이미지 좌표(PPTX 등) |
 * | pt       | 72      | 글자 크기                      |
 * | px(96dpi)| 96      | 화면 렌더링                    |
 *
 * HWPX 의 글자 크기는 `height="1000"` 처럼 **1/100 pt** 로 들어온다.
 * 7200/72 = 100 이므로 HWPUNIT 과 1/100pt 가 같은 값이다 — 혼동하기 쉬운 지점.
 */

export const HWPUNIT_PER_INCH = 7200;
export const TWIP_PER_INCH = 1440;
export const EMU_PER_INCH = 914400;
export const POINT_PER_INCH = 72;
export const MM_PER_INCH = 25.4;
/** CSS 기준 해상도. */
export const PX_PER_INCH = 96;

const round = (n: number): number => Math.round(n);

export const hwpunit = {
  toPoint: (v: number): number => (v * POINT_PER_INCH) / HWPUNIT_PER_INCH,
  toMm: (v: number): number => (v * MM_PER_INCH) / HWPUNIT_PER_INCH,
  toPx: (v: number): number => (v * PX_PER_INCH) / HWPUNIT_PER_INCH,
  toTwip: (v: number): number => round((v * TWIP_PER_INCH) / HWPUNIT_PER_INCH),
  toEmu: (v: number): number => round((v * EMU_PER_INCH) / HWPUNIT_PER_INCH),
  fromPoint: (v: number): number => round((v * HWPUNIT_PER_INCH) / POINT_PER_INCH),
  fromMm: (v: number): number => round((v * HWPUNIT_PER_INCH) / MM_PER_INCH),
  fromPx: (v: number): number => round((v * HWPUNIT_PER_INCH) / PX_PER_INCH),
  fromTwip: (v: number): number => round((v * HWPUNIT_PER_INCH) / TWIP_PER_INCH),
  fromEmu: (v: number): number => round((v * HWPUNIT_PER_INCH) / EMU_PER_INCH),
};

export const twip = {
  toPoint: (v: number): number => (v * POINT_PER_INCH) / TWIP_PER_INCH,
  toMm: (v: number): number => (v * MM_PER_INCH) / TWIP_PER_INCH,
  toPx: (v: number): number => (v * PX_PER_INCH) / TWIP_PER_INCH,
  fromPoint: (v: number): number => round((v * TWIP_PER_INCH) / POINT_PER_INCH),
  fromMm: (v: number): number => round((v * TWIP_PER_INCH) / MM_PER_INCH),
};

export const emu = {
  toPoint: (v: number): number => (v * POINT_PER_INCH) / EMU_PER_INCH,
  toMm: (v: number): number => (v * MM_PER_INCH) / EMU_PER_INCH,
  toPx: (v: number): number => (v * PX_PER_INCH) / EMU_PER_INCH,
  fromPoint: (v: number): number => round((v * EMU_PER_INCH) / POINT_PER_INCH),
  fromMm: (v: number): number => round((v * EMU_PER_INCH) / MM_PER_INCH),
  fromPx: (v: number): number => round((v * EMU_PER_INCH) / PX_PER_INCH),
};

/** HWPX `charPr/@height` ↔ pt. */
export const charHeight = {
  toPoint: (v: number): number => v / 100,
  fromPoint: (v: number): number => round(v * 100),
};

/** DOCX `w:sz` 는 half-point 단위다. */
export const halfPoint = {
  toPoint: (v: number): number => v / 2,
  fromPoint: (v: number): number => round(v * 2),
};

/** 자주 쓰는 용지 크기 (HWPUNIT). */
export const PAPER = {
  /** 210 × 297 mm */
  A4: { width: 59528, height: 84188 },
  /** 297 × 420 mm */
  A3: { width: 84188, height: 119055 },
  /** 148 × 210 mm */
  A5: { width: 41953, height: 59528 },
  /** 8.5 × 11 in */
  LETTER: { width: 61200, height: 79200 },
} as const;
