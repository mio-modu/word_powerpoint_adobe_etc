/**
 * 포맷 중립 문서 모델.
 *
 * HWPX ↔ DOCX ↔ PPTX ↔ HWP5 를 n×n 으로 변환하면 조합이 폭발한다.
 * 그래서 모든 포맷은 이 모델을 경유한다 (n×2 개의 어댑터면 끝).
 *
 * 렌더링과 변환에 필요한 만큼만 담고, 포맷 고유 정보는 원본 XML 트리에
 * 남겨둔다. 즉 이 모델은 **읽기/표시/변환용 요약**이고, 저장할 때는
 * 원본 트리를 고쳐 쓰므로 모델에 없는 속성이 유실되지 않는다.
 *
 * 길이는 전부 HWPUNIT(1/7200인치)으로 정규화한다. 단위를 하나로 모으는
 * 것만으로 변환 버그의 큰 축이 사라진다.
 */

export interface DocMeta {
  title?: string;
  creator?: string;
  lastModifiedBy?: string;
  description?: string;
  keywords?: string;
  language?: string;
  createdAt?: string;
  modifiedAt?: string;
}

export type HorizontalAlign = 'left' | 'center' | 'right' | 'justify' | 'distribute';

export interface CharStyle {
  /** 글꼴 이름. 한글/라틴을 구분하지 않은 대표값. */
  fontFamily?: string;
  /** pt. */
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikeout?: boolean;
  /** `#RRGGBB`. */
  color?: string;
  /** 형광펜/음영 색. */
  highlight?: string;
  superscript?: boolean;
  subscript?: boolean;
}

export interface ParagraphStyle {
  align?: HorizontalAlign;
  /** HWPUNIT. */
  indentLeft?: number;
  indentRight?: number;
  /** 첫 줄 들여쓰기(음수면 내어쓰기). HWPUNIT. */
  indentFirstLine?: number;
  spaceBefore?: number;
  spaceAfter?: number;
  /** 줄 간격. `percent` 면 100 = 100%. */
  lineHeight?: { type: 'percent' | 'hwpunit'; value: number };
  /** 개요 수준. 0 = 본문. */
  outlineLevel?: number;
  /** 글머리표/번호 목록 여부. */
  listLevel?: number;
  /** 스타일 이름 (바탕글, Heading 1 …). */
  styleName?: string;
}

export interface JamoRun {
  text: string;
  style?: CharStyle;
  /** 이 런이 유래한 원본 XML 노드. 저장 시 제자리 수정을 위해 들고 있는다. */
  source?: unknown;
}

export interface JamoParagraph {
  /** 블록 종류. 문단은 생략 가능하다 (기본값). */
  type?: 'paragraph';
  runs: JamoRun[];
  style?: ParagraphStyle;
  source?: unknown;
}

export interface JamoTableCell {
  /** 셀 안의 문단들. 셀은 그 자체로 작은 문서다. */
  paragraphs: JamoParagraph[];
  /** 가로로 합쳐진 칸 수. 기본 1. */
  colSpan: number;
  rowSpan: number;
  /** 0부터 세는 칸/줄 위치. 병합이 있으면 순서와 일치하지 않는다. */
  colAddr: number;
  rowAddr: number;
  /** HWPUNIT. */
  width?: number;
  height?: number;
  /** 칸 배경색 `#RRGGBB`. 없으면 칠하지 않은 것. */
  shade?: string;
  source?: unknown;
}

export interface JamoTableRow {
  cells: JamoTableCell[];
  source?: unknown;
}

export interface JamoTable {
  type: 'table';
  rows: JamoTableRow[];
  /** 칸 너비 (HWPUNIT). 알 수 없으면 비어 있다. */
  columnWidths?: number[];
  /** 표 전체 너비 (HWPUNIT). */
  width?: number;
  source?: unknown;
}

/**
 * 본문을 이루는 덩어리. 문단 아니면 표다.
 *
 * 표를 문단 목록에 억지로 끼워 넣지 않고 별도 블록으로 둔 이유: 표는 안에
 * 또 문단을 품는 재귀 구조라, 평평한 문단 목록으로는 표현할 수 없다.
 */
export type JamoBlock = JamoParagraph | JamoTable;

export function isTable(block: JamoBlock): block is JamoTable {
  return (block as JamoTable).type === 'table';
}

export function isParagraph(block: JamoBlock): block is JamoParagraph {
  return (block as JamoTable).type !== 'table';
}

/** 표 안쪽까지 포함해 모든 문단을 문서 순서로 모은다. */
export function allParagraphs(blocks: JamoBlock[]): JamoParagraph[] {
  const out: JamoParagraph[] = [];
  for (const block of blocks) {
    if (isTable(block)) {
      for (const row of block.rows) {
        for (const cell of row.cells) out.push(...cell.paragraphs);
      }
    } else {
      out.push(block);
    }
  }
  return out;
}

