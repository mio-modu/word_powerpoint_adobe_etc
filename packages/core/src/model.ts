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
  runs: JamoRun[];
  style?: ParagraphStyle;
  source?: unknown;
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
  paragraphs: JamoParagraph[];
}

/** 워드프로세서 문서 (HWP/HWPX/DOCX). */
export interface JamoTextDocument {
  kind: 'text';
  meta: DocMeta;
  sections: JamoSection[];
}

export interface JamoShape {
  id: string;
  name?: string;
  /** HWPUNIT. 슬라이드 좌상단 기준. */
  frame?: { x: number; y: number; width: number; height: number };
  /** 자리 표시자 종류 (title, body, ctrTitle …). */
  placeholder?: string;
  paragraphs: JamoParagraph[];
  source?: unknown;
}

export interface JamoSlide {
  shapes: JamoShape[];
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
    return content.sections
      .flatMap((s) => s.paragraphs.map(paragraphText))
      .join('\n');
  }
  return content.slides
    .map((slide) => slide.shapes.flatMap((sh) => sh.paragraphs.map(paragraphText)).join('\n'))
    .join('\n\n');
}

export function paragraphText(p: JamoParagraph): string {
  return p.runs.map((r) => r.text).join('');
}
