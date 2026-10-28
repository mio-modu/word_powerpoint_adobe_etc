import { attr, childElements, firstChild, type XmlElement } from '@jamo/core';

/**
 * 테마 색 해석.
 *
 * PPTX 는 색을 거의 직접 쓰지 않는다. `<a:schemeClr val="bg1"/>` 처럼
 * **이름**으로 가리키고, 그 이름이 무엇을 뜻하는지는 세 단계를 거쳐야 안다.
 *
 *   1. 슬라이드 마스터의 `p:clrMap` 이 `bg1` → `lt1` 처럼 이름을 바꿔준다
 *   2. 테마의 `a:clrScheme` 에서 `lt1` 의 실제 값을 찾는다
 *   3. `lumMod`, `shade` 같은 변환이 붙어 있으면 그걸 적용한다
 *
 * 이 과정을 건너뛰면 어두운 배경에 흰 글씨인 장표가 흰 배경에 검은 글씨로
 * 나온다. 색이 "없는" 게 아니라 "풀지 못한" 것이다.
 */

export interface ThemeColors {
  /** dk1, lt1, dk2, lt2, accent1..6, hlink, folHlink */
  scheme: Map<string, string>;
  /** 마스터의 이름 바꾸기. bg1 → lt1 등. */
  map: Map<string, string>;
  /** 테마 글꼴. major 는 제목, minor 는 본문. */
  majorFont?: string;
  minorFont?: string;
  /** 배경 채우기 목록 (bgRef idx 가 가리킨다). */
  bgFillStyles: XmlElement[];
  /** 도형 채우기 목록 (style/fillRef idx 가 가리킨다). */
  fillStyles: XmlElement[];
  lineStyles: XmlElement[];
}

export function emptyTheme(): ThemeColors {
  return {
    scheme: new Map(),
    map: new Map(),
    bgFillStyles: [],
    fillStyles: [],
    lineStyles: [],
  };
}

/** `<a:srgbClr val="1F2A44"/>` 같은 색 요소 하나를 `#RRGGBB` 로. */
function literalColor(el: XmlElement): string | undefined {
  switch (el.name) {
    case 'a:srgbClr': {
      const val = attr(el, 'val');
      return val ? `#${val.toUpperCase()}` : undefined;
    }
    case 'a:sysClr': {
      // 시스템 색은 마지막으로 계산된 값이 lastClr 에 남아 있다.
      const last = attr(el, 'lastClr');
      if (last) return `#${last.toUpperCase()}`;
      const val = attr(el, 'val');
      if (val === 'window') return '#FFFFFF';
      if (val === 'windowText') return '#000000';
      return undefined;
    }
    case 'a:prstClr': {
      const val = attr(el, 'val');
      return val ? (PRESET_COLORS[val] ?? undefined) : undefined;
    }
    default:
      return undefined;
  }
}

const PRESET_COLORS: Record<string, string> = {
  black: '#000000',
  white: '#FFFFFF',
  red: '#FF0000',
  green: '#008000',
  blue: '#0000FF',
  yellow: '#FFFF00',
  gray: '#808080',
  darkGray: '#A9A9A9',
  lightGray: '#D3D3D3',
};

export function readTheme(themeRoot: XmlElement, masterRoot?: XmlElement): ThemeColors {
  const theme = emptyTheme();
  const elements = firstChild(themeRoot, 'a:themeElements');
  if (!elements) return theme;

  const clrScheme = firstChild(elements, 'a:clrScheme');
  if (clrScheme) {
    for (const slot of childElements(clrScheme)) {
      // 요소 이름이 곧 이름표다: <a:dk1>, <a:accent1> …
      const key = slot.name.replace(/^a:/, '');
      for (const child of childElements(slot)) {
        const color = literalColor(child);
        if (color) {
          theme.scheme.set(key, color);
          break;
        }
      }
    }
  }

  const fontScheme = firstChild(elements, 'a:fontScheme');
  if (fontScheme) {
    const pick = (which: string): string | undefined => {
      const group = firstChild(fontScheme, which);
      if (!group) return undefined;
      // 한글 장표는 ea(동아시아) 글꼴이 실제로 보이는 글꼴이다.
      const ea = firstChild(group, 'a:ea');
      const eaFace = ea && attr(ea, 'typeface');
      if (eaFace) return eaFace;
      const latin = firstChild(group, 'a:latin');
      return latin ? (attr(latin, 'typeface') ?? undefined) : undefined;
    };
    theme.majorFont = pick('a:majorFont');
    theme.minorFont = pick('a:minorFont');
  }

  const fmtScheme = firstChild(elements, 'a:fmtScheme');
  if (fmtScheme) {
    const list = (name: string): XmlElement[] => {
      const holder = firstChild(fmtScheme, name);
      return holder ? childElements(holder) : [];
    };
    theme.bgFillStyles = list('a:bgFillStyleLst');
    theme.fillStyles = list('a:fillStyleLst');
    theme.lineStyles = list('a:lnStyleLst');
  }

  if (masterRoot) {
    const clrMap = firstChild(masterRoot, 'p:clrMap');
    if (clrMap) {
      for (const a of clrMap.attrs) theme.map.set(a.name, a.value);
    }
  }
  return theme;
}

