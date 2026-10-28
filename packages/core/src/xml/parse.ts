import {
  XmlParseError,
  type XmlAttr,
  type XmlDeclaration,
  type XmlDocument,
  type XmlElement,
  type XmlNode,
} from './types.js';

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/**
 * XML 문자 참조/엔티티를 해석한다.
 *
 * HWPX·OOXML 은 DTD 를 쓰지 않으므로 미리 정의된 5개 엔티티와 숫자 참조만
 * 다루면 충분하다. 알 수 없는 엔티티는 오류 대신 원문을 그대로 남긴다 —
 * 편집기에서 파일 하나 못 여는 것보다 모르는 토큰을 보존하는 쪽이 낫다.
 */
export function decodeEntities(input: string): string {
  if (!input.includes('&')) return input;
  return input.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z_][\w.-]*);/g, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? safeFromCodePoint(code, whole) : whole;
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? safeFromCodePoint(code, whole) : whole;
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}

function safeFromCodePoint(code: number, fallback: string): string {
  if (code < 0 || code > 0x10ffff) return fallback;
  // 서러게이트 영역은 단독으로 올 수 없다.
  if (code >= 0xd800 && code <= 0xdfff) return fallback;
  try {
    return String.fromCodePoint(code);
  } catch {
    return fallback;
  }
}

const NAME_START = /[A-Za-z_:]/;
const NAME_CHAR = /[-A-Za-z0-9_:.]/;

class Scanner {
  pos = 0;
  constructor(readonly src: string) {}

  eof(): boolean {
    return this.pos >= this.src.length;
  }

  peek(offset = 0): string {
    return this.src[this.pos + offset] ?? '';
  }

  startsWith(token: string): boolean {
    return this.src.startsWith(token, this.pos);
  }

  /** `token` 을 소비하고, 없으면 예외. */
  expect(token: string): void {
    if (!this.startsWith(token)) {
      throw new XmlParseError(`'${token}' 를 기대했지만 '${this.src.slice(this.pos, this.pos + 16)}' 를 만났습니다`, this.pos);
    }
    this.pos += token.length;
  }

  skipSpace(): void {
    while (this.pos < this.src.length) {
      const c = this.src[this.pos]!;
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') this.pos += 1;
      else break;
    }
  }

  /** `token` 까지의 내용을 반환하고 token 도 소비한다. */
  readUntil(token: string): string {
    const idx = this.src.indexOf(token, this.pos);
    if (idx < 0) throw new XmlParseError(`닫히지 않은 구간: '${token}' 를 찾을 수 없습니다`, this.pos);
    const out = this.src.slice(this.pos, idx);
    this.pos = idx + token.length;
    return out;
  }

  readName(): string {
    const start = this.pos;
    if (!NAME_START.test(this.peek())) {
      throw new XmlParseError(`이름이 와야 하는 자리에 '${this.peek()}' 가 있습니다`, this.pos);
    }
    this.pos += 1;
    while (this.pos < this.src.length && NAME_CHAR.test(this.src[this.pos]!)) this.pos += 1;
    return this.src.slice(start, this.pos);
  }
}

/** XML 문서 문자열을 무손실 트리로 파싱한다. */
export function parseXml(source: string): XmlDocument {
  // UTF-8 BOM 은 조용히 버린다.
  const src = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const sc = new Scanner(src);

  let declaration: XmlDeclaration | undefined;
  sc.skipSpace();
  if (sc.startsWith('<?xml') && !NAME_CHAR.test(sc.peek(5))) {
    const declStart = sc.pos;
    sc.pos += 5;
    const attrs = readAttributes(sc);
    sc.skipSpace();
    sc.expect('?>');
    declaration = {
      version: findAttr(attrs, 'version') ?? '1.0',
      encoding: findAttr(attrs, 'encoding'),
      standalone: findAttr(attrs, 'standalone'),
      raw: src.slice(declStart, sc.pos),
    };
  }

  const prolog: XmlNode[] = [];
  let root: XmlElement | undefined;
  const epilog: XmlNode[] = [];

  while (!sc.eof()) {
    const before = sc.pos;
    sc.skipSpace();
    if (sc.eof()) break;

    if (sc.startsWith('<!--')) {
      sc.pos += 4;
      (root ? epilog : prolog).push({ kind: 'comment', text: sc.readUntil('-->') });
      continue;
    }
    if (sc.startsWith('<!DOCTYPE')) {
      (root ? epilog : prolog).push({ kind: 'doctype', text: readDoctype(sc) });
      continue;
    }
    if (sc.startsWith('<?')) {
      sc.pos += 2;
      const target = sc.readName();
      const data = sc.readUntil('?>');
      (root ? epilog : prolog).push({ kind: 'pi', target, data: data.replace(/^[ \t\r\n]/, '') });
      continue;
    }
    if (sc.peek() === '<' && sc.peek(1) !== '/') {
      if (root) throw new XmlParseError('루트 요소가 두 개입니다', sc.pos);
      root = parseElement(sc);
      continue;
    }
    if (sc.pos === before) {
      throw new XmlParseError(`해석할 수 없는 내용: '${src.slice(sc.pos, sc.pos + 16)}'`, sc.pos);
    }
  }

  if (!root) throw new XmlParseError('루트 요소가 없습니다', 0);
  return { declaration, prolog, root, epilog };
}

