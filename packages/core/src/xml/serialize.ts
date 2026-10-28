import type { XmlDocument, XmlElement, XmlNode } from './types.js';

/** 텍스트 노드용 이스케이프. `>` 도 함께 막아 `]]>` 사고를 피한다. */
export function escapeText(value: string): string {
  return value.replace(/[&<>\r]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&#13;',
  );
}

/** 속성값용 이스케이프. 줄바꿈/탭은 정규화로 사라지지 않게 참조로 바꾼다. */
export function escapeAttr(value: string, quote: '"' | "'" = '"'): string {
  let out = value.replace(/[&<>\t\n\r]/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '\t':
        return '&#9;';
      case '\n':
        return '&#10;';
      default:
        return '&#13;';
    }
  });
  out = quote === '"' ? out.replace(/"/g, '&quot;') : out.replace(/'/g, '&apos;');
  return out;
}

export interface SerializeOptions {
  /**
   * 들여쓰기 문자열. 지정하면 사람이 읽기 좋게 포맷한다.
   *
   * 주의: 혼합 콘텐츠(텍스트와 요소가 섞인 문단)에는 적용하지 않는다.
   * HWPX 의 `hp:t` 안에 공백을 끼워 넣으면 문서 내용이 바뀌어 버린다.
   */
  indent?: string;
  /** XML 선언을 붙일지. 기본 true. */
  declaration?: boolean;
}

export function serializeXml(doc: XmlDocument, options: SerializeOptions = {}): string {
  const parts: string[] = [];
  if (options.declaration !== false) {
    const d = doc.declaration ?? { version: '1.0', encoding: 'UTF-8', standalone: 'yes' };
    let decl = `<?xml version="${d.version}"`;
    if (d.encoding) decl += ` encoding="${d.encoding}"`;
    if (d.standalone) decl += ` standalone="${d.standalone}"`;
    parts.push(`${decl}?>`);
    if (options.indent !== undefined) parts.push('\n');
  }
  for (const node of doc.prolog) parts.push(writeNode(node, options, 0));
  parts.push(writeNode(doc.root, options, 0));
  for (const node of doc.epilog) parts.push(writeNode(node, options, 0));
  return parts.join('');
}

export function serializeElement(el: XmlElement, options: SerializeOptions = {}): string {
  return writeNode(el, options, 0);
}

/** 자식 중 하나라도 텍스트/CDATA 가 있으면 혼합 콘텐츠 — 들여쓰기 금지. */
function hasTextChild(el: XmlElement): boolean {
  return el.children.some((c) => c.kind === 'text' || c.kind === 'cdata');
}

function writeNode(node: XmlNode, opts: SerializeOptions, depth: number): string {
  switch (node.kind) {
    case 'text':
      return escapeText(node.text);
    case 'cdata':
      return `<![CDATA[${node.text}]]>`;
    case 'comment':
      return `<!--${node.text}-->`;
    case 'pi':
      return node.data ? `<?${node.target} ${node.data}?>` : `<?${node.target}?>`;
    case 'doctype':
      return node.text;
    case 'element':
      return writeElement(node, opts, depth);
  }
}

function writeElement(el: XmlElement, opts: SerializeOptions, depth: number): string {
  const attrs = el.attrs
    .map((a) => {
      const q = a.quote ?? '"';
      return ` ${a.name}=${q}${escapeAttr(a.value, q)}${q}`;
    })
    .join('');

  if (el.children.length === 0) {
    // 원본이 `<a></a>` 였다면 그대로 유지한다 (바이트 수준 왕복).
    return el.selfClosed === false ? `<${el.name}${attrs}></${el.name}>` : `<${el.name}${attrs}/>`;
  }

  const pretty = opts.indent !== undefined && !hasTextChild(el);
  if (!pretty) {
    const inner = el.children.map((c) => writeNode(c, opts, depth + 1)).join('');
    return `<${el.name}${attrs}>${inner}</${el.name}>`;
  }

  const pad = opts.indent!.repeat(depth + 1);
  const closePad = opts.indent!.repeat(depth);
  const inner = el.children
    .filter((c) => !(c.kind === 'text' && c.text.trim() === ''))
    .map((c) => `\n${pad}${writeNode(c, opts, depth + 1)}`)
    .join('');
  return `<${el.name}${attrs}>${inner}\n${closePad}</${el.name}>`;
}