// ------------------------------------------------------------------ 색 변환

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const v = hex.replace(/^#/, '');
  return {
    r: Number.parseInt(v.slice(0, 2), 16),
    g: Number.parseInt(v.slice(2, 4), 16),
    b: Number.parseInt(v.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));
  return `#${[clamp(r), clamp(g), clamp(b)]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255 };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const toChannel = (t: number): number => {
    let v = t;
    if (v < 0) v += 1;
    if (v > 1) v -= 1;
    if (v < 1 / 6) return p + (q - p) * 6 * v;
    if (v < 1 / 2) return q;
    if (v < 2 / 3) return p + (q - p) * (2 / 3 - v) * 6;
    return p;
  };
  return { r: toChannel(h + 1 / 3) * 255, g: toChannel(h) * 255, b: toChannel(h - 1 / 3) * 255 };
}

function pct(el: XmlElement): number | undefined {
  const raw = attr(el, 'val');
  if (raw === undefined) return undefined;
  // 백분율은 1/1000 % 단위로 들어온다. 60000 = 60%.
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n / 100000 : undefined;
}

export interface ResolvedColor {
  hex: string;
  /** 0–1. 1이면 불투명. */
  alpha: number;
}

/**
 * 색 요소에 붙은 변환을 적용한다.
 *
 * `lumMod`/`lumOff` 는 밝기를 곱하고 더한다. 테마 색 하나로 밝고 어두운
 * 변주를 만드는 장치라, 이걸 빼면 모든 변주가 같은 색으로 보인다.
 */
function applyTransforms(base: string, el: XmlElement): ResolvedColor {
  let { r, g, b } = hexToRgb(base);
  let alpha = 1;

  for (const t of childElements(el)) {
    const value = pct(t);
    switch (t.name) {
      case 'a:alpha':
        if (value !== undefined) alpha = value;
        break;
      case 'a:lumMod':
      case 'a:lumOff': {
        if (value === undefined) break;
        const hsl = rgbToHsl(r, g, b);
        const l = t.name === 'a:lumMod' ? hsl.l * value : hsl.l + value;
        const out = hslToRgb(hsl.h, hsl.s, Math.max(0, Math.min(1, l)));
        r = out.r;
        g = out.g;
        b = out.b;
        break;
      }
      case 'a:shade': {
        if (value === undefined) break;
        r *= value;
        g *= value;
        b *= value;
        break;
      }
      case 'a:tint': {
        if (value === undefined) break;
        r = r * value + 255 * (1 - value);
        g = g * value + 255 * (1 - value);
        b = b * value + 255 * (1 - value);
        break;
      }
      case 'a:satMod': {
        if (value === undefined) break;
        const hsl = rgbToHsl(r, g, b);
        const out = hslToRgb(hsl.h, Math.max(0, Math.min(1, hsl.s * value)), hsl.l);
        r = out.r;
        g = out.g;
        b = out.b;
        break;
      }
      default:
        break;
    }
  }
  return { hex: rgbToHex(r, g, b), alpha };
}

/**
 * 색 요소 하나를 실제 색으로 푼다.
 *
 * `phClr` 는 "이 자리에 들어올 색" 이라는 자리 표시자다. 테마의 채우기
 * 정의 안에서 쓰이고, 실제 색은 그 채우기를 참조한 쪽이 정해 준다.
 */
export function resolveColorElement(
  el: XmlElement,
  theme: ThemeColors,
  placeholderColor?: string,
): ResolvedColor | undefined {
  if (el.name === 'a:schemeClr') {
    const val = attr(el, 'val');
    if (!val) return undefined;
    if (val === 'phClr') {
      return placeholderColor ? applyTransforms(placeholderColor, el) : undefined;
    }
    // 마스터의 clrMap 을 먼저 거친다: bg1 → lt1
    const mapped = theme.map.get(val) ?? val;
    const base = theme.scheme.get(mapped) ?? theme.scheme.get(val);
    if (!base) return undefined;
    return applyTransforms(base, el);
  }
  const literal = literalColor(el);
  return literal ? applyTransforms(literal, el) : undefined;
}

/** 채우기 요소(`a:solidFill` 등)의 자식에서 색을 찾아 푼다. */
export function resolveFillColor(
  fillHolder: XmlElement,
  theme: ThemeColors,
  placeholderColor?: string,
): ResolvedColor | undefined {
  for (const child of childElements(fillHolder)) {
    const resolved = resolveColorElement(child, theme, placeholderColor);
    if (resolved) return resolved;
  }
  return undefined;
}
