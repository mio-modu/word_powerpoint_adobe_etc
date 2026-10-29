import {
  attr,
  charHeight,
  childElements,
  element,
  firstChild,
  setAttr,
  type CharStyle,
  type ParagraphStyle,
  type XmlElement,
} from '@jamo/core';
import { charStyleFrom, paragraphStyleFrom, readStyleTables } from './styles.js';

/**
 * HWPX 서식 바꾸기.
 *
 * HWPX 는 서식을 본문에 쓰지 않고 header.xml 의 표를 번호로 가리킨다.
 * 따라서 "이 글자를 굵게"는 다음 절차가 된다:
 *   1. 지금 가리키는 charPr 의 서식을 읽는다
 *   2. 거기에 바꿀 내용을 덮는다
 *   3. 그 서식과 똑같은 charPr 이 이미 있으면 그 번호를, 없으면 새로 만들어
 *      그 번호를 run 에 꽂는다
 *
 * 3번의 "이미 있으면 재사용"이 없으면 굵게를 누를 때마다 charPr 이 하나씩
 * 늘어나 파일이 금세 비대해진다.
 */

const LANG_ATTRS = ['hangul', 'latin', 'hanja', 'japanese', 'other', 'symbol', 'user'] as const;

const ALIGN_TO_HWP: Record<string, string> = {
  left: 'LEFT',
  center: 'CENTER',
  right: 'RIGHT',
  justify: 'JUSTIFY',
  distribute: 'DISTRIBUTE',
};

/** 비교용으로 서식을 평평하게 만든다. 거짓/빈 값은 뺀다. */
function normalize(style: CharStyle | ParagraphStyle | undefined): string {
  if (!style) return '{}';
  const entries = Object.entries(style)
    .filter(([key, value]) => {
      if (value === undefined || value === false || value === '') return false;
      // 스타일 이름은 HWPX 서식에 영향을 주지 않는다.
      return key !== 'styleName';
    })
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(entries);
}

function refList(header: XmlElement): XmlElement {
  const found = firstChild(header, 'hh:refList');
  if (!found) throw new Error('header.xml 에 hh:refList 가 없습니다');
  return found;
}

/** 글꼴을 등록하고 ID 를 돌려준다. 이미 있으면 그 ID. */
export function findOrCreateFont(header: XmlElement, face: string): string {
  const fontfaces = firstChild(refList(header), 'hh:fontfaces');
  if (!fontfaces) throw new Error('header.xml 에 hh:fontfaces 가 없습니다');
  const groups = childElements(fontfaces, 'hh:fontface');
  const hangul = groups.find((g) => attr(g, 'lang') === 'HANGUL') ?? groups[0];
  if (!hangul) throw new Error('글꼴 목록이 비어 있습니다');

  const existing = childElements(hangul, 'hh:font').find((f) => attr(f, 'face') === face);
  if (existing) return attr(existing, 'id') ?? '0';

  const ids = childElements(hangul, 'hh:font').map((f) =>
    Number.parseInt(attr(f, 'id') ?? '0', 10),
  );
  const id = String(Math.max(-1, ...ids) + 1);

  for (const group of groups) {
    group.children.push(
      element('hh:font', { id, face, type: 'TTF', isEmbedded: 0 }, [
        element('hh:typeInfo', {
          familyType: 'FCAT_GOTHIC',
          weight: 8,
          proportion: 4,
          contrast: 0,
          strokeVariation: 1,
          armStyle: 1,
          letterform: 1,
          midline: 1,
          xHeight: 1,
        }),
      ]),
    );
    group.selfClosed = false;
    setAttr(group, 'fontCnt', String(childElements(group, 'hh:font').length));
  }
  return id;
}

/** charPr 요소에 서식을 적용한다. */
function applyCharStyle(header: XmlElement, charPr: XmlElement, style: CharStyle): void {
  if (style.fontSize !== undefined) {
    setAttr(charPr, 'height', String(charHeight.fromPoint(style.fontSize)));
  }
  setAttr(charPr, 'textColor', (style.color ?? '#000000').toUpperCase());
  setAttr(charPr, 'shadeColor', style.highlight ? style.highlight.toUpperCase() : 'none');

  if (style.fontFamily) {
    const fontId = findOrCreateFont(header, style.fontFamily);
    const fontRef = firstChild(charPr, 'hh:fontRef');
    if (fontRef) for (const lang of LANG_ATTRS) setAttr(fontRef, lang, fontId);
  }

  const underline = firstChild(charPr, 'hh:underline');
  if (underline) setAttr(underline, 'type', style.underline ? 'BOTTOM' : 'NONE');
  const strikeout = firstChild(charPr, 'hh:strikeout');
  if (strikeout) setAttr(strikeout, 'shape', style.strikeout ? 'SOLID' : 'NONE');

  // 존재로 표현되는 속성들은 전부 걷어낸 뒤 필요한 것만 다시 넣는다.
  for (const name of ['hh:bold', 'hh:italic', 'hh:supscript', 'hh:subscript']) {
    const el = firstChild(charPr, name);
    if (el) charPr.children.splice(charPr.children.indexOf(el), 1);
  }
  const toggles: XmlElement[] = [];
  if (style.bold) toggles.push(element('hh:bold'));
  if (style.italic) toggles.push(element('hh:italic'));
  if (style.superscript) toggles.push(element('hh:supscript'));
  else if (style.subscript) toggles.push(element('hh:subscript'));
  if (toggles.length > 0) {
    // 스키마 순서상 bold/italic 은 underline 앞에 온다.
    const anchor = firstChild(charPr, 'hh:underline');
    const at = anchor ? charPr.children.indexOf(anchor) : charPr.children.length;
    charPr.children.splice(at, 0, ...toggles);
  }
}

