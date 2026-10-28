import {
  attr,
  childElements,
  element,
  entryToString,
  looksLikeCfb,
  looksLikeZip,
  parseXml,
  serializeXml,
  setAttr,
  stringToEntry,
  unzip,
  zip,
  type XmlDocument,
  type XmlElement,
  type ZipEntries,
} from '@jamo/core';
import { CONTENT_TYPES_PART, CT, PKG_NS } from './constants.js';
import {
  dirname,
  extension,
  isRelsPart,
  normalizePart,
  relativeTo,
  relsPartFor,
  resolveRelative,
} from './paths.js';

export class OpcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpcError';
  }
}

export interface Relationship {
  id: string;
  type: string;
  /** 출처 파트 기준 상대 경로 (원본 그대로). */
  target: string;
  targetMode?: string;
  /** 패키지 루트 기준으로 해석한 파트 이름. 외부 링크면 undefined. */
  resolved?: string;
}

/**
 * OPC 패키지.
 *
 * HWPX 와 같은 원칙: 해석한 XML 파트만 다시 쓰고, 나머지는 원본 바이트를
 * 그대로 복사한다. Word/PowerPoint 문서는 테마·폰트·이미지·차트가 얽혀
 * 있어서 "모르는 건 건드리지 않는" 규칙이 특히 중요하다.
 */
export class OpcPackage {
  private readonly entries: ZipEntries;
  private readonly parsed = new Map<string, XmlDocument>();

  private constructor(entries: ZipEntries) {
    this.entries = entries;
  }

  static open(data: Uint8Array): OpcPackage {
    if (looksLikeCfb(data)) {
      throw new OpcError(
        '구형 바이너리 형식(.doc/.ppt)입니다. OOXML(.docx/.pptx)만 지원합니다.',
      );
    }
    if (!looksLikeZip(data)) throw new OpcError('OOXML 패키지(ZIP)가 아닙니다.');
    const pkg = new OpcPackage(unzip(data));
    if (!pkg.entries.has(CONTENT_TYPES_PART)) {
      throw new OpcError('[Content_Types].xml 이 없습니다. 올바른 OOXML 파일이 아닙니다.');
    }
    return pkg;
  }

  static create(): OpcPackage {
    const pkg = new OpcPackage(new Map());
    pkg.parsed.set(
      CONTENT_TYPES_PART,
      wrap(
        element('Types', { xmlns: PKG_NS.contentTypes }, [
          element('Default', { Extension: 'rels', ContentType: CT.rels }),
          element('Default', { Extension: 'xml', ContentType: CT.xml }),
        ]),
      ),
    );
    pkg.parsed.set(
      '_rels/.rels',
      wrap(element('Relationships', { xmlns: PKG_NS.relationships })),
    );
    return pkg;
  }

  // ------------------------------------------------------------------ 파트 접근

  has(partName: string): boolean {
    const p = normalizePart(partName);
    return this.parsed.has(p) || this.entries.has(p);
  }

  partNames(): string[] {
    const names = new Set<string>([...this.entries.keys(), ...this.parsed.keys()]);
    return [...names].sort();
  }

  bytes(partName: string): Uint8Array | undefined {
    const p = normalizePart(partName);
    const doc = this.parsed.get(p);
    if (doc) return stringToEntry(serializeXml(doc));
    return this.entries.get(p);
  }

  xml(partName: string): XmlDocument | undefined {
    const p = normalizePart(partName);
    const cached = this.parsed.get(p);
    if (cached) return cached;
    const raw = entryToString(this.entries, p);
    if (raw === undefined) return undefined;
    let doc: XmlDocument;
    try {
      doc = parseXml(raw);
    } catch (cause) {
      throw new OpcError(`${p} 를 파싱할 수 없습니다: ${(cause as Error).message}`);
    }
    this.parsed.set(p, doc);
    return doc;
  }

  /** 파트를 XML 로 가져오되, 없으면 예외. */
  requireXml(partName: string): XmlDocument {
    const doc = this.xml(partName);
    if (!doc) throw new OpcError(`${partName} 파트가 없습니다`);
    return doc;
  }

  setXml(partName: string, doc: XmlDocument, contentType?: string): void {
    const p = normalizePart(partName);
    this.parsed.set(p, doc);
    if (contentType) this.setContentType(p, contentType);
  }

  setBytes(partName: string, data: Uint8Array, contentType?: string): void {
    const p = normalizePart(partName);
    this.parsed.delete(p);
    this.entries.set(p, data);
    if (contentType) this.setContentType(p, contentType);
  }

  removePart(partName: string): void {
    const p = normalizePart(partName);
    this.parsed.delete(p);
    this.entries.delete(p);
    const rels = relsPartFor(p);
    this.parsed.delete(rels);
    this.entries.delete(rels);
    const types = this.contentTypesRoot();
    const override = childElements(types, 'Override').find(
      (o) => attr(o, 'PartName') === `/${p}`,
    );
    if (override) types.children.splice(types.children.indexOf(override), 1);
  }

  // ------------------------------------------------------------- 콘텐츠 타입

  private contentTypesRoot(): XmlElement {
    return this.requireXml(CONTENT_TYPES_PART).root;
  }