function readDoctype(sc: Scanner): string {
  const start = sc.pos;
  let depth = 0;
  while (!sc.eof()) {
    const c = sc.peek();
    if (c === '[') depth += 1;
    else if (c === ']') depth -= 1;
    else if (c === '>' && depth <= 0) {
      sc.pos += 1;
      return sc.src.slice(start, sc.pos);
    }
    sc.pos += 1;
  }
  throw new XmlParseError('DOCTYPE 이 닫히지 않았습니다', start);
}

function readAttributes(sc: Scanner): XmlAttr[] {
  const attrs: XmlAttr[] = [];
  for (;;) {
    sc.skipSpace();
    const c = sc.peek();
    if (c === '' || c === '>' || c === '/' || c === '?') return attrs;
    const name = sc.readName();
    sc.skipSpace();
    sc.expect('=');
    sc.skipSpace();
    const quote = sc.peek();
    if (quote !== '"' && quote !== "'") {
      throw new XmlParseError(`속성 '${name}' 의 값이 인용부호로 감싸이지 않았습니다`, sc.pos);
    }
    sc.pos += 1;
    const raw = sc.readUntil(quote);
    attrs.push({ name, value: decodeEntities(raw), quote });
  }
}

function findAttr(attrs: XmlAttr[], name: string): string | undefined {
  return attrs.find((a) => a.name === name)?.value;
}

function parseElement(sc: Scanner): XmlElement {
  sc.expect('<');
  const name = sc.readName();
  const attrs = readAttributes(sc);
  sc.skipSpace();

  if (sc.startsWith('/>')) {
    sc.pos += 2;
    return { kind: 'element', name, attrs, children: [], selfClosed: true };
  }
  sc.expect('>');

  const children: XmlNode[] = [];
  for (;;) {
    if (sc.eof()) throw new XmlParseError(`<${name}> 가 닫히지 않았습니다`, sc.pos);

    if (sc.startsWith('</')) {
      sc.pos += 2;
      const close = sc.readName();
      if (close !== name) {
        throw new XmlParseError(`<${name}> 를 </${close}> 로 닫으려 했습니다`, sc.pos);
      }
      sc.skipSpace();
      sc.expect('>');
      return { kind: 'element', name, attrs, children, selfClosed: false };
    }
    if (sc.startsWith('<!--')) {
      sc.pos += 4;
      children.push({ kind: 'comment', text: sc.readUntil('-->') });
      continue;
    }
    if (sc.startsWith('<![CDATA[')) {
      sc.pos += 9;
      children.push({ kind: 'cdata', text: sc.readUntil(']]>') });
      continue;
    }
    if (sc.startsWith('<?')) {
      sc.pos += 2;
      const target = sc.readName();
      const data = sc.readUntil('?>');
      children.push({ kind: 'pi', target, data: data.replace(/^[ \t\r\n]/, '') });
      continue;
    }
    if (sc.peek() === '<') {
      children.push(parseElement(sc));
      continue;
    }

    const idx = sc.src.indexOf('<', sc.pos);
    const end = idx < 0 ? sc.src.length : idx;
    if (end === sc.pos) throw new XmlParseError('진행할 수 없습니다', sc.pos);
    children.push({ kind: 'text', text: decodeEntities(sc.src.slice(sc.pos, end)) });
    sc.pos = end;
  }
}
