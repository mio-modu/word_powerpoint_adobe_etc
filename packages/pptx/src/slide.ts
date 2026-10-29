import {
  attr,
  childElements,
  firstChild,
  hwpunit,
  textContent,
  type CharStyle,
  type JamoFill,
  type JamoParagraph,
  type JamoShape,
  type JamoTable,
  type JamoTableCell,
  type JamoTableRow,
  type ParagraphStyle,
  type XmlElement,
} from '@jamo/core';
import { resolveColorElement, resolveFillColor, type ThemeColors } from './theme.js';

/**
 * 슬라이드 한 장을 화면에 그릴 수 있는 형태로 읽는다.
 *
 * 텍스트만 꺼내는 것과 "보이는 대로 읽는 것" 사이에는 꽤 큰 거리가 있다.
 * PPTX 는 보이는 값을 슬라이드에 다 적어두지 않는다. 제목 글자가 몇 pt 인지,
 * 무슨 색인지는 대개 **레이아웃과 마스터에 적혀 있고 슬라이드는 비워 둔다.**
 * 그래서 다음 사슬을 끝까지 따라가야 실제 모습이 나온다:
 *
 *   런의 rPr → 문단의 defRPr → 도형의 lstStyle
 *   → 레이아웃의 같은 자리표시자 → 마스터의 같은 자리표시자
 *   → 마스터의 txStyles → 테마 글꼴
 *
 * 이 사슬을 건너뛰면 어두운 배경에 흰 글씨인 장표가 흰 배경에 검은 글씨로 나온다.
 */

export interface SlideContext {
  theme: ThemeColors;
  /** 슬라이드의 rId 를 파트 경로로 바꾼다. 그림을 찾는 데 쓴다. */
  resolveRel: (id: string) => string | undefined;
  layoutRoot?: XmlElement;
  masterRoot?: XmlElement;
}

const EMU_PER_PT = 12700;

