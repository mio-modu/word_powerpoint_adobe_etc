import {
  attr,
  childElements,
  element,
  charHeight,
  firstChild,
  setAttr,
  setTextContent,
  type CharStyle,
  type JamoTextDocument,
  type ParagraphStyle,
  type XmlElement,
} from '@jamo/core';

/**
 * 중립 모델 → HWPX.
 *
 * HWPX 는 서식을 본문에 직접 쓰지 않고 header.xml 의 표를 번호로 가리킨다.
 * 따라서 변환은 두 단계다:
 *  1. 모델에 등장하는 서로 다른 서식을 모아 charPr/paraPr 표를 만든다
 *  2. 본문 문단이 그 번호를 가리키게 한다
 *
 * 같은 서식이 여러 번 나오면 표를 재사용한다. 그러지 않으면 문단마다
 * charPr 이 하나씩 생겨 파일이 금방 비대해진다.
 */

const LANG_ATTRS = ['hangul', 'latin', 'hanja', 'japanese', 'other', 'symbol', 'user'] as const;

const ALIGN_TO_HWP: Record<string, string> = {
  left: 'LEFT',
  center: 'CENTER',
  right: 'RIGHT',
  justify: 'JUSTIFY',
  distribute: 'DISTRIBUTE',
};

export class StyleRegistry {
  private readonly fontIds = new Map<string, string>();
  private readonly charPrIds = new Map<string, string>();
  private readonly paraPrIds = new Map<string, string>();

  constructor(
    private readonly fontfaces: XmlElement,
    private readonly charProperties: XmlElement,
    private readonly paraProperties: XmlElement,
  ) {
    // 빈 문서가 이미 갖고 있는 항목을 등록해 재사용한다.
    const hangul = childElements(fontfaces, 'hh:fontface').find(
      (ff) => attr(ff, 'lang') === 'HANGUL',
    );
    if (hangul) {
      for (const font of childElements(hangul, 'hh:font')) {
        const face = attr(font, 'face');
        const id = attr(font, 'id');
        if (face && id) this.fontIds.set(face, id);
      }
    }
  }

  /** 글꼴을 등록하고 ID 를 돌려준다. 모든 언어 그룹에 같은 ID 로 추가한다. */
  fontId(face: string): string {
    const existing = this.fontIds.get(face);
    if (existing !== undefined) return existing;

    const groups = childElements(this.fontfaces, 'hh:fontface');
    const used = new Set(this.fontIds.values());
    let next = 0;
    while (used.has(String(next))) next += 1;
    const id = String(next);

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
    setAttr(this.fontfaces, 'itemCnt', String(groups.length));
    this.fontIds.set(face, id);
    return id;
  }

  charPrId(style: CharStyle | undefined): string {
    const key = JSON.stringify(normalizeChar(style));
    const existing = this.charPrIds.get(key);
    if (existing !== undefined) return existing;

    const template = childElements(this.charProperties, 'hh:charPr')[0];
    if (!template) throw new Error('기준이 될 charPr 이 없습니다');

    // 서식이 비어 있으면 기본 charPr(0번)을 그대로 쓴다.
    if (style === undefined || Object.keys(normalizeChar(style)).length === 0) {
      const id = attr(template, 'id') ?? '0';
      this.charPrIds.set(key, id);
      return id;
    }

    const el = structuredClone(template);
    const id = String(childElements(this.charProperties, 'hh:charPr').length);
    setAttr(el, 'id', id);

    if (style.fontSize !== undefined) {
      setAttr(el, 'height', String(charHeight.fromPoint(style.fontSize)));
    }
    if (style.color) setAttr(el, 'textColor', style.color.toUpperCase());
    if (style.highlight) setAttr(el, 'shadeColor', style.highlight.toUpperCase());

    if (style.fontFamily) {
      const fontId = this.fontId(style.fontFamily);
      const fontRef = firstChild(el, 'hh:fontRef');
      if (fontRef) for (const lang of LANG_ATTRS) setAttr(fontRef, lang, fontId);
    }

    // bold/italic 등은 "요소의 존재"로 표현된다. 순서는 스키마가 정한다:
    // bold, italic, underline, strikeout, outline, shadow …
    const underline = firstChild(el, 'hh:underline');
    if (style.underline && underline) setAttr(underline, 'type', 'BOTTOM');
    const strikeout = firstChild(el, 'hh:strikeout');
    if (style.strikeout && strikeout) setAttr(strikeout, 'shape', 'SOLID');

    const toggles: XmlElement[] = [];
    if (style.bold) toggles.push(element('hh:bold'));
    if (style.italic) toggles.push(element('hh:italic'));
    if (style.superscript) toggles.push(element('hh:supscript'));
    else if (style.subscript) toggles.push(element('hh:subscript'));
    if (toggles.length > 0) {
      const anchor = firstChild(el, 'hh:underline');
      const at = anchor ? el.children.indexOf(anchor) : el.children.length;
      el.children.splice(at, 0, ...toggles);
    }

    this.charProperties.children.push(el);
    this.charProperties.selfClosed = false;
    setAttr(
      this.charProperties,
      'itemCnt',
      String(childElements(this.charProperties, 'hh:charPr').length),
    );
    this.charPrIds.set(key, id);
    return id;
  }