/**
 * 원하는 서식의 charPr 번호를 돌려준다. 없으면 만든다.
 *
 * `baseId` 는 현재 가리키고 있는 charPr. 거기서 복제해 바꾸므로, 우리가
 * 해석하지 못하는 속성(그림자, 외곽선 등)도 그대로 따라간다.
 */
export function findOrCreateCharPr(
  header: XmlElement,
  baseId: string | undefined,
  patch: Partial<CharStyle>,
): string {
  const tables = readStyleTables(header);
  const current = charStyleFrom(tables, baseId) ?? {};
  const merged: CharStyle = { ...current, ...patch };
  const wanted = normalize(merged);

  for (const [id] of tables.charPr) {
    if (normalize(charStyleFrom(tables, id)) === wanted) return id;
  }

  const charProperties = firstChild(refList(header), 'hh:charProperties');
  if (!charProperties) throw new Error('header.xml 에 hh:charProperties 가 없습니다');
  const base = (baseId !== undefined && tables.charPr.get(baseId)) ||
    childElements(charProperties, 'hh:charPr')[0];
  if (!base) throw new Error('기준이 될 charPr 이 없습니다');

  const clone = structuredClone(base);
  const ids = childElements(charProperties, 'hh:charPr').map((cp) =>
    Number.parseInt(attr(cp, 'id') ?? '0', 10),
  );
  const id = String(Math.max(-1, ...ids) + 1);
  setAttr(clone, 'id', id);
  applyCharStyle(header, clone, merged);

  charProperties.children.push(clone);
  charProperties.selfClosed = false;
  setAttr(
    charProperties,
    'itemCnt',
    String(childElements(charProperties, 'hh:charPr').length),
  );
  return id;
}

function applyParagraphStyle(paraPr: XmlElement, style: ParagraphStyle): void {
  if (style.align) {
    const align = firstChild(paraPr, 'hh:align');
    if (align) setAttr(align, 'horizontal', ALIGN_TO_HWP[style.align] ?? 'JUSTIFY');
  }
  const holder = firstChild(paraPr, 'hp:switch') ?? paraPr;
  const target = firstChild(holder, 'hp:case') ?? firstChild(holder, 'hp:default') ?? paraPr;
  const margin = firstChild(target, 'hh:margin') ?? firstChild(paraPr, 'hh:margin');
  if (margin) {
    const set = (name: string, value: number | undefined): void => {
      if (value === undefined) return;
      const child = firstChild(margin, name);
      if (child) setAttr(child, 'value', String(Math.round(value)));
    };
    set('hc:left', style.indentLeft);
    set('hc:right', style.indentRight);
    set('hc:intent', style.indentFirstLine);
    set('hc:prev', style.spaceBefore);
    set('hc:next', style.spaceAfter);
  }
  if (style.lineHeight) {
    const ls = firstChild(target, 'hh:lineSpacing') ?? firstChild(paraPr, 'hh:lineSpacing');
    if (ls) {
      setAttr(ls, 'type', style.lineHeight.type === 'percent' ? 'PERCENT' : 'AT_LEAST');
      setAttr(ls, 'value', String(Math.round(style.lineHeight.value)));
    }
  }
  if (style.outlineLevel !== undefined) {
    const heading = firstChild(paraPr, 'hh:heading');
    if (heading) {
      setAttr(heading, 'type', style.outlineLevel > 0 ? 'OUTLINE' : 'NONE');
      setAttr(heading, 'level', String(Math.max(0, Math.min(style.outlineLevel - 1, 6))));
    }
  }
}

export function findOrCreateParaPr(
  header: XmlElement,
  baseId: string | undefined,
  patch: Partial<ParagraphStyle>,
): string {
  const tables = readStyleTables(header);
  const current = paragraphStyleFrom(tables, baseId, undefined) ?? {};
  const merged: ParagraphStyle = { ...current, ...patch };
  const wanted = normalize(merged);

  for (const [id] of tables.paraPr) {
    if (normalize(paragraphStyleFrom(tables, id, undefined)) === wanted) return id;
  }

  const paraProperties = firstChild(refList(header), 'hh:paraProperties');
  if (!paraProperties) throw new Error('header.xml 에 hh:paraProperties 가 없습니다');
  const base = (baseId !== undefined && tables.paraPr.get(baseId)) ||
    childElements(paraProperties, 'hh:paraPr')[0];
  if (!base) throw new Error('기준이 될 paraPr 이 없습니다');

  const clone = structuredClone(base);
  const ids = childElements(paraProperties, 'hh:paraPr').map((pp) =>
    Number.parseInt(attr(pp, 'id') ?? '0', 10),
  );
  const id = String(Math.max(-1, ...ids) + 1);
  setAttr(clone, 'id', id);
  applyParagraphStyle(clone, merged);

  paraProperties.children.push(clone);
  paraProperties.selfClosed = false;
  setAttr(
    paraProperties,
    'itemCnt',
    String(childElements(paraProperties, 'hh:paraPr').length),
  );
  return id;
}
