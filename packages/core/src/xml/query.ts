import type { XmlDocument, XmlElement, XmlNode } from './types.js';

export function isElement(node: XmlNode): node is XmlElement {
  return node.kind === 'element';
}

/** 요소의 직계 자식 요소들. 이름을 주면 그 이름만. */
export function childElements(el: XmlElement, name?: string): XmlElement[] {
  const out: XmlElement[] = [];
  for (const c of el.children) {
    if (c.kind === 'element' && (name === undefined || c.name === name)) out.push(c);
  }
  return out;
}

/** 첫 번째 직계 자식 요소. */
export function firstChild(el: XmlElement, name: string): XmlElement | undefined {
  for (const c of el.children) {
    if (c.kind === 'element' && c.name === name) return c;
  }
  return undefined;
}

/**
 * `a/b/c` 경로를 따라 내려간다. 중간에 끊기면 undefined.
 * 접두사를 포함한 전체 이름을 쓴다: `path(root, 'hh:refList', 'hh:charProperties')`
 */
export function path(el: XmlElement, ...names: string[]): XmlElement | undefined {
  let cur: XmlElement | undefined = el;
  for (const n of names) {
    if (!cur) return undefined;
    cur = firstChild(cur, n);
  }
  return cur;
}

/** 이름이 일치하는 모든 후손 요소를 문서 순서로. */
export function descendants(el: XmlElement, name: string): XmlElement[] {
  const out: XmlElement[] = [];
  const walk = (node: XmlElement): void => {
    for (const c of node.children) {
      if (c.kind !== 'element') continue;
      if (c.name === name) out.push(c);
      walk(c);
    }
  };
  walk(el);
  return out;
}

/** 조건을 만족하는 첫 후손. */
export function findDescendant(
  el: XmlElement,
  predicate: (e: XmlElement) => boolean,
): XmlElement | undefined {
  for (const c of el.children) {
    if (c.kind !== 'element') continue;
    if (predicate(c)) return c;
    const hit = findDescendant(c, predicate);
    if (hit) return hit;
  }
  return undefined;
}

export function attr(el: XmlElement, name: string): string | undefined {
  return el.attrs.find((a) => a.name === name)?.value;
}

export function attrInt(el: XmlElement, name: string, fallback = 0): number {
  const raw = attr(el, name);
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * HWPX/OOXML 의 불리언 속성. `1`/`0` 과 `true`/`false` 가 섞여 나온다.
 */
export function attrBool(el: XmlElement, name: string, fallback = false): boolean {
  const raw = attr(el, name);
  if (raw === undefined) return fallback;
  return raw === '1' || raw === 'true' || raw === 'on';
}

/** 속성을 덮어쓰되, 이미 있으면 **원래 순서를 유지**한다. */
export function setAttr(el: XmlElement, name: string, value: string): void {
  const found = el.attrs.find((a) => a.name === name);
  if (found) found.value = value;
  else el.attrs.push({ name, value, quote: '"' });
}

export function removeAttr(el: XmlElement, name: string): void {
  const i = el.attrs.findIndex((a) => a.name === name);
  if (i >= 0) el.attrs.splice(i, 1);
}

/** 요소 아래의 모든 텍스트를 이어붙인다 (CDATA 포함). */
export function textContent(el: XmlElement): string {
  let out = '';
  const walk = (node: XmlElement): void => {
    for (const c of node.children) {
      if (c.kind === 'text' || c.kind === 'cdata') out += c.text;
      else if (c.kind === 'element') walk(c);
    }
  };
  walk(el);
  return out;
}

/** 요소의 자식을 단일 텍스트 노드로 교체한다. */
export function setTextContent(el: XmlElement, text: string): void {
  el.children = text === '' ? [] : [{ kind: 'text', text }];
  if (text === '') el.selfClosed = el.selfClosed ?? true;
  else el.selfClosed = false;
}

export function element(
  name: string,
  attrs: Record<string, string | number | undefined> = {},
  children: XmlNode[] = [],
): XmlElement {
  const list = Object.entries(attrs)
    .filter(([, v]) => v !== undefined)
    .map(([name, v]) => ({ name, value: String(v), quote: '"' as const }));
  return {
    kind: 'element',
    name,
    attrs: list,
    children,
    selfClosed: children.length === 0,
  };
}

export function text(value: string): XmlNode {
  return { kind: 'text', text: value };
}

/** 부모의 자식 목록에서 `child` 의 위치. 없으면 -1. */
export function indexOfChild(parent: XmlElement, child: XmlNode): number {
  return parent.children.indexOf(child);
}

export function insertAfter(parent: XmlElement, ref: XmlNode, ...nodes: XmlNode[]): void {
  const i = parent.children.indexOf(ref);
  if (i < 0) parent.children.push(...nodes);
  else parent.children.splice(i + 1, 0, ...nodes);
}

export function removeChild(parent: XmlElement, child: XmlNode): boolean {
  const i = parent.children.indexOf(child);
  if (i < 0) return false;
  parent.children.splice(i, 1);
  return true;
}

/** 깊은 복사. 슬라이드/문단 복제에 쓴다. */
export function cloneNode<T extends XmlNode>(node: T): T {
  return structuredClone(node);
}

export function cloneDocument(doc: XmlDocument): XmlDocument {
  return structuredClone(doc);
}
