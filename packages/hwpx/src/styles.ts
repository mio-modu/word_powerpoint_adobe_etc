import {
  attr,
  attrInt,
  charHeight,
  childElements,
  firstChild,
  path,
  type CharStyle,
  type HorizontalAlign,
  type ParagraphStyle,
  type XmlElement,
} from '@jamo/core';

/**
 * header.xml 의 참조 테이블을 읽어, ID 참조를 실제 서식으로 풀어준다.
 *
 * HWPX 는 문단/글자 서식을 본문에 직접 쓰지 않고 `charPrIDRef="3"` 처럼
 * 번호로만 가리킨다. 그 번호를 풀지 못하면 화면에 서식이 하나도 나타나지 않는다.
 */

export interface FontFace {
  id: string;
  face: string;
  type?: string;
}

export interface HwpxStyleTables {
  /** 언어별 글꼴 목록. 키는 HANGUL/LATIN/… */
  fonts: Map<string, Map<string, FontFace>>;
  charPr: Map<string, XmlElement>;
  paraPr: Map<string, XmlElement>;
  /** 스타일(바탕글, 개요 1 …). */
  styles: Map<string, XmlElement>;
  /** 테두리·배경. 표 칸의 배경색이 여기 들어 있다. */
  borderFill: Map<string, XmlElement>;
}

export function readStyleTables(headerRoot: XmlElement): HwpxStyleTables {
  const refList = firstChild(headerRoot, 'hh:refList');
  const tables: HwpxStyleTables = {
    fonts: new Map(),
    charPr: new Map(),
    paraPr: new Map(),
    styles: new Map(),
    borderFill: new Map(),
  };
  if (!refList) return tables;

  const fontfaces = firstChild(refList, 'hh:fontfaces');
  if (fontfaces) {
    for (const ff of childElements(fontfaces, 'hh:fontface')) {
      const lang = attr(ff, 'lang') ?? 'HANGUL';
      const byId = new Map<string, FontFace>();
      for (const font of childElements(ff, 'hh:font')) {
        const id = attr(font, 'id');
        const face = attr(font, 'face');
        if (id === undefined || face === undefined) continue;
        byId.set(id, { id, face, type: attr(font, 'type') });
      }
      tables.fonts.set(lang, byId);
    }
  }

  collectById(firstChild(refList, 'hh:borderFills'), 'hh:borderFill', tables.borderFill);
  collectById(firstChild(refList, 'hh:charProperties'), 'hh:charPr', tables.charPr);
  collectById(firstChild(refList, 'hh:paraProperties'), 'hh:paraPr', tables.paraPr);
  collectById(firstChild(refList, 'hh:styles'), 'hh:style', tables.styles);
  return tables;
}

function collectById(
  container: XmlElement | undefined,
  childName: string,
  into: Map<string, XmlElement>,
): void {
  if (!container) return;
  for (const el of childElements(container, childName)) {
    const id = attr(el, 'id');
    if (id !== undefined) into.set(id, el);
  }
}

/** 글꼴 참조를 실제 글꼴 이름으로. 한글 글꼴을 대표값으로 쓴다. */
export function resolveFontName(tables: HwpxStyleTables, charPr: XmlElement): string | undefined {
  const fontRef = firstChild(charPr, 'hh:fontRef');
  if (!fontRef) return undefined;
  // 한글 문서이므로 한글 글꼴이 대표. 없으면 라틴으로 대체한다.
  for (const [langAttr, langKey] of [
    ['hangul', 'HANGUL'],
    ['latin', 'LATIN'],
  ] as const) {
    const id = attr(fontRef, langAttr);
    if (id === undefined) continue;
    const face = tables.fonts.get(langKey)?.get(id)?.face;
    if (face) return face;
  }
  return undefined;
}

export function charStyleFrom(
  tables: HwpxStyleTables,
  charPrIdRef: string | undefined,
): CharStyle | undefined {
  if (charPrIdRef === undefined) return undefined;
  const cp = tables.charPr.get(charPrIdRef);
  if (!cp) return undefined;

  const style: CharStyle = {};
  const fontFamily = resolveFontName(tables, cp);
  if (fontFamily) style.fontFamily = fontFamily;

  const height = attr(cp, 'height');
  if (height !== undefined) style.fontSize = charHeight.toPoint(Number.parseInt(height, 10));

  const textColor = attr(cp, 'textColor');
  if (textColor && textColor !== 'none') style.color = textColor;

  const shade = attr(cp, 'shadeColor');
  if (shade && shade !== 'none') style.highlight = shade;

  // bold/italic 은 값이 아니라 "요소의 존재"로 표현된다.
  if (firstChild(cp, 'hh:bold')) style.bold = true;
  if (firstChild(cp, 'hh:italic')) style.italic = true;
  if (firstChild(cp, 'hh:supscript')) style.superscript = true;
  if (firstChild(cp, 'hh:subscript')) style.subscript = true;

  const underline = firstChild(cp, 'hh:underline');
  if (underline) {
    const type = attr(underline, 'type');
    if (type && type !== 'NONE') style.underline = true;
  }

  const strikeout = firstChild(cp, 'hh:strikeout');
  if (strikeout) {
    const shape = attr(strikeout, 'shape');
    if (shape && shape !== 'NONE') style.strikeout = true;
  }

  return style;
}

