import {
  attr,
  childElements,
  element,
  firstChild,
  halfPoint,
  setAttr,
  setTextContent,
  textContent,
  twip,
  type CharStyle,
  type HorizontalAlign,
  type ParagraphStyle,
  type XmlElement,
} from '@jamo/core';

export const W_NS = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  xml: 'http://www.w3.org/XML/1998/namespace',
} as const;

/**
 * WordprocessingML 의 on/off 속성.
 *
 * `<w:b/>` 는 "굵게", `<w:b w:val="0"/>` 는 "굵게 해제"다. 요소의 존재만
 * 보고 판단하면 해제를 굵게로 읽는 흔한 버그가 생긴다.
 */
export function onOff(el: XmlElement | undefined): boolean | undefined {
  if (!el) return undefined;
  const val = attr(el, 'w:val');
  if (val === undefined) return true;
  return val === '1' || val === 'true' || val === 'on';
}

export function wVal(parent: XmlElement, name: string): string | undefined {
  const el = firstChild(parent, name);
  return el ? attr(el, 'w:val') : undefined;
}

function wValInt(parent: XmlElement, name: string): number | undefined {
  const raw = wVal(parent, name);
  if (raw === undefined) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

const ALIGN_FROM_WORD: Record<string, HorizontalAlign> = {
  left: 'left',
  start: 'left',
  center: 'center',
  right: 'right',
  end: 'right',
  both: 'justify',
  justify: 'justify',
  distribute: 'distribute',
};

const ALIGN_TO_WORD: Record<HorizontalAlign, string> = {
  left: 'left',
  center: 'center',
  right: 'right',
  justify: 'both',
  distribute: 'distribute',
};

// ------------------------------------------------------------------ 읽기

export function readCharStyle(run: XmlElement): CharStyle | undefined {
  const rPr = firstChild(run, 'w:rPr');
  if (!rPr) return undefined;
  const style: CharStyle = {};

  const fonts = firstChild(rPr, 'w:rFonts');
  if (fonts) {
    // 한글 문서는 eastAsia 가 실제로 보이는 글꼴이다.
    const face = attr(fonts, 'w:eastAsia') ?? attr(fonts, 'w:ascii') ?? attr(fonts, 'w:hAnsi');
    if (face) style.fontFamily = face;
  }

  const sz = wValInt(rPr, 'w:sz');
  if (sz !== undefined) style.fontSize = halfPoint.toPoint(sz);

  const bold = onOff(firstChild(rPr, 'w:b'));
  if (bold !== undefined) style.bold = bold;
  const italic = onOff(firstChild(rPr, 'w:i'));
  if (italic !== undefined) style.italic = italic;
  const strike = onOff(firstChild(rPr, 'w:strike'));
  if (strike !== undefined) style.strikeout = strike;

  const u = wVal(rPr, 'w:u');
  if (u !== undefined) style.underline = u !== 'none';

  const color = wVal(rPr, 'w:color');
  if (color && color !== 'auto') style.color = `#${color.replace(/^#/, '')}`;

  const highlight = wVal(rPr, 'w:highlight');
  if (highlight && highlight !== 'none') style.highlight = highlight;

  const vertAlign = wVal(rPr, 'w:vertAlign');
  if (vertAlign === 'superscript') style.superscript = true;
  if (vertAlign === 'subscript') style.subscript = true;

  return Object.keys(style).length > 0 ? style : undefined;
}

export function readParagraphStyle(p: XmlElement): ParagraphStyle | undefined {
  const pPr = firstChild(p, 'w:pPr');
  if (!pPr) return undefined;
  const style: ParagraphStyle = {};

  const pStyle = wVal(pPr, 'w:pStyle');
  if (pStyle) style.styleName = pStyle;

  const jc = wVal(pPr, 'w:jc');
  if (jc && ALIGN_FROM_WORD[jc]) style.align = ALIGN_FROM_WORD[jc];

  const ind = firstChild(pPr, 'w:ind');
  if (ind) {
    const left = intAttr(ind, 'w:left') ?? intAttr(ind, 'w:start');
    const right = intAttr(ind, 'w:right') ?? intAttr(ind, 'w:end');
    const firstLine = intAttr(ind, 'w:firstLine');
    const hanging = intAttr(ind, 'w:hanging');
    if (left !== undefined) style.indentLeft = fromTwip(left);
    if (right !== undefined) style.indentRight = fromTwip(right);
    if (hanging !== undefined) style.indentFirstLine = -fromTwip(hanging);
    else if (firstLine !== undefined) style.indentFirstLine = fromTwip(firstLine);
  }

  const spacing = firstChild(pPr, 'w:spacing');
  if (spacing) {
    const before = intAttr(spacing, 'w:before');
    const after = intAttr(spacing, 'w:after');
    const line = intAttr(spacing, 'w:line');
    const lineRule = attr(spacing, 'w:lineRule');
    if (before !== undefined) style.spaceBefore = fromTwip(before);
    if (after !== undefined) style.spaceAfter = fromTwip(after);
    if (line !== undefined) {
      // auto 이면 line/240 이 배수. 그 밖에는 절대 길이(twip).
      style.lineHeight =
        lineRule === undefined || lineRule === 'auto'
          ? { type: 'percent', value: Math.round((line / 240) * 100) }
          : { type: 'hwpunit', value: fromTwip(line) };
    }
  }

  const outlineLvl = wValInt(pPr, 'w:outlineLvl');
  if (outlineLvl !== undefined) style.outlineLevel = outlineLvl + 1;

  const numPr = firstChild(pPr, 'w:numPr');
  if (numPr) style.listLevel = (wValInt(numPr, 'w:ilvl') ?? 0) + 1;

  return Object.keys(style).length > 0 ? style : undefined;
}

function intAttr(el: XmlElement, name: string): number | undefined {
  const raw = attr(el, name);
  if (raw === undefined) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

function fromTwip(v: number): number {
  // twip → HWPUNIT (중립 모델의 기준 단위)
  return Math.round(v * 5);
}

function toTwip(hwpunitValue: number): number {
  return Math.round(hwpunitValue / 5);
}

// ------------------------------------------------------------------ 쓰기

/** `w:rPr` 를 만든다. 빈 서식이면 undefined. */
export function buildRunProps(style: CharStyle | undefined): XmlElement | undefined {
  if (!style) return undefined;
  const kids: XmlElement[] = [];
  if (style.fontFamily) {
    kids.push(
      element('w:rFonts', {
        'w:ascii': style.fontFamily,
        'w:eastAsia': style.fontFamily,
        'w:hAnsi': style.fontFamily,
        'w:cs': style.fontFamily,
      }),
    );
  }
  if (style.bold) kids.push(element('w:b'), element('w:bCs'));
  if (style.italic) kids.push(element('w:i'), element('w:iCs'));
  if (style.strikeout) kids.push(element('w:strike'));
  if (style.underline) kids.push(element('w:u', { 'w:val': 'single' }));
  if (style.color) kids.push(element('w:color', { 'w:val': style.color.replace(/^#/, '') }));
  if (style.highlight) kids.push(element('w:highlight', { 'w:val': style.highlight.replace(/^#/, '') }));
  if (style.fontSize !== undefined) {
    const half = String(halfPoint.fromPoint(style.fontSize));
    kids.push(element('w:sz', { 'w:val': half }), element('w:szCs', { 'w:val': half }));
  }
  if (style.superscript) kids.push(element('w:vertAlign', { 'w:val': 'superscript' }));
  else if (style.subscript) kids.push(element('w:vertAlign', { 'w:val': 'subscript' }));
  return kids.length > 0 ? element('w:rPr', {}, kids) : undefined;
}

export function buildParagraphProps(style: ParagraphStyle | undefined): XmlElement | undefined {
  if (!style) return undefined;
  const kids: XmlElement[] = [];
  // w:pPr 의 자식 순서는 스키마로 정해져 있다. pStyle 이 가장 앞.
  if (style.styleName) kids.push(element('w:pStyle', { 'w:val': style.styleName }));
  if (style.listLevel !== undefined && style.listLevel > 0) {
    kids.push(
      element('w:numPr', {}, [
        element('w:ilvl', { 'w:val': String(style.listLevel - 1) }),
        element('w:numId', { 'w:val': '1' }),
      ]),
    );
  }
  if (style.spaceBefore !== undefined || style.spaceAfter !== undefined || style.lineHeight) {
    const attrs: Record<string, string> = {};
    if (style.spaceBefore !== undefined) attrs['w:before'] = String(toTwip(style.spaceBefore));
    if (style.spaceAfter !== undefined) attrs['w:after'] = String(toTwip(style.spaceAfter));
    if (style.lineHeight) {
      if (style.lineHeight.type === 'percent') {
        attrs['w:line'] = String(Math.round((style.lineHeight.value / 100) * 240));
        attrs['w:lineRule'] = 'auto';
      } else {
        attrs['w:line'] = String(toTwip(style.lineHeight.value));
        attrs['w:lineRule'] = 'exact';
      }
    }
    kids.push(element('w:spacing', attrs));
  }
  if (
    style.indentLeft !== undefined ||
    style.indentRight !== undefined ||
    style.indentFirstLine !== undefined
  ) {
    const attrs: Record<string, string> = {};
    if (style.indentLeft !== undefined) attrs['w:left'] = String(toTwip(style.indentLeft));
    if (style.indentRight !== undefined) attrs['w:right'] = String(toTwip(style.indentRight));
    if (style.indentFirstLine !== undefined) {
      if (style.indentFirstLine < 0) attrs['w:hanging'] = String(toTwip(-style.indentFirstLine));
      else attrs['w:firstLine'] = String(toTwip(style.indentFirstLine));
    }
    kids.push(element('w:ind', attrs));
  }
  if (style.align) kids.push(element('w:jc', { 'w:val': ALIGN_TO_WORD[style.align] }));
  if (style.outlineLevel !== undefined && style.outlineLevel > 0) {
    kids.push(element('w:outlineLvl', { 'w:val': String(style.outlineLevel - 1) }));
  }
  return kids.length > 0 ? element('w:pPr', {}, kids) : undefined;
}

/**
 * `w:t` 를 만든다.
 *
 * 앞뒤 공백이 있으면 `xml:space="preserve"` 가 **반드시** 있어야 한다.
 * 없으면 Word 가 공백을 지워버려서 들여쓴 문장이 붙어버린다.
 */
export function buildText(value: string): XmlElement {
  const needsPreserve = /^\s|\s$/.test(value);
  const el = element('w:t', needsPreserve ? { 'xml:space': 'preserve' } : {});
  setTextContent(el, value);
  return el;
}

export function buildRun(text: string, style?: CharStyle): XmlElement {
  const kids: XmlElement[] = [];
  const rPr = buildRunProps(style);
  if (rPr) kids.push(rPr);
  // 줄바꿈과 탭은 전용 요소로 쪼갠다. 그냥 넣으면 Word 가 공백으로 본다.
  const pieces = text.split(/(\n|\t)/);
  for (const piece of pieces) {
    if (piece === '') continue;
    if (piece === '\n') kids.push(element('w:br'));
    else if (piece === '\t') kids.push(element('w:tab'));
    else kids.push(buildText(piece));
  }
  if (kids.length === (rPr ? 1 : 0)) kids.push(buildText(''));
  return element('w:r', {}, kids);
}

export function buildParagraph(
  runs: Array<{ text: string; style?: CharStyle }>,
  paraStyle?: ParagraphStyle,
): XmlElement {
  const kids: XmlElement[] = [];
  const pPr = buildParagraphProps(paraStyle);
  if (pPr) kids.push(pPr);
  for (const r of runs) kids.push(buildRun(r.text, r.style));
  return element('w:p', {}, kids);
}

/** 문단의 평문. 탭·줄바꿈을 실제 문자로 되살린다. */
export function paragraphText(p: XmlElement): string {
  let out = '';
  const walk = (el: XmlElement): void => {
    for (const child of el.children) {
      if (child.kind !== 'element') continue;
      switch (child.name) {
        case 'w:t':
          out += textContent(child);
          break;
        case 'w:tab':
          out += '\t';
          break;
        case 'w:br':
        case 'w:cr':
          out += '\n';
          break;
        case 'w:rPr':
        case 'w:pPr':
          break;
        default:
          walk(child);
      }
    }
  };
  walk(p);
  return out;
}

/** 문단의 런 목록 (하이퍼링크 안의 런까지 포함). */
export function paragraphRuns(p: XmlElement): XmlElement[] {
  const out: XmlElement[] = [];
  const walk = (el: XmlElement): void => {
    for (const child of el.children) {
      if (child.kind !== 'element') continue;
      if (child.name === 'w:r') out.push(child);
      else if (child.name !== 'w:pPr') walk(child);
    }
  };
  walk(p);
  return out;
}

/** 런의 텍스트만 교체한다. 서식(w:rPr)은 그대로. */
export function setRunText(run: XmlElement, text: string): void {
  const rPr = firstChild(run, 'w:rPr');
  run.children = rPr ? [rPr] : [];
  const pieces = text.split(/(\n|\t)/);
  for (const piece of pieces) {
    if (piece === '') continue;
    if (piece === '\n') run.children.push(element('w:br'));
    else if (piece === '\t') run.children.push(element('w:tab'));
    else run.children.push(buildText(piece));
  }
  if (run.children.length === (rPr ? 1 : 0)) run.children.push(buildText(''));
  run.selfClosed = false;
}

/** 문단 전체 텍스트를 첫 런의 서식으로 통일해 바꾼다. */
export function setParagraphText(p: XmlElement, text: string): void {
  const runs = paragraphRuns(p);
  if (runs.length === 0) {
    const pPr = firstChild(p, 'w:pPr');
    p.children = pPr ? [pPr, buildRun(text)] : [buildRun(text)];
    p.selfClosed = false;
    return;
  }
  setRunText(runs[0]!, text);
  for (const run of runs.slice(1)) {
    const parent = findParent(p, run);
    if (parent) parent.children.splice(parent.children.indexOf(run), 1);
  }
}

function findParent(root: XmlElement, target: XmlElement): XmlElement | undefined {
  if (root.children.includes(target)) return root;
  for (const child of root.children) {
    if (child.kind !== 'element') continue;
    const hit = findParent(child, target);
    if (hit) return hit;
  }
  return undefined;
}

/** `w:pStyle` 을 지정/변경한다. */
export function setParagraphStyleName(p: XmlElement, styleId: string): void {
  let pPr = firstChild(p, 'w:pPr');
  if (!pPr) {
    pPr = element('w:pPr');
    p.children.unshift(pPr);
    p.selfClosed = false;
  }
  const existing = firstChild(pPr, 'w:pStyle');
  if (existing) setAttr(existing, 'w:val', styleId);
  else {
    pPr.children.unshift(element('w:pStyle', { 'w:val': styleId }));
    pPr.selfClosed = false;
  }
}

export function bodyParagraphs(body: XmlElement): XmlElement[] {
  return childElements(body, 'w:p');
}


// ------------------------------------------------------------------ 서식 바꾸기

/**
 * 런의 글자 서식을 바꾼다.
 *
 * DOCX 는 서식을 런 안에 직접 쓰므로 HWPX 처럼 표를 거칠 필요가 없다.
 * 다만 `w:rPr` 자식의 순서가 스키마로 정해져 있어, 아무 데나 끼워 넣으면
 * Word 가 거부한다. 그래서 바꿀 때마다 정해진 순서로 다시 쌓는다.
 */
const RPR_ORDER = [
  'w:rStyle',
  'w:rFonts',
  'w:b',
  'w:bCs',
  'w:i',
  'w:iCs',
  'w:caps',
  'w:smallCaps',
  'w:strike',
  'w:dstrike',
  'w:outline',
  'w:shadow',
  'w:color',
  'w:spacing',
  'w:w',
  'w:kern',
  'w:position',
  'w:sz',
  'w:szCs',
  'w:highlight',
  'w:u',
  'w:effect',
  'w:bdr',
  'w:shd',
  'w:vertAlign',
  'w:rtl',
  'w:lang',
];

/**
 * on/off 속성을 "명시적으로 끈다"고 적는다.
 *
 * 그냥 요소를 빼면 문단 스타일에서 물려받은 값이 되살아난다. 제목 스타일이
 * 굵은데 굵게를 해제하면 다시 굵어지는 식이다. `w:val="0"` 으로 적어야
 * 상속을 끊을 수 있다.
 */
const TOGGLE_ELEMENTS: Partial<Record<keyof CharStyle, string[]>> = {
  bold: ['w:b', 'w:bCs'],
  italic: ['w:i', 'w:iCs'],
  strikeout: ['w:strike'],
};

export function setRunStyle(run: XmlElement, patch: Partial<CharStyle>): void {
  const merged: CharStyle = { ...(readCharStyle(run) ?? {}), ...patch };
  const rPr = firstChild(run, 'w:rPr');

  // 우리가 다루지 않는 속성은 남긴다 (언어 설정, 테두리 등).
  const managed = new Set([
    'w:rFonts', 'w:b', 'w:bCs', 'w:i', 'w:iCs', 'w:strike',
    'w:u', 'w:color', 'w:highlight', 'w:sz', 'w:szCs', 'w:vertAlign',
  ]);
  const kept = rPr ? childElements(rPr).filter((el) => !managed.has(el.name)) : [];

  const built = buildRunProps(merged);
  const fresh = built ? childElements(built) : [];

  // 끄기를 명시한 항목은 빈 요소 대신 w:val="0" 으로 적는다.
  for (const [key, names] of Object.entries(TOGGLE_ELEMENTS)) {
    if (merged[key as keyof CharStyle] !== false) continue;
    for (const name of names ?? []) fresh.push(element(name, { 'w:val': '0' }));
  }
  if (merged.underline === false) fresh.push(element('w:u', { 'w:val': 'none' }));

  const all = [...kept, ...fresh].sort((a, b) => {
    const ia = RPR_ORDER.indexOf(a.name);
    const ib = RPR_ORDER.indexOf(b.name);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });

  if (all.length === 0) {
    if (rPr) run.children.splice(run.children.indexOf(rPr), 1);
    return;
  }
  if (rPr) {
    rPr.children = all;
    rPr.selfClosed = false;
  } else {
    run.children.unshift(element('w:rPr', {}, all));
    run.selfClosed = false;
  }
}

/** 문단의 모든 런에 같은 글자 서식을 적용한다. */
export function setParagraphRunStyle(p: XmlElement, patch: Partial<CharStyle>): void {
  for (const run of paragraphRuns(p)) setRunStyle(run, patch);
}

/** 문단 서식(정렬·들여쓰기·줄간격)을 바꾼다. */
export function setParagraphFormat(p: XmlElement, patch: Partial<ParagraphStyle>): void {
  const merged: ParagraphStyle = { ...(readParagraphStyle(p) ?? {}), ...patch };
  const existing = firstChild(p, 'w:pPr');
  // pStyle 과 numPr 은 buildParagraphProps 가 merged 에서 다시 만들어 준다.
  const built = buildParagraphProps(merged);
  const kept = existing
    ? childElements(existing).filter(
        (el) => !['w:pStyle', 'w:numPr', 'w:spacing', 'w:ind', 'w:jc', 'w:outlineLvl'].includes(el.name),
      )
    : [];
  const fresh = built ? childElements(built) : [];
  // w:pPr 안에서도 순서가 정해져 있다. pStyle 이 맨 앞, jc 는 ind 뒤.
  const order = ['w:pStyle', 'w:keepNext', 'w:keepLines', 'w:numPr', 'w:spacing', 'w:ind', 'w:jc', 'w:outlineLvl'];
  const all = [...kept, ...fresh].sort((a, b) => {
    const ia = order.indexOf(a.name);
    const ib = order.indexOf(b.name);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });

  if (all.length === 0) {
    if (existing) p.children.splice(p.children.indexOf(existing), 1);
    return;
  }
  if (existing) {
    existing.children = all;
    existing.selfClosed = false;
  } else {
    p.children.unshift(element('w:pPr', {}, all));
    p.selfClosed = false;
  }
}
