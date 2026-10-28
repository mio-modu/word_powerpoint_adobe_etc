/**
 * 무손실(lossless) XML 트리.
 *
 * 문서 편집기에서 가장 중요한 건 "모르는 것을 건드리지 않는 것"이다.
 * HWPX/OOXML 은 스펙이 방대해서 전부 타입으로 모델링하는 건 비현실적이고,
 * 모델링하지 못한 요소를 버리면 남의 문서를 조용히 파괴한다.
 *
 * 그래서 이 레이어는 XML 을 "있는 그대로" 보존하는 제네릭 트리만 제공하고,
 * 의미 해석은 상위 패키지(@jamo/hwpx 등)의 타입드 뷰가 담당한다.
 *
 * - 속성은 배열로 보관해 **순서를 보존**한다.
 * - 네임스페이스 접두사는 분해하지 않고 `name` 에 그대로 둔다 (`hp:t`).
 *   HWPX 는 접두사가 사실상 고정이고, 분해/재조립은 손실 위험만 키운다.
 * - 빈 요소가 `<a/>` 였는지 `<a></a>` 였는지도 기억해 바이트 수준 왕복을 가능하게 한다.
 */

export interface XmlAttr {
  readonly name: string;
  value: string;
  /** 원본에서 쓰인 인용부호. 왕복 시 그대로 재사용한다. */
  quote?: '"' | "'";
}

export interface XmlElement {
  kind: 'element';
  name: string;
  attrs: XmlAttr[];
  children: XmlNode[];
  /** 파싱 당시 `<a/>` 형태였는지. 쓰기 시 빈 요소의 표기를 결정한다. */
  selfClosed?: boolean;
}

export interface XmlText {
  kind: 'text';
  /** 엔티티가 해석된 실제 문자열. */
  text: string;
}

export interface XmlCData {
  kind: 'cdata';
  text: string;
}

export interface XmlComment {
  kind: 'comment';
  text: string;
}

/** `<?target data?>` (XML 선언 제외). */
export interface XmlPI {
  kind: 'pi';
  target: string;
  data: string;
}

export interface XmlDoctype {
  kind: 'doctype';
  /** `<!DOCTYPE ...>` 내부를 그대로 보관. */
  text: string;
}

export type XmlNode = XmlElement | XmlText | XmlCData | XmlComment | XmlPI | XmlDoctype;

export interface XmlDeclaration {
  version: string;
  encoding?: string;
  standalone?: string;
}

export interface XmlDocument {
  /** `<?xml ... ?>`. 없으면 undefined. */
  declaration?: XmlDeclaration;
  /** 루트 이전/이후에 나온 주석·PI 까지 포함한 최상위 노드 목록. */
  prolog: XmlNode[];
  root: XmlElement;
  epilog: XmlNode[];
}

export class XmlParseError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(`${message} (offset ${offset})`);
    this.name = 'XmlParseError';
  }
}
