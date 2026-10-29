import {
  attr,
  childElements,
  element,
  emu,
  firstChild,
  setTextContent,
  textContent,
  type CharStyle,
  type HorizontalAlign,
  type ParagraphStyle,
  type XmlElement,
} from '@jamo/core';

/**
 * DrawingML 텍스트 다루기.
 *
 * PPTX 의 글자 크기 `sz` 는 1/100 pt 다 (1800 = 18pt). HWPX 의 `height` 와
 * 같은 단위라 편하지만, DOCX 의 half-point 와는 다르니 섞으면 안 된다.
 */

const ALIGN_FROM: Record<string, HorizontalAlign> = {
  l: 'left',
  ctr: 'center',
  r: 'right',
  just: 'justify',
  dist: 'distribute',
  justLow: 'justify',
  thaiDist: 'distribute',
};

const ALIGN_TO: Record<HorizontalAlign, string> = {
  left: 'l',
  center: 'ctr',
  right: 'r',
  justify: 'just',
  distribute: 'dist',
};

function boolAttr(el: XmlElement, name: string): boolean | undefined {
  const raw = attr(el, name);
  if (raw === undefined) return undefined;
  return raw === '1' || raw === 'true';
}

function colorOf(parent: XmlElement | undefined): string | undefined {
  if (!parent) return undefined;
  const srgb = firstChild(parent, 'a:srgbClr');
  if (srgb) {
    const val = attr(srgb, 'val');
    if (val) return `#${val}`;
  }
  const scheme = firstChild(parent, 'a:schemeClr');
  if (scheme) {
    const val = attr(scheme, 'val');
    // 테마 색은 이름만 남긴다. 실제 RGB 해석은 테마를 따라가야 한다.
    if (val) return `theme:${val}`;
  }
  return undefined;
}

export function readRunStyle(run: XmlElement): CharStyle | undefined {
  const rPr = firstChild(run, 'a:rPr');
  if (!rPr) return undefined;
  const style: CharStyle = {};

  const sz = attr(rPr, 'sz');
  if (sz !== undefined) {
    const n = Number.parseInt(sz, 10);
    if (Number.isFinite(n)) style.fontSize = n / 100;
  }
  const b = boolAttr(rPr, 'b');
  if (b !== undefined) style.bold = b;
  const i = boolAttr(rPr, 'i');
  if (i !== undefined) style.italic = i;
  const u = attr(rPr, 'u');
  if (u !== undefined) style.underline = u !== 'none';
  const strike = attr(rPr, 'strike');
  if (strike !== undefined) style.strikeout = strike !== 'noStrike';

  const baseline = attr(rPr, 'baseline');
  if (baseline !== undefined) {
    const n = Number.parseInt(baseline, 10);
    if (n > 0) style.superscript = true;
    else if (n < 0) style.subscript = true;
  }

  const color = colorOf(firstChild(rPr, 'a:solidFill'));
  if (color) style.color = color;
  const highlight = colorOf(firstChild(rPr, 'a:highlight'));
  if (highlight) style.highlight = highlight;

  const latin = firstChild(rPr, 'a:ea') ?? firstChild(rPr, 'a:latin');
  const typeface = latin && attr(latin, 'typeface');
  if (typeface) style.fontFamily = typeface;

  return Object.keys(style).length > 0 ? style : undefined;
}

export function readParagraphStyle(p: XmlElement): ParagraphStyle | undefined {
  const pPr = firstChild(p, 'a:pPr');
  if (!pPr) return undefined;
  const style: ParagraphStyle = {};
  const algn = attr(pPr, 'algn');
  if (algn && ALIGN_FROM[algn]) style.align = ALIGN_FROM[algn];
  const lvl = attr(pPr, 'lvl');
  if (lvl !== undefined) {
    const n = Number.parseInt(lvl, 10);
    if (Number.isFinite(n) && n > 0) style.listLevel = n + 1;
  }
  const marL = attr(pPr, 'marL');
  if (marL !== undefined) {
    const n = Number.parseInt(marL, 10);
    if (Number.isFinite(n)) style.indentLeft = emu.toPoint(n) * 100;
  }
  return Object.keys(style).length > 0 ? style : undefined;
}