  paraPrId(style: ParagraphStyle | undefined): string {
    const key = JSON.stringify(normalizePara(style));
    const existing = this.paraPrIds.get(key);
    if (existing !== undefined) return existing;

    const template = childElements(this.paraProperties, 'hh:paraPr')[0];
    if (!template) throw new Error('기준이 될 paraPr 이 없습니다');

    if (style === undefined || Object.keys(normalizePara(style)).length === 0) {
      const id = attr(template, 'id') ?? '0';
      this.paraPrIds.set(key, id);
      return id;
    }

    const el = structuredClone(template);
    const id = String(childElements(this.paraProperties, 'hh:paraPr').length);
    setAttr(el, 'id', id);

    if (style.align) {
      const align = firstChild(el, 'hh:align');
      if (align) setAttr(align, 'horizontal', ALIGN_TO_HWP[style.align] ?? 'JUSTIFY');
    }
    const margin = firstChild(el, 'hh:margin');
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
      const ls = firstChild(el, 'hh:lineSpacing');
      if (ls) {
        setAttr(ls, 'type', style.lineHeight.type === 'percent' ? 'PERCENT' : 'AT_LEAST');
        setAttr(ls, 'value', String(Math.round(style.lineHeight.value)));
      }
    }
    if (style.outlineLevel !== undefined && style.outlineLevel > 0) {
      const heading = firstChild(el, 'hh:heading');
      if (heading) {
        setAttr(heading, 'type', 'OUTLINE');
        setAttr(heading, 'level', String(Math.min(style.outlineLevel - 1, 6)));
      }
    }

    this.paraProperties.children.push(el);
    this.paraProperties.selfClosed = false;
    setAttr(
      this.paraProperties,
      'itemCnt',
      String(childElements(this.paraProperties, 'hh:paraPr').length),
    );
    this.paraPrIds.set(key, id);
    return id;
  }
}

function normalizeChar(style: CharStyle | undefined): Record<string, unknown> {
  if (!style) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(style)) {
    if (v === undefined || v === false || v === '') continue;
    out[k] = v;
  }
  return out;
}

function normalizePara(style: ParagraphStyle | undefined): Record<string, unknown> {
  if (!style) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(style)) {
    if (v === undefined || v === false || v === '') continue;
    // 스타일 이름만으로는 HWPX 서식이 달라지지 않는다. 키에서 제외해
    // 불필요한 paraPr 증식을 막는다.
    if (k === 'styleName') continue;
    if (k === 'indentLeft' || k === 'indentRight' || k === 'indentFirstLine') {
      if (v === 0) continue;
    }
    if ((k === 'spaceBefore' || k === 'spaceAfter') && v === 0) continue;
    out[k] = v;
  }
  return out;
}

export interface SectionBuildTarget {
  sectionRoot: XmlElement;
  registry: StyleRegistry;
}

/**
 * 섹션 본문을 모델의 문단으로 채운다.
 *
 * 첫 문단의 첫 런에는 `hp:secPr`(용지 설정)이 들어 있어 그대로 지워서는
 * 안 된다. 첫 문단은 재활용하고 내용만 교체한다.
 */
export function fillSection(
  target: SectionBuildTarget,
  paragraphs: JamoTextDocument['sections'][number]['paragraphs'],
): void {
  const { sectionRoot, registry } = target;
  const existing = childElements(sectionRoot, 'hp:p');
  const first = existing[0];
  if (!first) throw new Error('섹션에 문단이 없습니다');

  // 첫 문단만 남기고 비운다.
  for (const p of existing.slice(1)) {
    sectionRoot.children.splice(sectionRoot.children.indexOf(p), 1);
  }

  const firstRun = childElements(first, 'hp:run')[0];
  const secPr = firstRun && firstChild(firstRun, 'hp:secPr');
  const ctrl = firstRun && firstChild(firstRun, 'hp:ctrl');
  const lineSegArray = firstChild(first, 'hp:linesegarray');

  const model = paragraphs.length > 0 ? paragraphs : [{ runs: [{ text: '' }] }];

  model.forEach((para, index) => {
    const paraPrId = registry.paraPrId(para.style);
    const runs = para.runs.length > 0 ? para.runs : [{ text: '' }];

    if (index === 0) {
      setAttr(first, 'paraPrIDRef', paraPrId);
      setAttr(first, 'id', '0');
      // secPr/ctrl 을 품은 런은 유지하고, 그 안의 텍스트만 바꾼다.
      const keep: XmlElement[] = [];
      if (secPr) keep.push(secPr);
      if (ctrl) keep.push(ctrl);
      const head = element('hp:run', { charPrIDRef: registry.charPrId(runs[0]!.style) }, [
        ...keep,
        textElement(runs[0]!.text),
      ]);
      const rest = runs
        .slice(1)
        .map((r) =>
          element('hp:run', { charPrIDRef: registry.charPrId(r.style) }, [textElement(r.text)]),
        );
      first.children = [head, ...rest];
      if (lineSegArray) first.children.push(lineSegArray);
      first.selfClosed = false;
      return;
    }

    const p = element(
      'hp:p',
      {
        id: String(index),
        paraPrIDRef: paraPrId,
        styleIDRef: '0',
        pageBreak: 0,
        columnBreak: 0,
        merged: 0,
      },
      runs.map((r) =>
        element('hp:run', { charPrIDRef: registry.charPrId(r.style) }, [textElement(r.text)]),
      ),
    );
    if (lineSegArray) p.children.push(structuredClone(lineSegArray));
    sectionRoot.children.push(p);
  });
}

function textElement(text: string): XmlElement {
  const el = element('hp:t');
  if (text !== '') setTextContent(el, text);
  return el;
}