function intAttr(el: XmlElement | undefined, name: string): number | undefined {
  if (!el) return undefined;
  const raw = attr(el, name);
  if (raw === undefined) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

/** 그룹 안쪽 좌표를 바깥 좌표로 옮기는 변환. */
interface Transform {
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
}

const IDENTITY: Transform = { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 };

function apply(t: Transform, x: number, y: number): { x: number; y: number } {
  return { x: t.offsetX + x * t.scaleX, y: t.offsetY + y * t.scaleY };
}

/**
 * 그룹의 변환을 만든다.
 *
 * 그룹은 "안쪽 좌표계"를 따로 갖는다. `a:chOff`/`a:chExt` 가 안쪽 좌표의
 * 원점과 크기이고, `a:off`/`a:ext` 가 바깥에서의 자리와 크기다. 둘의 비율로
 * 안쪽 도형들을 늘리거나 줄여 놓아야 자리가 맞는다.
 */
function groupTransform(grpSpPr: XmlElement | undefined, parent: Transform): Transform {
  const xfrm = grpSpPr && firstChild(grpSpPr, 'a:xfrm');
  if (!xfrm) return parent;
  const off = firstChild(xfrm, 'a:off');
  const ext = firstChild(xfrm, 'a:ext');
  const chOff = firstChild(xfrm, 'a:chOff');
  const chExt = firstChild(xfrm, 'a:chExt');
  if (!off || !ext || !chOff || !chExt) return parent;

  const cx = intAttr(chExt, 'cx') ?? 1;
  const cy = intAttr(chExt, 'cy') ?? 1;
  const scaleX = cx === 0 ? 1 : (intAttr(ext, 'cx') ?? cx) / cx;
  const scaleY = cy === 0 ? 1 : (intAttr(ext, 'cy') ?? cy) / cy;
  const childX = intAttr(chOff, 'x') ?? 0;
  const childY = intAttr(chOff, 'y') ?? 0;

  const origin = apply(parent, intAttr(off, 'x') ?? 0, intAttr(off, 'y') ?? 0);
  return {
    offsetX: origin.x - childX * scaleX * parent.scaleX,
    offsetY: origin.y - childY * scaleY * parent.scaleY,
    scaleX: scaleX * parent.scaleX,
    scaleY: scaleY * parent.scaleY,
  };
}

function frameOf(
  spPr: XmlElement | undefined,
  transform: Transform,
): JamoShape['frame'] & { rotation?: number; flipH?: boolean; flipV?: boolean } | undefined {
  // 도형은 spPr 안에 a:xfrm 을 두지만, graphicFrame 은 p:xfrm 자체가
  // off/ext 를 들고 있다. 둘 다 받아 준다.
  const xfrm =
    spPr && (firstChild(spPr, 'a:xfrm') ?? (spPr.name.endsWith(':xfrm') ? spPr : undefined));
  if (!xfrm) return undefined;
  const off = firstChild(xfrm, 'a:off');
  const ext = firstChild(xfrm, 'a:ext');
  if (!off || !ext) return undefined;
  const origin = apply(transform, intAttr(off, 'x') ?? 0, intAttr(off, 'y') ?? 0);
  const rot = intAttr(xfrm, 'rot');
  return {
    x: hwpunit.fromEmu(origin.x),
    y: hwpunit.fromEmu(origin.y),
    width: hwpunit.fromEmu((intAttr(ext, 'cx') ?? 0) * transform.scaleX),
    height: hwpunit.fromEmu((intAttr(ext, 'cy') ?? 0) * transform.scaleY),
    // 회전은 1/60000 도 단위로 들어온다.
    rotation: rot === undefined ? undefined : rot / 60000,
    flipH: attr(xfrm, 'flipH') === '1',
    flipV: attr(xfrm, 'flipV') === '1',
  };
}

// ------------------------------------------------------------------ 채우기

/** 채우기 요소를 읽는다. `a:noFill` 이면 'none'. */
export function readFill(
  holder: XmlElement | undefined,
  theme: ThemeColors,
  placeholderColor?: string,
): JamoFill | undefined {
  if (!holder) return undefined;
  if (firstChild(holder, 'a:noFill')) return { type: 'none' };

  const solid = firstChild(holder, 'a:solidFill');
  if (solid) {
    const color = resolveFillColor(solid, theme, placeholderColor);
    if (color) return { type: 'solid', color: color.hex, alpha: color.alpha };
  }

  const grad = firstChild(holder, 'a:gradFill');
  if (grad) {
    const stops = firstChild(grad, 'a:gsLst');
    const list = stops ? childElements(stops, 'a:gs') : [];
    const colors = list
      .map((gs) => resolveFillColor(gs, theme, placeholderColor))
      .filter((c): c is NonNullable<typeof c> => c !== undefined);
    if (colors.length >= 2) {
      const lin = firstChild(grad, 'a:lin');
      const angle = (intAttr(lin, 'ang') ?? 0) / 60000;
      return {
        type: 'gradient',
        color: colors[0]!.hex,
        alpha: colors[0]!.alpha,
        gradient: { from: colors[0]!.hex, to: colors[colors.length - 1]!.hex, angle },
      };
    }
    if (colors.length === 1) return { type: 'solid', color: colors[0]!.hex, alpha: colors[0]!.alpha };
  }

  // 무늬·그림 채우기는 대표 색 하나로 근사한다. 비워 두는 것보다 낫다.
  const patt = firstChild(holder, 'a:pattFill');
  if (patt) {
    const fg = firstChild(patt, 'a:fgClr');
    const color = fg && resolveFillColor(fg, theme, placeholderColor);
    if (color) return { type: 'solid', color: color.hex, alpha: color.alpha };
  }
  return undefined;
}

/**
 * 배경을 읽는다. 슬라이드 → 레이아웃 → 마스터 순으로 찾는다.
 *
 * `p:bgRef` 는 테마의 배경 채우기 목록을 번호로 가리킨다. 1001 이 첫 번째다.
 * 그 채우기 안의 `phClr` 는 bgRef 가 함께 들고 있는 색으로 채워진다.
 */
export function readBackground(
  roots: Array<XmlElement | undefined>,
  theme: ThemeColors,
): JamoFill | undefined {
  for (const root of roots) {
    if (!root) continue;
    const cSld = firstChild(root, 'p:cSld');
    const bg = cSld && firstChild(cSld, 'p:bg');
    if (!bg) continue;

    const bgPr = firstChild(bg, 'p:bgPr');
    if (bgPr) {
      const fill = readFill(bgPr, theme);
      if (fill) return fill;
    }

    const bgRef = firstChild(bg, 'p:bgRef');
    if (bgRef) {
      const placeholder = resolveFillColor(bgRef, theme);
      const idx = intAttr(bgRef, 'idx') ?? 0;
      const style = theme.bgFillStyles[Math.max(0, idx - 1001)];
      if (style) {
        // 스타일 자체가 a:solidFill 같은 채우기 요소다. 감싸서 읽는다.
        const wrapper: XmlElement = {
          kind: 'element',
          name: 'wrapper',
          attrs: [],
          children: [style],
          selfClosed: false,
        };
        const fill = readFill(wrapper, theme, placeholder?.hex);
        if (fill) return fill;
      }
      if (placeholder) return { type: 'solid', color: placeholder.hex, alpha: placeholder.alpha };
    }
  }
  return undefined;
}

// -------------------------------------------------------------- 자리표시자

interface PlaceholderKey {
  type: string;
  idx: string;
}

function placeholderKeyOf(sp: XmlElement): PlaceholderKey | undefined {
  const nvSpPr = firstChild(sp, 'p:nvSpPr') ?? firstChild(sp, 'p:nvGraphicFramePr');
  const nvPr = nvSpPr && firstChild(nvSpPr, 'p:nvPr');
  const ph = nvPr && firstChild(nvPr, 'p:ph');
  if (!ph) return undefined;
  return { type: attr(ph, 'type') ?? 'body', idx: attr(ph, 'idx') ?? '' };
}

/** 레이아웃·마스터에서 같은 자리표시자를 찾는다. */
function findPlaceholder(
  root: XmlElement | undefined,
  key: PlaceholderKey,
): XmlElement | undefined {
  if (!root) return undefined;
  const cSld = firstChild(root, 'p:cSld');
  const spTree = cSld && firstChild(cSld, 'p:spTree');
  if (!spTree) return undefined;

  const candidates = childElements(spTree, 'p:sp');
  // idx 가 같으면 가장 확실하다. 없으면 종류로 맞춘다.
  const byIdx = candidates.find((sp) => {
    const k = placeholderKeyOf(sp);
    return k !== undefined && k.idx !== '' && k.idx === key.idx;
  });
  if (byIdx) return byIdx;
  return candidates.find((sp) => {
    const k = placeholderKeyOf(sp);
    if (!k) return false;
    if (k.type === key.type) return true;
    // 제목 자리는 title 과 ctrTitle 이 서로 통한다.
    const titles = new Set(['title', 'ctrTitle']);
    return titles.has(k.type) && titles.has(key.type);
  });
}

/** 마스터 txStyles 중 어느 묶음을 쓸지. */
function txStyleNameFor(type: string | undefined): string {
  if (type === 'title' || type === 'ctrTitle') return 'p:titleStyle';
  if (type === undefined) return 'p:otherStyle';
  if (type === 'body' || type === 'subTitle' || type === 'obj') return 'p:bodyStyle';
  return 'p:otherStyle';
}

function lvlProps(lstStyle: XmlElement | undefined, level: number): XmlElement | undefined {
  if (!lstStyle) return undefined;
  return firstChild(lstStyle, `a:lvl${level + 1}pPr`);
}

/**
 * 한 런에 실제로 적용되는 글자 속성을 사슬 끝까지 따라가 모은다.
 * 앞쪽이 우선이다.
 */
function effectiveRunProps(
  run: XmlElement | undefined,
  paragraph: XmlElement,
  shape: XmlElement,
  level: number,
  ctx: SlideContext,
): XmlElement[] {
  const chain: Array<XmlElement | undefined> = [];
  if (run) chain.push(firstChild(run, 'a:rPr'));

  const pPr = firstChild(paragraph, 'a:pPr');
  if (pPr) chain.push(firstChild(pPr, 'a:defRPr'));

  const txBody = firstChild(shape, 'p:txBody');
  const own = txBody && firstChild(txBody, 'a:lstStyle');
  chain.push(lvlProps(own, level) && firstChild(lvlProps(own, level)!, 'a:defRPr'));

  const key = placeholderKeyOf(shape);
  if (key) {
    for (const root of [ctx.layoutRoot, ctx.masterRoot]) {
      const ph = findPlaceholder(root, key);
      const phBody = ph && firstChild(ph, 'p:txBody');
      const phList = phBody && firstChild(phBody, 'a:lstStyle');
      const lvl = lvlProps(phList, level);
      if (lvl) chain.push(firstChild(lvl, 'a:defRPr'));
    }
    const txStyles = ctx.masterRoot && firstChild(ctx.masterRoot, 'p:txStyles');
    const group = txStyles && firstChild(txStyles, txStyleNameFor(key.type));
    const lvl = lvlProps(group, level);
    if (lvl) chain.push(firstChild(lvl, 'a:defRPr'));
  } else {
    // 자리표시자가 아닌 그냥 글상자는 otherStyle 을 따른다.
    const txStyles = ctx.masterRoot && firstChild(ctx.masterRoot, 'p:txStyles');
    const group = txStyles && firstChild(txStyles, 'p:otherStyle');
    const lvl = lvlProps(group, level);
    if (lvl) chain.push(firstChild(lvl, 'a:defRPr'));
  }

  return chain.filter((el): el is XmlElement => el !== undefined);
}

function firstDefined<T>(chain: XmlElement[], read: (el: XmlElement) => T | undefined): T | undefined {
  for (const el of chain) {
    const value = read(el);
    if (value !== undefined) return value;
  }
  return undefined;
}

function boolAttr(el: XmlElement, name: string): boolean | undefined {
  const raw = attr(el, name);
  if (raw === undefined) return undefined;
  return raw === '1' || raw === 'true';
}

function readCharStyleFromChain(chain: XmlElement[], ctx: SlideContext): CharStyle {
  const style: CharStyle = {};

  const sz = firstDefined(chain, (el) => intAttr(el, 'sz'));
  if (sz !== undefined) style.fontSize = sz / 100;

  const b = firstDefined(chain, (el) => boolAttr(el, 'b'));
  if (b !== undefined) style.bold = b;
  const i = firstDefined(chain, (el) => boolAttr(el, 'i'));
  if (i !== undefined) style.italic = i;

  const u = firstDefined(chain, (el) => attr(el, 'u'));
  if (u !== undefined) style.underline = u !== 'none';
  const strike = firstDefined(chain, (el) => attr(el, 'strike'));
  if (strike !== undefined) style.strikeout = strike !== 'noStrike';

  const baseline = firstDefined(chain, (el) => intAttr(el, 'baseline'));
  if (baseline !== undefined && baseline > 0) style.superscript = true;
  else if (baseline !== undefined && baseline < 0) style.subscript = true;

  const color = firstDefined(chain, (el) => {
    const solid = firstChild(el, 'a:solidFill');
    return solid ? resolveFillColor(solid, ctx.theme) : undefined;
  });
  if (color) style.color = color.hex;

  const highlight = firstDefined(chain, (el) => {
    const hl = firstChild(el, 'a:highlight');
    return hl ? resolveFillColor(hl, ctx.theme) : undefined;
  });
  if (highlight) style.highlight = highlight.hex;

  const typeface = firstDefined(chain, (el) => {
    for (const name of ['a:ea', 'a:latin', 'a:cs']) {
      const font = firstChild(el, name);
      const face = font && attr(font, 'typeface');
      if (!face) continue;
      // +mj-ea / +mn-lt 는 테마 글꼴을 가리키는 표시다.
      if (face.startsWith('+mj')) return ctx.theme.majorFont;
      if (face.startsWith('+mn')) return ctx.theme.minorFont;
      return face;
    }
    return undefined;
  });
  if (typeface) style.fontFamily = typeface;

  return style;
}

const ALIGN_FROM: Record<string, ParagraphStyle['align']> = {
  l: 'left',
  ctr: 'center',
  r: 'right',
  just: 'justify',
  dist: 'distribute',
  justLow: 'justify',
  thaiDist: 'distribute',
};

function readParagraphStyleFromChain(
  paragraph: XmlElement,
  shape: XmlElement,
  level: number,
  ctx: SlideContext,
): ParagraphStyle | undefined {
  const style: ParagraphStyle = {};
  const pPr = firstChild(paragraph, 'a:pPr');

  const holders: Array<XmlElement | undefined> = [pPr];
  const txBody = firstChild(shape, 'p:txBody');
  const own = txBody && firstChild(txBody, 'a:lstStyle');
  holders.push(lvlProps(own, level));

  const key = placeholderKeyOf(shape);
  if (key) {
    for (const root of [ctx.layoutRoot, ctx.masterRoot]) {
      const ph = findPlaceholder(root, key);
      const phBody = ph && firstChild(ph, 'p:txBody');
      holders.push(lvlProps(phBody && firstChild(phBody, 'a:lstStyle'), level));
    }
    const txStyles = ctx.masterRoot && firstChild(ctx.masterRoot, 'p:txStyles');
    holders.push(lvlProps(txStyles && firstChild(txStyles, txStyleNameFor(key.type)), level));
  }

  const chain = holders.filter((el): el is XmlElement => el !== undefined);
  const algn = firstDefined(chain, (el) => attr(el, 'algn'));
  if (algn && ALIGN_FROM[algn]) style.align = ALIGN_FROM[algn];

  const marL = firstDefined(chain, (el) => intAttr(el, 'marL'));
  if (marL !== undefined && marL > 0) style.indentLeft = hwpunit.fromEmu(marL);
  const indent = firstDefined(chain, (el) => intAttr(el, 'indent'));
  if (indent !== undefined && indent !== 0) style.indentFirstLine = hwpunit.fromEmu(indent);

  const lnSpc = firstDefined(chain, (el) => firstChild(el, 'a:lnSpc'));
  if (lnSpc) {
    const spcPct = firstChild(lnSpc, 'a:spcPct');
    const spcPts = firstChild(lnSpc, 'a:spcPts');
    if (spcPct) {
      const v = intAttr(spcPct, 'val');
      if (v !== undefined) style.lineHeight = { type: 'percent', value: v / 1000 };
    } else if (spcPts) {
      const v = intAttr(spcPts, 'val');
      if (v !== undefined) style.lineHeight = { type: 'hwpunit', value: hwpunit.fromPoint(v / 100) };
    }
  }

  const spcBef = firstDefined(chain, (el) => firstChild(el, 'a:spcBef'));
  const beforePts = spcBef && intAttr(firstChild(spcBef, 'a:spcPts'), 'val');
  if (beforePts !== undefined) style.spaceBefore = hwpunit.fromPoint(beforePts / 100);
  const spcAft = firstDefined(chain, (el) => firstChild(el, 'a:spcAft'));
  const afterPts = spcAft && intAttr(firstChild(spcAft, 'a:spcPts'), 'val');
  if (afterPts !== undefined) style.spaceAfter = hwpunit.fromPoint(afterPts / 100);

  if (level > 0) style.listLevel = level + 1;

  return Object.keys(style).length > 0 ? style : undefined;
}

// ------------------------------------------------------------------ 본문

function paragraphsOf(shape: XmlElement, ctx: SlideContext): JamoParagraph[] {
  const txBody = firstChild(shape, 'p:txBody') ?? firstChild(shape, 'a:txBody');
  if (!txBody) return [];

  return childElements(txBody, 'a:p').map((p) => {
    const pPr = firstChild(p, 'a:pPr');
    const level = intAttr(pPr, 'lvl') ?? 0;
    const runs: JamoParagraph['runs'] = [];

    for (const child of childElements(p)) {
      if (child.name === 'a:r') {
        const t = firstChild(child, 'a:t');
        runs.push({
          text: t ? textContent(t) : '',
          style: readCharStyleFromChain(effectiveRunProps(child, p, shape, level, ctx), ctx),
          source: child,
        });
      } else if (child.name === 'a:br') {
        runs.push({ text: '\n' });
      } else if (child.name === 'a:fld') {
        // 쪽 번호 같은 자동 필드. 마지막으로 계산된 글자가 들어 있다.
        const t = firstChild(child, 'a:t');
        if (t) {
          runs.push({
            text: textContent(t),
            style: readCharStyleFromChain(effectiveRunProps(child, p, shape, level, ctx), ctx),
          });
        }
      }
    }

    if (runs.length === 0) {
      // 빈 문단도 줄 높이를 차지한다. 서식만 읽어 둔다.
      runs.push({
        text: '',
        style: readCharStyleFromChain(effectiveRunProps(undefined, p, shape, level, ctx), ctx),
      });
    }

    return {
      runs,
      style: readParagraphStyleFromChain(p, shape, level, ctx),
      source: p,
    };
  });
}

function anchorOf(shape: XmlElement, ctx: SlideContext): JamoShape['anchor'] {
  const read = (el: XmlElement | undefined): string | undefined => {
    const txBody = el && firstChild(el, 'p:txBody');
    const bodyPr = txBody && firstChild(txBody, 'a:bodyPr');
    return bodyPr ? (attr(bodyPr, 'anchor') ?? undefined) : undefined;
  };
  const key = placeholderKeyOf(shape);
  const value =
    read(shape) ??
    (key ? read(findPlaceholder(ctx.layoutRoot, key)) : undefined) ??
    (key ? read(findPlaceholder(ctx.masterRoot, key)) : undefined);
  if (value === 'ctr') return 'middle';
  if (value === 'b') return 'bottom';
  if (value === 't') return 'top';
  return undefined;
}

function insetOf(shape: XmlElement): JamoShape['inset'] {
  const txBody = firstChild(shape, 'p:txBody');
  const bodyPr = txBody && firstChild(txBody, 'a:bodyPr');
  if (!bodyPr) return undefined;
  // 지정하지 않으면 기본값이 정해져 있다 (좌우 0.1인치, 상하 0.05인치).
  const DEFAULT = { l: 91440, r: 91440, t: 45720, b: 45720 };
  return {
    left: hwpunit.fromEmu(intAttr(bodyPr, 'lIns') ?? DEFAULT.l),
    right: hwpunit.fromEmu(intAttr(bodyPr, 'rIns') ?? DEFAULT.r),
    top: hwpunit.fromEmu(intAttr(bodyPr, 'tIns') ?? DEFAULT.t),
    bottom: hwpunit.fromEmu(intAttr(bodyPr, 'bIns') ?? DEFAULT.b),
  };
}

/** 도형 스타일 참조(`p:style`)가 가리키는 테마 채우기. */
function styleRefFill(shape: XmlElement, ctx: SlideContext): JamoFill | undefined {
  const style = firstChild(shape, 'p:style');
  const fillRef = style && firstChild(style, 'a:fillRef');
  if (!fillRef) return undefined;
  const placeholder = resolveFillColor(fillRef, ctx.theme);
  const idx = intAttr(fillRef, 'idx') ?? 0;
  if (idx === 0) return undefined;
  const entry = ctx.theme.fillStyles[Math.max(0, idx - 1)];
  if (!entry) {
    return placeholder ? { type: 'solid', color: placeholder.hex, alpha: placeholder.alpha } : undefined;
  }
  const wrapper: XmlElement = {
    kind: 'element',
    name: 'wrapper',
    attrs: [],
    children: [entry],
    selfClosed: false,
  };
  return readFill(wrapper, ctx.theme, placeholder?.hex);
}

/**
 * 도형 모양을 읽는다.
 *
 * PPTX 에는 미리 정의된 모양이 수백 가지 있지만, 화면에서 눈에 띄게 다른 건
 * 몇 가지뿐이다. 전부 흉내 내려면 각 모양의 경로 공식을 옮겨야 하는데 들인
 * 품에 비해 얻는 게 적다. 둥근 모서리와 타원만 제대로 내고 나머지는 사각형으로
 * 둔다 — 적어도 자리와 색은 맞는다.
 */
function geometryOf(spPr: XmlElement | undefined): {
  geometry: JamoShape['geometry'];
  cornerRadius?: number;
} {
  const prst = spPr && firstChild(spPr, 'a:prstGeom');
  if (!prst) {
    return { geometry: spPr && firstChild(spPr, 'a:custGeom') ? 'other' : undefined };
  }
  const name = attr(prst, 'prst') ?? 'rect';
  if (name === 'ellipse' || name === 'circle') return { geometry: 'ellipse' };
  if (name === 'line' || name === 'straightConnector1') return { geometry: 'line' };
  if (name.startsWith('roundRect') || name === 'round2SameRect' || name === 'round1Rect') {
    const avLst = firstChild(prst, 'a:avLst');
    const gd = avLst && firstChild(avLst, 'a:gd');
    const raw = gd && attr(gd, 'fmla');
    // fmla 는 "val 16667" 꼴이고 1/100000 비율이다.
    const match = raw?.match(/val\s+(-?\d+)/);
    const value = match ? Number.parseInt(match[1]!, 10) / 100000 : 0.16667;
    return { geometry: 'roundRect', cornerRadius: Math.max(0, Math.min(value, 0.5)) };
  }
  if (name === 'rect') return { geometry: 'rect' };
  return { geometry: 'other' };
}

/**
 * 도형 자체를 그림으로 채운 경우. 배경 사진을 까는 흔한 방식이다.
 * `p:pic` 이 아니라 `p:spPr` 안에 `a:blipFill` 로 들어온다.
 */
function pictureFillOf(
  spPr: XmlElement | undefined,
  ctx: SlideContext,
): JamoShape['image'] | undefined {
  return readBlipFill(spPr && firstChild(spPr, 'a:blipFill'), ctx);
}

/**
 * 그림 채우기를 읽는다.
 *
 * `a:stretch` 는 "틀에 맞춰 늘린다"는 뜻이고 PPTX 에서 가장 흔하다.
 * 이걸 비율 유지로 그리면 배경 사진이 틀을 못 채워 위아래에 흰 띠가 생긴다.
 */
function readBlipFill(
  blipFill: XmlElement | undefined,
  ctx: SlideContext,
): JamoShape['image'] | undefined {
  const blip = blipFill && firstChild(blipFill, 'a:blip');
  const embed = blip && attr(blip, 'r:embed');
  if (!embed || !blipFill) return undefined;
  const part = ctx.resolveRel(embed);
  if (!part) return undefined;

  const fit: NonNullable<JamoShape['image']>['fit'] = firstChild(blipFill, 'a:tile')
    ? 'cover'
    : firstChild(blipFill, 'a:stretch')
      ? 'fill'
      : 'contain';
  return { part, fit };
}

function lineOf(spPr: XmlElement | undefined, ctx: SlideContext): JamoShape['line'] {
  const ln = spPr && firstChild(spPr, 'a:ln');
  if (!ln) return undefined;
  if (firstChild(ln, 'a:noFill')) return undefined;
  const solid = firstChild(ln, 'a:solidFill');
  const color = solid ? resolveFillColor(solid, ctx.theme) : undefined;
  const width = intAttr(ln, 'w');
  if (!color && width === undefined) return undefined;
  return {
    color: color?.hex,
    width: width === undefined ? undefined : width / EMU_PER_PT,
  };
}

// ------------------------------------------------------------------- 표

function readSlideTable(tbl: XmlElement, ctx: SlideContext): JamoTable {
  const grid = firstChild(tbl, 'a:tblGrid');
  const columnWidths = grid
    ? childElements(grid, 'a:gridCol').map((gc) => hwpunit.fromEmu(intAttr(gc, 'w') ?? 0))
    : [];

  const rows: JamoTableRow[] = childElements(tbl, 'a:tr').map((tr, rowAddr) => {
    let colAddr = 0;
    const cells: JamoTableCell[] = [];
    for (const tc of childElements(tr, 'a:tc')) {
      const gridSpan = intAttr(tc, 'gridSpan') ?? 1;
      const rowSpan = intAttr(tc, 'rowSpan') ?? 1;
      // hMerge/vMerge 로 덮인 칸은 주인 칸이 따로 있다. 건너뛴다.
      const covered = attr(tc, 'hMerge') === '1' || attr(tc, 'vMerge') === '1';
      if (covered) {
        colAddr += gridSpan;
        continue;
      }
      const tcPr = firstChild(tc, 'a:tcPr');
      const fill = tcPr ? readFill(tcPr, ctx.theme) : undefined;
      cells.push({
        paragraphs: paragraphsOf(tc, ctx),
        colSpan: gridSpan,
        rowSpan,
        colAddr,
        rowAddr,
        width: columnWidths[colAddr],
        shade: fill?.type === 'solid' ? fill.color : undefined,
        source: tc,
      });
      colAddr += gridSpan;
    }
    return { cells, source: tr };
  });

  return {
    type: 'table',
    rows,
    columnWidths,
    width: columnWidths.reduce((a, b) => a + b, 0) || undefined,
    source: tbl,
  };
}

// ------------------------------------------------------------------ 도형

/**
 * 도형 트리를 읽는다. 그룹은 좌표를 바깥 기준으로 펴서 평평하게 만든다.
 *
 * 그룹을 그대로 중첩해 두면 화면 쪽에서 변환을 또 계산해야 한다. 좌표를
 * 여기서 한 번만 풀어 두는 쪽이 그리기도 단순하고 틀릴 여지도 적다.
 */
export function readShapes(
  spTree: XmlElement,
  ctx: SlideContext,
  transform: Transform = IDENTITY,
  out: JamoShape[] = [],
): JamoShape[] {
  for (const node of childElements(spTree)) {
    switch (node.name) {
      case 'p:sp': {
        const spPr = firstChild(node, 'p:spPr');
        const box = frameOf(spPr, transform) ?? inheritedFrame(node, ctx, transform);
        const key = placeholderKeyOf(node);
        const shape = geometryOf(spPr);
        out.push({
          id: String(out.length),
          name: shapeName(node),
          frame: box && { x: box.x, y: box.y, width: box.width, height: box.height },
          rotation: box?.rotation,
          flipH: box?.flipH,
          flipV: box?.flipV,
          placeholder: key?.type,
          paragraphs: paragraphsOf(node, ctx),
          fill: readFill(spPr, ctx.theme) ?? styleRefFill(node, ctx),
          image: pictureFillOf(spPr, ctx),
          line: lineOf(spPr, ctx),
          geometry: shape.geometry,
          cornerRadius: shape.cornerRadius,
          anchor: anchorOf(node, ctx),
          inset: insetOf(node),
          zIndex: out.length,
          source: node,
        });
        break;
      }
      case 'p:pic': {
        const spPr = firstChild(node, 'p:spPr');
        const box = frameOf(spPr, transform);
        const image = readBlipFill(firstChild(node, 'p:blipFill'), ctx);
        const picShape = geometryOf(spPr);
        out.push({
          id: String(out.length),
          name: shapeName(node),
          frame: box && { x: box.x, y: box.y, width: box.width, height: box.height },
          rotation: box?.rotation,
          flipH: box?.flipH,
          flipV: box?.flipV,
          paragraphs: [],
          image: image ? { ...image, alt: shapeName(node) } : undefined,
          line: lineOf(spPr, ctx),
          geometry: picShape.geometry,
          cornerRadius: picShape.cornerRadius,
          zIndex: out.length,
          source: node,
        });
        break;
      }
      case 'p:graphicFrame': {
        const box = frameOf(node, transform) ?? frameOf(firstChild(node, 'p:xfrm'), transform);
        const graphic = firstChild(node, 'a:graphic');
        const data = graphic && firstChild(graphic, 'a:graphicData');
        const tbl = data && firstChild(data, 'a:tbl');
        out.push({
          id: String(out.length),
          name: shapeName(node),
          frame: box && { x: box.x, y: box.y, width: box.width, height: box.height },
          paragraphs: [],
          table: tbl ? readSlideTable(tbl, ctx) : undefined,
          zIndex: out.length,
          source: node,
        });
        break;
      }
      case 'p:grpSp': {
        const grpSpPr = firstChild(node, 'p:grpSpPr');
        readShapes(node, ctx, groupTransform(grpSpPr, transform), out);
        break;
      }
      case 'p:cxnSp': {
        // 연결선. 선만 있고 글자가 없다.
        const spPr = firstChild(node, 'p:spPr');
        const box = frameOf(spPr, transform);
        const line = lineOf(spPr, ctx);
        if (box && line) {
          out.push({
            id: String(out.length),
            name: shapeName(node),
            frame: { x: box.x, y: box.y, width: box.width, height: box.height },
            paragraphs: [],
            line,
            fill: { type: 'none' },
            zIndex: out.length,
            source: node,
          });
        }
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/** 슬라이드에 자리가 안 적혀 있으면 레이아웃·마스터의 같은 자리를 쓴다. */
function inheritedFrame(
  sp: XmlElement,
  ctx: SlideContext,
  transform: Transform,
): ReturnType<typeof frameOf> {
  const key = placeholderKeyOf(sp);
  if (!key) return undefined;
  for (const root of [ctx.layoutRoot, ctx.masterRoot]) {
    const ph = findPlaceholder(root, key);
    const box = ph && frameOf(firstChild(ph, 'p:spPr'), transform);
    if (box) return box;
  }
  return undefined;
}

function shapeName(node: XmlElement): string | undefined {
  for (const nv of ['p:nvSpPr', 'p:nvPicPr', 'p:nvGraphicFramePr', 'p:nvCxnSpPr']) {
    const holder = firstChild(node, nv);
    const cNvPr = holder && firstChild(holder, 'p:cNvPr');
    if (cNvPr) return attr(cNvPr, 'name') ?? undefined;
  }
  return undefined;
}

/**
 * 레이아웃·마스터에 그려져 있는 장식 도형들.
 *
 * 배경 띠나 로고 같은 것들이 여기 있다. 슬라이드에는 없고 레이아웃에만
 * 있으므로, 이것까지 그려야 실제로 보이는 모습이 된다. 자리표시자는
 * 슬라이드 쪽이 내용을 채우므로 제외한다.
 */
export function readInheritedDecorations(
  root: XmlElement | undefined,
  ctx: SlideContext,
): JamoShape[] {
  if (!root) return [];
  const cSld = firstChild(root, 'p:cSld');
  const spTree = cSld && firstChild(cSld, 'p:spTree');
  if (!spTree) return [];
  return readShapes(spTree, ctx).filter((shape) => shape.placeholder === undefined);
}