  contentType(partName: string): string | undefined {
    const p = normalizePart(partName);
    const types = this.contentTypesRoot();
    const override = childElements(types, 'Override').find(
      (o) => attr(o, 'PartName') === `/${p}`,
    );
    if (override) return attr(override, 'ContentType');
    const ext = extension(p);
    const def = childElements(types, 'Default').find(
      (d) => (attr(d, 'Extension') ?? '').toLowerCase() === ext,
    );
    return def ? attr(def, 'ContentType') : undefined;
  }

  /** Override 를 추가/갱신한다. 확장자 Default 로 충분하면 건드리지 않는다. */
  setContentType(partName: string, contentType: string): void {
    const p = normalizePart(partName);
    const types = this.contentTypesRoot();
    const ext = extension(p);
    const def = childElements(types, 'Default').find(
      (d) => (attr(d, 'Extension') ?? '').toLowerCase() === ext,
    );
    if (def && attr(def, 'ContentType') === contentType) return;

    const existing = childElements(types, 'Override').find(
      (o) => attr(o, 'PartName') === `/${p}`,
    );
    if (existing) setAttr(existing, 'ContentType', contentType);
    else {
      types.children.push(element('Override', { PartName: `/${p}`, ContentType: contentType }));
      types.selfClosed = false;
    }
  }

  ensureDefaultContentType(ext: string, contentType: string): void {
    const types = this.contentTypesRoot();
    const lower = ext.toLowerCase();
    const found = childElements(types, 'Default').find(
      (d) => (attr(d, 'Extension') ?? '').toLowerCase() === lower,
    );
    if (found) return;
    // Default 는 Override 보다 앞에 와야 스키마를 만족한다.
    const firstOverride = childElements(types, 'Override')[0];
    const node = element('Default', { Extension: lower, ContentType: contentType });
    if (firstOverride) types.children.splice(types.children.indexOf(firstOverride), 0, node);
    else types.children.push(node);
    types.selfClosed = false;
  }

  // ----------------------------------------------------------------- 관계

  /** `sourcePart` 의 관계 목록. 패키지 루트는 `''`. */
  relationships(sourcePart = ''): Relationship[] {
    const relsPart = relsPartFor(sourcePart);
    const doc = this.xml(relsPart);
    if (!doc) return [];
    const baseDir = dirname(normalizePart(sourcePart));
    return childElements(doc.root, 'Relationship').map((rel) => {
      const target = attr(rel, 'Target') ?? '';
      const targetMode = attr(rel, 'TargetMode');
      return {
        id: attr(rel, 'Id') ?? '',
        type: attr(rel, 'Type') ?? '',
        target,
        targetMode,
        resolved: targetMode === 'External' ? undefined : resolveRelative(baseDir, target),
      };
    });
  }

  /** 주어진 타입의 첫 관계가 가리키는 파트 이름. */
  relatedPart(sourcePart: string, relType: string): string | undefined {
    return this.relationships(sourcePart).find((r) => r.type === relType)?.resolved;
  }

  relatedParts(sourcePart: string, relType: string): string[] {
    return this.relationships(sourcePart)
      .filter((r) => r.type === relType && r.resolved !== undefined)
      .map((r) => r.resolved!);
  }

  /** 관계를 추가하고 새 rId 를 돌려준다. */
  addRelationship(
    sourcePart: string,
    relType: string,
    targetPart: string,
    targetMode?: 'External',
  ): string {
    const relsPart = relsPartFor(sourcePart);
    let doc = this.xml(relsPart);
    if (!doc) {
      doc = wrap(element('Relationships', { xmlns: PKG_NS.relationships }));
      this.parsed.set(relsPart, doc);
    }
    const used = new Set(childElements(doc.root, 'Relationship').map((r) => attr(r, 'Id')));
    let n = used.size + 1;
    while (used.has(`rId${n}`)) n += 1;
    const id = `rId${n}`;
    const target =
      targetMode === 'External' ? targetPart : relativeTo(normalizePart(sourcePart), targetPart);
    doc.root.children.push(
      element('Relationship', {
        Id: id,
        Type: relType,
        Target: target,
        TargetMode: targetMode,
      }),
    );
    doc.root.selfClosed = false;
    return id;
  }

  /** rId 로 파트를 찾는다. 이미지·슬라이드 참조를 따라갈 때 쓴다. */
  resolveRelationshipId(sourcePart: string, id: string): string | undefined {
    return this.relationships(sourcePart).find((r) => r.id === id)?.resolved;
  }

  /** 패키지의 본문 파트 (word/document.xml, ppt/presentation.xml 등). */
  mainPart(relType: string): string | undefined {
    return this.relatedPart('', relType);
  }

  // ---------------------------------------------------------------- 저장

  save(): Uint8Array {
    const out: ZipEntries = new Map();
    // [Content_Types].xml 이 선두에 오는 편이 읽는 쪽에 친절하다.
    const order = [CONTENT_TYPES_PART, '_rels/.rels'];
    for (const [path, doc] of this.parsed) {
      out.set(path, stringToEntry(serializeXml(doc)));
    }
    for (const [path, bytes] of this.entries) {
      if (out.has(path)) continue;
      out.set(path, bytes);
    }
    for (const name of out.keys()) {
      if (isRelsPart(name) && !this.parsed.has(name) && !this.entries.has(name)) out.delete(name);
    }
    return zip(out, { order });
  }
}

function wrap(root: XmlElement): XmlDocument {
  return {
    declaration: { version: '1.0', encoding: 'UTF-8', standalone: 'yes' },
    prolog: [],
    root,
    epilog: [],
  };
}

export { wrap as xmlDocumentOf };