export function buildRunProps(style: CharStyle | undefined, lang = 'ko-KR'): XmlElement {
  const attrs: Record<string, string> = { lang };
  if (style?.fontSize !== undefined) attrs['sz'] = String(Math.round(style.fontSize * 100));
  if (style?.bold) attrs['b'] = '1';
  if (style?.italic) attrs['i'] = '1';
  if (style?.underline) attrs['u'] = 'sng';
  if (style?.strikeout) attrs['strike'] = 'sngStrike';
  if (style?.superscript) attrs['baseline'] = '30000';
  else if (style?.subscript) attrs['baseline'] = '-25000';
  attrs['dirty'] = '0';

  const kids: XmlElement[] = [];
  if (style?.color && !style.color.startsWith('theme:')) {
    kids.push(
      element('a:solidFill', {}, [
        element('a:srgbClr', { val: style.color.replace(/^#/, '').toUpperCase() }),
      ]),
    );
  }
  if (style?.highlight && !style.highlight.startsWith('theme:')) {
    kids.push(
      element('a:highlight', {}, [
        element('a:srgbClr', { val: style.highlight.replace(/^#/, '').toUpperCase() }),
      ]),
    );
  }
  if (style?.fontFamily) {
    kids.push(
      element('a:latin', { typeface: style.fontFamily }),
      element('a:ea', { typeface: style.fontFamily }),
    );
  }
  return element('a:rPr', attrs, kids);
}

export function buildRun(text: string, style?: CharStyle): XmlElement {
  const t = element('a:t');
  setTextContent(t, text);
  return element('a:r', {}, [buildRunProps(style), t]);
}

export function buildParagraph(
  runs: Array<{ text: string; style?: CharStyle }>,
  paraStyle?: ParagraphStyle,
): XmlElement {
  const kids: XmlElement[] = [];
  if (paraStyle?.align || paraStyle?.listLevel) {
    const attrs: Record<string, string> = {};
    if (paraStyle.align) attrs['algn'] = ALIGN_TO[paraStyle.align];
    if (paraStyle.listLevel) attrs['lvl'] = String(paraStyle.listLevel - 1);
    kids.push(element('a:pPr', attrs));
  }
  // 빈 문단은 a:endParaRPr 만 둔다. PowerPoint 가 빈 줄로 표시한다.
  if (runs.length === 0 || runs.every((r) => r.text === '')) {
    kids.push(element('a:endParaRPr', { lang: 'ko-KR' }));
  } else {
    for (const r of runs) {
      // 줄바꿈은 a:br 로 쪼갠다.
      const pieces = r.text.split('\n');
      pieces.forEach((piece, i) => {
        if (i > 0) kids.push(element('a:br', {}, [buildRunProps(r.style)]));
        if (piece !== '') kids.push(buildRun(piece, r.style));
      });
    }
  }
  return element('a:p', {}, kids);
}

/** 도형 하나의 모든 문단. */
export function shapeParagraphs(sp: XmlElement): XmlElement[] {
  const txBody = firstChild(sp, 'p:txBody');
  return txBody ? childElements(txBody, 'a:p') : [];
}

export function paragraphText(p: XmlElement): string {
  let out = '';
  for (const child of p.children) {
    if (child.kind !== 'element') continue;
    if (child.name === 'a:r') {
      const t = firstChild(child, 'a:t');
      if (t) out += textContent(t);
    } else if (child.name === 'a:br') out += '\n';
    else if (child.name === 'a:fld') {
      const t = firstChild(child, 'a:t');
      if (t) out += textContent(t);
    }
  }
  return out;
}

export function paragraphRuns(p: XmlElement): XmlElement[] {
  return childElements(p, 'a:r');
}

/**
 * 런 하나의 텍스트.
 *
 * `paragraphText` 는 문단(`a:p`)을 받아 자식 `a:r` 을 훑는다. 런을 그대로
 * 넘기면 자식에 `a:r` 이 없어 빈 문자열이 나오므로 전용 함수가 필요하다.
 */
export function runText(run: XmlElement): string {
  const t = firstChild(run, 'a:t');
  return t ? textContent(t) : '';
}

/** 런의 텍스트만 교체 (서식 보존). */
export function setRunText(run: XmlElement, value: string): void {
  const t = firstChild(run, 'a:t');
  if (t) setTextContent(t, value);
  else {
    const el = element('a:t');
    setTextContent(el, value);
    run.children.push(el);
    run.selfClosed = false;
  }
}

/** 문단 텍스트를 첫 런의 서식으로 통일해 바꾼다. */
export function setParagraphText(p: XmlElement, value: string): void {
  const runs = paragraphRuns(p);
  const pPr = firstChild(p, 'a:pPr');
  if (runs.length === 0) {
    const rebuilt = buildParagraph([{ text: value }]);
    p.children = pPr ? [pPr, ...rebuilt.children.filter((c) => c !== pPr)] : rebuilt.children;
    p.selfClosed = false;
    return;
  }
  const style = readRunStyle(runs[0]!);
  const rebuilt = buildParagraph([{ text: value, style }]);
  p.children = pPr ? [pPr, ...rebuilt.children] : rebuilt.children;
  p.selfClosed = false;
}

export interface ShapeFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 도형 위치/크기 (EMU). */
export function readFrame(sp: XmlElement): ShapeFrame | undefined {
  const xfrm = firstChild(firstChild(sp, 'p:spPr') ?? sp, 'a:xfrm');
  if (!xfrm) return undefined;
  const off = firstChild(xfrm, 'a:off');
  const ext = firstChild(xfrm, 'a:ext');
  if (!off || !ext) return undefined;
  const n = (el: XmlElement, name: string): number => {
    const raw = attr(el, name);
    const v = raw === undefined ? NaN : Number.parseInt(raw, 10);
    return Number.isFinite(v) ? v : 0;
  };
  return { x: n(off, 'x'), y: n(off, 'y'), width: n(ext, 'cx'), height: n(ext, 'cy') };
}

/** 자리 표시자 종류 (title, body, ctrTitle …). 일반 도형이면 undefined. */
export function readPlaceholder(sp: XmlElement): string | undefined {
  const nvPr = firstChild(firstChild(sp, 'p:nvSpPr') ?? sp, 'p:nvPr');
  const ph = nvPr && firstChild(nvPr, 'p:ph');
  return ph ? (attr(ph, 'type') ?? 'body') : undefined;
}

export function readShapeName(sp: XmlElement): string | undefined {
  const cNvPr = firstChild(firstChild(sp, 'p:nvSpPr') ?? sp, 'p:cNvPr');
  return cNvPr ? attr(cNvPr, 'name') : undefined;
}

export interface TextBoxOptions {
  id: number;
  name?: string;
  /** EMU. */
  frame: ShapeFrame;
  paragraphs: Array<{ runs: Array<{ text: string; style?: CharStyle }>; style?: ParagraphStyle }>;
  /** 자동 줄바꿈 여부. 기본 true. */
  wrap?: boolean;
  /** 세로 정렬: t | ctr | b. */
  anchor?: 't' | 'ctr' | 'b';
}

/** 텍스트 상자 도형을 만든다. */
export function buildTextBox(opts: TextBoxOptions): XmlElement {
  const bodyPr = element('a:bodyPr', {
    wrap: opts.wrap === false ? 'none' : 'square',
    rtlCol: '0',
    ...(opts.anchor ? { anchor: opts.anchor } : {}),
  });
  const paragraphs =
    opts.paragraphs.length > 0
      ? opts.paragraphs.map((p) => buildParagraph(p.runs, p.style))
      : [buildParagraph([])];

  return element('p:sp', {}, [
    element('p:nvSpPr', {}, [
      element('p:cNvPr', { id: String(opts.id), name: opts.name ?? `텍스트 상자 ${opts.id}` }),
      element('p:cNvSpPr', { txBox: '1' }),
      element('p:nvPr'),
    ]),
    element('p:spPr', {}, [
      element('a:xfrm', {}, [
        element('a:off', { x: String(opts.frame.x), y: String(opts.frame.y) }),
        element('a:ext', { cx: String(opts.frame.width), cy: String(opts.frame.height) }),
      ]),
      element('a:prstGeom', { prst: 'rect' }, [element('a:avLst')]),
      element('a:noFill'),
    ]),
    element('p:txBody', {}, [bodyPr, element('a:lstStyle'), ...paragraphs]),
  ]);
}