const ALIGN_MAP: Record<string, HorizontalAlign> = {
  LEFT: 'left',
  CENTER: 'center',
  RIGHT: 'right',
  JUSTIFY: 'justify',
  DISTRIBUTE: 'distribute',
  DISTRIBUTE_SPACE: 'distribute',
};

export function paragraphStyleFrom(
  tables: HwpxStyleTables,
  paraPrIdRef: string | undefined,
  styleIdRef: string | undefined,
): ParagraphStyle | undefined {
  const style: ParagraphStyle = {};

  if (styleIdRef !== undefined) {
    const st = tables.styles.get(styleIdRef);
    const name = st && attr(st, 'name');
    if (name) style.styleName = name;
  }

  const pp = paraPrIdRef === undefined ? undefined : tables.paraPr.get(paraPrIdRef);
  if (pp) {
    const align = firstChild(pp, 'hh:align');
    const horizontal = align && attr(align, 'horizontal');
    if (horizontal && ALIGN_MAP[horizontal]) style.align = ALIGN_MAP[horizontal];

    const heading = firstChild(pp, 'hh:heading');
    if (heading) {
      const type = attr(heading, 'type');
      const level = attrInt(heading, 'level', 0);
      if (type === 'OUTLINE') style.outlineLevel = level + 1;
      else if (type === 'NUMBER' || type === 'BULLET') style.listLevel = level + 1;
    }

    // margin/lineSpacing 은 hp:switch 로 감싸여 있을 수도, 직접 놓여 있을 수도 있다.
    const holder = findPropHolder(pp);
    const margin = holder && firstChild(holder, 'hh:margin');
    if (margin) {
      const left = numberOf(margin, 'hc:left');
      const right = numberOf(margin, 'hc:right');
      const intent = numberOf(margin, 'hc:intent');
      const prev = numberOf(margin, 'hc:prev');
      const next = numberOf(margin, 'hc:next');
      if (left !== undefined) style.indentLeft = left;
      if (right !== undefined) style.indentRight = right;
      if (intent !== undefined) style.indentFirstLine = intent;
      if (prev !== undefined) style.spaceBefore = prev;
      if (next !== undefined) style.spaceAfter = next;
    }

    const lineSpacing = holder && firstChild(holder, 'hh:lineSpacing');
    if (lineSpacing) {
      const type = attr(lineSpacing, 'type');
      const value = attrInt(lineSpacing, 'value', 100);
      style.lineHeight = { type: type === 'PERCENT' ? 'percent' : 'hwpunit', value };
    }
  }

  return Object.keys(style).length > 0 ? style : undefined;
}

/**
 * paraPr 의 margin/lineSpacing 이 담긴 요소를 찾는다.
 *
 * 한글 2016 이후 파일은 `hp:switch` 안에 호환용으로 두 벌(`hp:case`/`hp:default`)을
 * 넣어둔다. `hp:case` 쪽이 신버전 해석이므로 그쪽을 우선한다.
 */
function findPropHolder(paraPr: XmlElement): XmlElement {
  const sw = firstChild(paraPr, 'hp:switch');
  if (!sw) return paraPr;
  return firstChild(sw, 'hp:case') ?? firstChild(sw, 'hp:default') ?? paraPr;
}

function numberOf(parent: XmlElement, childName: string): number | undefined {
  const el = firstChild(parent, childName);
  if (!el) return undefined;
  const raw = attr(el, 'value');
  if (raw === undefined) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

/** 섹션 첫 문단의 `hp:secPr` 에서 용지 설정을 읽는다. */
export function readPageSetup(sectionRoot: XmlElement): XmlElement | undefined {
  for (const p of childElements(sectionRoot, 'hp:p')) {
    for (const run of childElements(p, 'hp:run')) {
      const secPr = firstChild(run, 'hp:secPr');
      if (secPr) return secPr;
    }
  }
  return path(sectionRoot, 'hp:secPr');
}

/**
 * borderFill 번호에서 칸 배경색을 꺼낸다.
 *
 * HWPX 는 칸에 색을 직접 쓰지 않고 테두리·배경 묶음을 번호로 가리킨다.
 * 그 묶음 안의 `hc:winBrush/@faceColor` 가 실제 배경색이다. 칠하지 않은
 * 칸은 `none` 으로 적혀 있다.
 */
export function cellShadeOf(
  tables: HwpxStyleTables,
  borderFillIDRef: string | undefined,
): string | undefined {
  if (borderFillIDRef === undefined) return undefined;
  const borderFill = tables.borderFill.get(borderFillIDRef);
  if (!borderFill) return undefined;
  const brush = firstChild(borderFill, 'hc:fillBrush');
  const win = brush && firstChild(brush, 'hc:winBrush');
  const face = win && attr(win, 'faceColor');
  if (!face || face === 'none') return undefined;
  return face.toUpperCase();
}