export interface PageSetup {
  /** HWPUNIT. */
  width: number;
  height: number;
  landscape: boolean;
  margin: {
    left: number;
    right: number;
    top: number;
    bottom: number;
    header: number;
    footer: number;
    gutter: number;
  };
}

export interface JamoSection {
  page: PageSetup;
  /** 문단과 표가 문서에 나오는 순서대로. */
  blocks: JamoBlock[];
}

/** 워드프로세서 문서 (HWP/HWPX/DOCX). */
export interface JamoTextDocument {
  kind: 'text';
  meta: DocMeta;
  sections: JamoSection[];
}

/** 채우기. 그라데이션은 화면에서 선형으로 근사한다. */
export interface JamoFill {
  type: 'solid' | 'gradient' | 'none';
  /** `#RRGGBB`. */
  color?: string;
  /** 0–1. 1이면 불투명. */
  alpha?: number;
  gradient?: { from: string; to: string; angle: number };
}

/** 그림. 실제 바이트는 파일 안의 파트에서 꺼낸다. */
export interface JamoImage {
  /** 패키지 안의 파트 경로 (`ppt/media/image1.png`). */
  part: string;
  alt?: string;
  /**
   * 틀에 어떻게 채우는지.
   * `fill` 은 비율을 무시하고 틀에 맞춰 늘린다 — PPTX 의 기본값이다.
   * `contain` 은 비율을 지키며 안에 들인다.
   */
  fit?: 'fill' | 'contain' | 'cover';
}

export interface JamoShape {
  id: string;
  name?: string;
  /** HWPUNIT. 슬라이드 좌상단 기준. */
  frame?: { x: number; y: number; width: number; height: number };
  /** 자리 표시자 종류 (title, body, ctrTitle …). */
  placeholder?: string;
  paragraphs: JamoParagraph[];
  /** 도형 배경. */
  fill?: JamoFill;
  /** 테두리. */
  line?: { color?: string; width?: number };
  /** 그림 도형이면 그 그림. */
  image?: JamoImage;
  /**
   * 도형 모양. PPTX 는 수백 가지를 정의하지만 화면에서 구분이 되는 건 몇 개뿐이라
   * 사각형·둥근사각형·타원·선으로 줄여서 들고 있는다.
   */
  geometry?: 'rect' | 'roundRect' | 'ellipse' | 'line' | 'other';
  /** 둥근 모서리 반경 (짧은 변 대비 0–0.5). */
  cornerRadius?: number;
  /** 표 도형이면 그 표. */
  table?: JamoTable;
  /** 시계 방향 회전 각도. */
  rotation?: number;
  flipH?: boolean;
  flipV?: boolean;
  /** 글상자 안 세로 정렬. */
  anchor?: 'top' | 'middle' | 'bottom';
  /** 도형 안 여백 (HWPUNIT). */
  inset?: { left: number; right: number; top: number; bottom: number };
  /** 그릴 순서. 작은 값이 아래. */
  zIndex?: number;
  source?: unknown;
}

export interface JamoSlide {
  shapes: JamoShape[];
  /** 슬라이드 배경. 슬라이드 → 레이아웃 → 마스터 순으로 찾는다. */
  background?: JamoFill;
  /** 슬라이드 노트 본문. */
  notes?: string;
  source?: unknown;
}

/** 프레젠테이션 (PPTX). */
export interface JamoPresentation {
  kind: 'slides';
  meta: DocMeta;
  /** HWPUNIT. */
  slideSize: { width: number; height: number };
  slides: JamoSlide[];
}

export type JamoContent = JamoTextDocument | JamoPresentation;

export function emptyPageSetup(): PageSetup {
  return {
    width: 59528,
    height: 84188,
    landscape: false,
    margin: {
      left: 8504,
      right: 8504,
      top: 5668,
      bottom: 4252,
      header: 4252,
      footer: 4252,
      gutter: 0,
    },
  };
}

/** 문서 전체의 평문. 검색·미리보기·테스트에 쓴다. */
export function plainText(content: JamoContent): string {
  if (content.kind === 'text') {
    return content.sections.flatMap((s) => blockText(s.blocks)).join('\n');
  }
  return content.slides
    .map((slide) => slide.shapes.flatMap((sh) => sh.paragraphs.map(paragraphText)).join('\n'))
    .join('\n\n');
}

export function paragraphText(p: JamoParagraph): string {
  return p.runs.map((r) => r.text).join('');
}

/** 블록 목록의 평문. 표는 셀을 탭으로, 줄을 줄바꿈으로 잇는다. */
export function blockText(blocks: JamoBlock[]): string[] {
  const out: string[] = [];
  for (const block of blocks) {
    if (isTable(block)) {
      for (const row of block.rows) {
        out.push(row.cells.map((c) => c.paragraphs.map(paragraphText).join(' ')).join('\t'));
      }
    } else {
      out.push(paragraphText(block));
    }
  }
  return out;
}

export function emptyCell(colAddr: number, rowAddr: number): JamoTableCell {
  return { paragraphs: [{ runs: [{ text: '' }] }], colSpan: 1, rowSpan: 1, colAddr, rowAddr };
}
