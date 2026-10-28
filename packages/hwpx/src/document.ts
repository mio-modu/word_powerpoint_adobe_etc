import {
  attr,
  attrInt,
  childElements,
  element,
  emptyPageSetup,
  entryToString,
  firstChild,
  looksLikeZip,
  parseXml,
  serializeXml,
  setAttr,
  setTextContent,
  stringToEntry,
  textContent,
  unzip,
  zip,
  type DocMeta,
  type JamoParagraph,
  type JamoRun,
  type JamoSection,
  type JamoTextDocument,
  type PageSetup,
  type XmlDocument,
  type XmlElement,
  type ZipEntries,
} from '@jamo/core';
import {
  blankContainerXml,
  blankContentHpf,
  blankHeaderXml,
  blankManifestXml,
  blankSectionXml,
  blankSettingsXml,
  blankVersionXml,
  defaultLineSegArray,
  type BlankOptions,
} from './blank.js';
import { ENTRY, ENTRY_ORDER, FILE_ID, MIME, sectionEntry, sectionId } from './constants.js';
import { StyleRegistry, fillSection } from './convert.js';
import { readPageSetup, readStyleTables, charStyleFrom, paragraphStyleFrom, type HwpxStyleTables } from './styles.js';

export class HwpxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HwpxError';
  }
}

/** 문단 하나를 가리키는 핸들. 원본 XML 요소를 그대로 들고 있다. */
export interface ParagraphHandle {
  sectionIndex: number;
  index: number;
  element: XmlElement;
}

/**
 * HWPX 파일 하나.
 *
 * 설계 원칙은 "건드린 것만 다시 쓴다" 다.
 * 우리가 해석하는 XML 파트는 파싱해 두고, BinData·Preview·차트처럼
 * 해석하지 않는 항목은 원본 바이트를 그대로 들고 있다가 저장할 때 복사한다.
 * 덕분에 한글에서 만든 복잡한 문서를 열어 글자 하나만 고쳐 저장해도
 * 나머지가 유실되지 않는다.
 */
export class HwpxFile {
  /** 원본 ZIP 항목 전체 (해석하지 않은 바이너리 포함). */
  private readonly entries: ZipEntries;
  /** 우리가 파싱해 둔 XML 파트. 저장 시 이쪽이 우선한다. */
  private readonly parsed = new Map<string, XmlDocument>();
  private styleTables: HwpxStyleTables | undefined;

  private constructor(entries: ZipEntries) {
    this.entries = entries;
  }

  // ---------------------------------------------------------------- 열기/만들기

  static open(data: Uint8Array): HwpxFile {
    if (!looksLikeZip(data)) {
      throw new HwpxError(
        'HWPX 파일이 아닙니다. 구형 .hwp(바이너리) 라면 @jamo/hwp5 로 여세요.',
      );
    }
    const entries = unzip(data);
    const mimetype = entryToString(entries, ENTRY.mimetype)?.trim();
    if (mimetype !== undefined && mimetype !== MIME.hwpx) {
      throw new HwpxError(`예상과 다른 mimetype 입니다: ${mimetype}`);
    }
    const file = new HwpxFile(entries);
    // content.hpf 는 어느 파트가 XML 인지 알려주는 지도다. 먼저 읽어야 한다.
    file.xml(ENTRY.contentHpf);
    for (const path of file.xmlPartPaths()) file.xml(path);
    return file;
  }

  static blank(opts: BlankOptions = {}): HwpxFile {
    const entries: ZipEntries = new Map();
    entries.set(ENTRY.mimetype, stringToEntry(MIME.hwpx));
    const file = new HwpxFile(entries);
    file.parsed.set(ENTRY.version, blankVersionXml(opts));
    file.parsed.set(ENTRY.manifest, blankManifestXml());
    file.parsed.set(ENTRY.container, blankContainerXml());
    file.parsed.set(ENTRY.contentHpf, blankContentHpf(opts));
    file.parsed.set(ENTRY.settings, blankSettingsXml());
    file.parsed.set(ENTRY.header, blankHeaderXml());
    file.parsed.set(sectionEntry(0), blankSectionXml(opts));
    return file;
  }


  /**
   * 중립 모델에서 HWPX 를 새로 만든다 (HWP 5.0 / DOCX → HWPX 변환 경로).
   *
   * 모델에 나오는 서로 다른 서식을 header.xml 표로 모은 뒤 본문이 그 번호를
   * 가리키게 한다. 같은 서식은 표를 재사용하므로 문단이 많아도 표가 커지지 않는다.
   */
  static fromModel(model: JamoTextDocument, opts: BlankOptions = {}): HwpxFile {
    const firstSection = model.sections[0];
    const paper = firstSection
      ? { width: firstSection.page.width, height: firstSection.page.height }
      : undefined;
    const file = HwpxFile.blank({ ...opts, paper });
    for (let i = 1; i < model.sections.length; i += 1) file.addSection({ paper });

    const refList = firstChild(file.header, 'hh:refList');
    if (!refList) throw new HwpxError('header.xml 에 hh:refList 가 없습니다');
    const fontfaces = firstChild(refList, 'hh:fontfaces');
    const charProperties = firstChild(refList, 'hh:charProperties');
    const paraProperties = firstChild(refList, 'hh:paraProperties');
    if (!fontfaces || !charProperties || !paraProperties) {
      throw new HwpxError('header.xml 의 참조 표가 불완전합니다');
    }
    const registry = new StyleRegistry(fontfaces, charProperties, paraProperties);

    model.sections.forEach((section, index) => {
      const root = file.sectionRoot(index);
      fillSection({ sectionRoot: root, registry }, section.paragraphs);
      applyPageSetup(root, section.page);
    });

    // header.xml 을 고쳤으므로 서식 표 캐시를 버린다.
    file.styleTables = undefined;
    if (Object.keys(model.meta).length > 0) file.setMeta(model.meta);
    return file;
  }

  // ------------------------------------------------------------------- 파트 접근

  /** 경로의 XML 파트를 파싱해 돌려준다 (캐시됨). */
  xml(path: string): XmlDocument | undefined {
    const cached = this.parsed.get(path);
    if (cached) return cached;
    const raw = entryToString(this.entries, path);
    if (raw === undefined) return undefined;
    let doc: XmlDocument;
    try {
      doc = parseXml(raw);
    } catch (cause) {
      throw new HwpxError(`${path} 를 파싱할 수 없습니다: ${(cause as Error).message}`);
    }
    this.parsed.set(path, doc);
    return doc;
  }

  /** content.hpf 매니페스트에서 XML 파트 경로를 모은다. */
  private xmlPartPaths(): string[] {
    const content = this.parsed.get(ENTRY.contentHpf);
    const out = new Set<string>([ENTRY.version, ENTRY.manifest, ENTRY.container]);
    if (!content) return [...out];
    const manifest = firstChild(content.root, 'opf:manifest');
    if (!manifest) return [...out];
    for (const item of childElements(manifest, 'opf:item')) {
      const href = attr(item, 'href');
      const mediaType = attr(item, 'media-type');
      if (href && mediaType === MIME.xml) out.add(href);
    }
    return [...out].filter((p) => this.entries.has(p));
  }

  get header(): XmlElement {
    const doc = this.xml(ENTRY.header);
    if (!doc) throw new HwpxError('Contents/header.xml 이 없습니다');
    return doc.root;
  }

  get content(): XmlElement {
    const doc = this.xml(ENTRY.contentHpf);
    if (!doc) throw new HwpxError('Contents/content.hpf 가 없습니다');
    return doc.root;
  }

  /** 섹션 파트 경로 목록 (content.hpf spine 순서). */
  sectionPaths(): string[] {
    const manifest = firstChild(this.content, 'opf:manifest');
    if (!manifest) return [];
    const byId = new Map<string, string>();
    for (const item of childElements(manifest, 'opf:item')) {
      const id = attr(item, 'id');
      const href = attr(item, 'href');
      if (id && href) byId.set(id, href);
    }
    const spine = firstChild(this.content, 'opf:spine');
    const ordered: string[] = [];
    if (spine) {
      for (const ref of childElements(spine, 'opf:itemref')) {
        const idref = attr(ref, 'idref');
        if (idref && idref.startsWith(FILE_ID.sectionPrefix)) {
          const href = byId.get(idref);
          if (href) ordered.push(href);
        }
      }
    }
    if (ordered.length > 0) return ordered;
    // spine 이 비어 있는 파일도 있다. 매니페스트 순서로 되돌린다.
    return [...byId.entries()]
      .filter(([id]) => id.startsWith(FILE_ID.sectionPrefix))
      .map(([, href]) => href);
  }

  get sectionCount(): number {
    return this.sectionPaths().length;
  }

  sectionRoot(index: number): XmlElement {
    const path = this.sectionPaths()[index];
    if (path === undefined) throw new HwpxError(`섹션 ${index} 이 없습니다`);
    const doc = this.xml(path);
    if (!doc) throw new HwpxError(`${path} 를 읽을 수 없습니다`);
    return doc.root;
  }

  get styles(): HwpxStyleTables {
    this.styleTables ??= readStyleTables(this.header);
    return this.styleTables;
  }

  /** 해석하지 않는 첨부 바이너리(이미지 등). */
  binaryEntries(): Map<string, Uint8Array> {
    const out = new Map<string, Uint8Array>();
    for (const [name, bytes] of this.entries) {
      if (this.parsed.has(name) || name === ENTRY.mimetype) continue;
      out.set(name, bytes);
    }
    return out;
  }

  // --------------------------------------------------------------------- 메타

  get meta(): DocMeta {
    const metadata = firstChild(this.content, 'opf:metadata');
    const meta: DocMeta = {};
    if (!metadata) return meta;
    const title = firstChild(metadata, 'opf:title');
    if (title) meta.title = textContent(title);
    const language = firstChild(metadata, 'opf:language');
    if (language) meta.language = textContent(language);
    for (const m of childElements(metadata, 'opf:meta')) {
      const name = attr(m, 'name');
      const value = textContent(m);
      switch (name) {
        case 'creator':
          meta.creator = value;
          break;
        case 'lastsaveby':
          meta.lastModifiedBy = value;
          break;
        case 'description':
          meta.description = value;
          break;
        case 'keyword':
          meta.keywords = value;
          break;
        case 'CreatedDate':
          meta.createdAt = value;
          break;
        case 'ModifiedDate':
          meta.modifiedAt = value;
          break;
      }
    }
    return meta;
  }

  setMeta(patch: DocMeta): void {
    const metadata = firstChild(this.content, 'opf:metadata');
    if (!metadata) throw new HwpxError('opf:metadata 가 없습니다');
    if (patch.title !== undefined) {
      const el = firstChild(metadata, 'opf:title') ?? pushChild(metadata, element('opf:title'));
      setTextContent(el, patch.title);
    }
    const metaByName: Array<[keyof DocMeta, string]> = [
      ['creator', 'creator'],
      ['lastModifiedBy', 'lastsaveby'],
      ['description', 'description'],
      ['keywords', 'keyword'],
      ['modifiedAt', 'ModifiedDate'],
    ];
    for (const [key, name] of metaByName) {
      const value = patch[key];
      if (value === undefined) continue;
      let el = childElements(metadata, 'opf:meta').find((m) => attr(m, 'name') === name);
      if (!el) {
        el = pushChild(metadata, element('opf:meta', { name, content: 'text' }));
      }
      setTextContent(el, String(value));
    }
  }

  // ----------------------------------------------------------------- 문단 편집

  paragraphs(sectionIndex: number): ParagraphHandle[] {
    return childElements(this.sectionRoot(sectionIndex), 'hp:p').map((el, index) => ({
      sectionIndex,
      index,
      element: el,
    }));
  }

  /** 문단의 평문. 여러 런에 걸쳐 있어도 이어붙인다. */
  static paragraphText(p: XmlElement): string {
    let out = '';
    for (const run of childElements(p, 'hp:run')) {
      for (const child of run.children) {
        if (child.kind !== 'element') continue;
        if (child.name === 'hp:t') out += textContent(child);
        // 탭과 강제 줄바꿈은 눈에 보이는 문자로 바꿔 준다.
        else if (child.name === 'hp:tab') out += '\t';
        else if (child.name === 'hp:lineBreak') out += '\n';
      }
    }
    return out;
  }

  /**
   * 문단 텍스트를 바꾼다.
   *
   * 여러 런으로 쪼개진 문단이라면 **첫 런의 서식으로 통일**된다.
   * 런별 서식을 지키며 고치려면 `setRunText` 를 쓸 것.
   */
  setParagraphText(p: XmlElement, text: string): void {
    const runs = childElements(p, 'hp:run');
    if (runs.length === 0) {
      const run = element('hp:run', { charPrIDRef: '0' }, [element('hp:t')]);
      p.children.push(run);
      setTextContent(firstChild(run, 'hp:t')!, text);
      return;
    }
    const [first, ...rest] = runs as [XmlElement, ...XmlElement[]];
    const t = firstChild(first, 'hp:t') ?? pushChild(first, element('hp:t'));
    setTextContent(t, text);
    // 첫 런의 나머지 hp:t 와 뒤따르는 런들의 텍스트를 비운다.
    for (const extra of childElements(first, 'hp:t')) {
      if (extra !== t) setTextContent(extra, '');
    }
    for (const run of rest) {
      for (const extra of childElements(run, 'hp:t')) setTextContent(extra, '');
    }
  }

  static runs(p: XmlElement): XmlElement[] {
    return childElements(p, 'hp:run');
  }

  /** 런 하나의 텍스트만 바꿔 다른 런의 서식을 보존한다. */
  static setRunText(run: XmlElement, text: string): void {
    const ts = childElements(run, 'hp:t');
    if (ts.length === 0) {
      setTextContent(pushChild(run, element('hp:t')), text);
      return;
    }
    setTextContent(ts[0]!, text);
    for (const extra of ts.slice(1)) setTextContent(extra, '');
  }

  /** 섹션 끝에 문단을 추가한다. 기존 문단의 서식을 물려받는다. */
  appendParagraph(sectionIndex: number, text: string, like?: XmlElement): XmlElement {
    const sec = this.sectionRoot(sectionIndex);
    const existing = childElements(sec, 'hp:p');
    const template = like ?? existing[existing.length - 1];
    const p = element(
      'hp:p',
      {
        id: String(nextParagraphId(existing)),
        paraPrIDRef: (template && attr(template, 'paraPrIDRef')) ?? '0',
        styleIDRef: (template && attr(template, 'styleIDRef')) ?? '0',
        pageBreak: 0,
        columnBreak: 0,
        merged: 0,
      },
      [
        element(
          'hp:run',
          { charPrIDRef: inheritedCharPrIdRef(template) ?? '0' },
          [element('hp:t', {}, text ? [{ kind: 'text', text }] : [])],
        ),
        defaultLineSegArray(),
      ],
    );
    sec.children.push(p);
    return p;
  }

  insertParagraphAfter(sectionIndex: number, ref: XmlElement, text: string): XmlElement {
    const sec = this.sectionRoot(sectionIndex);
    const p = this.appendParagraph(sectionIndex, text, ref);
    // appendParagraph 가 끝에 붙여놨으니 ref 바로 뒤로 옮긴다.
    sec.children.splice(sec.children.indexOf(p), 1);
    sec.children.splice(sec.children.indexOf(ref) + 1, 0, p);
    return p;
  }

  removeParagraph(sectionIndex: number, p: XmlElement): boolean {
    const sec = this.sectionRoot(sectionIndex);
    const i = sec.children.indexOf(p);
    if (i < 0) return false;
    // hp:secPr 를 품은 첫 문단을 지우면 섹션 설정이 날아간다. 내용만 비운다.
    const holdsSecPr = childElements(p, 'hp:run').some((r) => firstChild(r, 'hp:secPr'));
    if (holdsSecPr) {
      this.setParagraphText(p, '');
      return true;
    }
    sec.children.splice(i, 1);
    return true;
  }

  // -------------------------------------------------------------------- 모델화

  getText(): string {
    const out: string[] = [];
    for (let i = 0; i < this.sectionCount; i += 1) {
      for (const p of childElements(this.sectionRoot(i), 'hp:p')) {
        out.push(HwpxFile.paragraphText(p));
      }
    }
    return out.join('\n');
  }

  toModel(): JamoTextDocument {
    const tables = this.styles;
    const sections: JamoSection[] = [];
    for (let i = 0; i < this.sectionCount; i += 1) {
      const root = this.sectionRoot(i);
      sections.push({
        page: pageSetupOf(root),
        paragraphs: childElements(root, 'hp:p').map((p) => paragraphOf(p, tables)),
      });
    }
    return { kind: 'text', meta: this.meta, sections };
  }

  // --------------------------------------------------------------------- 저장

  save(): Uint8Array {
    const out: ZipEntries = new Map();
    out.set(ENTRY.mimetype, stringToEntry(MIME.hwpx));

    // 1) 우리가 고친 XML 파트
    for (const [path, doc] of this.parsed) {
      if (path === ENTRY.mimetype) continue;
      out.set(path, stringToEntry(serializeXml(doc)));
    }
    // 2) 손대지 않은 항목은 바이트 그대로
    for (const [path, bytes] of this.entries) {
      if (out.has(path)) continue;
      out.set(path, bytes);
    }

    return zip(out, {
      // OCF 규칙: mimetype 은 맨 앞 + 무압축.
      stored: [ENTRY.mimetype],
      order: ENTRY_ORDER,
    });
  }

  /** 섹션을 새로 추가하고 content.hpf·manifest 를 함께 갱신한다. */
  addSection(opts: BlankOptions = {}): number {
    const index = this.sectionCount;
    const href = sectionEntry(index);
    const id = sectionId(index);
    this.parsed.set(href, blankSectionXml(opts));

    const manifest = firstChild(this.content, 'opf:manifest');
    if (manifest) {
      manifest.children.push(element('opf:item', { id, href, 'media-type': MIME.xml }));
    }
    const spine = firstChild(this.content, 'opf:spine');
    if (spine) {
      spine.children.push(element('opf:itemref', { idref: id, linear: 'yes' }));
    }
    const odfManifest = this.xml(ENTRY.manifest)?.root;
    if (odfManifest) {
      odfManifest.children.push(
        element('odf:file-entry', { 'full-path': href, 'media-type': MIME.xml }),
      );
    }
    const head = this.header;
    setAttr(head, 'secCnt', String(index + 1));
    return index;
  }
}

function pushChild(parent: XmlElement, child: XmlElement): XmlElement {
  parent.children.push(child);
  parent.selfClosed = false;
  return child;
}

function nextParagraphId(existing: XmlElement[]): number {
  let max = 0;
  for (const p of existing) {
    const id = Number.parseInt(attr(p, 'id') ?? '0', 10);
    if (Number.isFinite(id) && id > max) max = id;
  }
  return max + 1;
}

function inheritedCharPrIdRef(template: XmlElement | undefined): string | undefined {
  if (!template) return undefined;
  const run = childElements(template, 'hp:run')[0];
  return run ? attr(run, 'charPrIDRef') : undefined;
}

function paragraphOf(p: XmlElement, tables: HwpxStyleTables): JamoParagraph {
  const runs: JamoRun[] = [];
  for (const run of childElements(p, 'hp:run')) {
    const charPrIDRef = attr(run, 'charPrIDRef');
    let text = '';
    for (const child of run.children) {
      if (child.kind !== 'element') continue;
      if (child.name === 'hp:t') text += textContent(child);
      else if (child.name === 'hp:tab') text += '\t';
      else if (child.name === 'hp:lineBreak') text += '\n';
    }
    if (text === '' && runs.length > 0) continue;
    runs.push({ text, style: charStyleFrom(tables, charPrIDRef), source: run });
  }
  if (runs.length === 0) runs.push({ text: '', source: undefined });
  return {
    runs,
    style: paragraphStyleFrom(tables, attr(p, 'paraPrIDRef'), attr(p, 'styleIDRef')),
    source: p,
  };
}

function pageSetupOf(sectionRoot: XmlElement): PageSetup {
  const base = emptyPageSetup();
  const secPr = readPageSetup(sectionRoot);
  if (!secPr) return base;
  const pagePr = firstChild(secPr, 'hp:pagePr');
  if (!pagePr) return base;
  const margin = firstChild(pagePr, 'hp:margin');
  return {
    width: attrInt(pagePr, 'width', base.width),
    height: attrInt(pagePr, 'height', base.height),
    landscape: attr(pagePr, 'landscape') === 'NARROWLY',
    margin: margin
      ? {
          left: attrInt(margin, 'left', base.margin.left),
          right: attrInt(margin, 'right', base.margin.right),
          top: attrInt(margin, 'top', base.margin.top),
          bottom: attrInt(margin, 'bottom', base.margin.bottom),
          header: attrInt(margin, 'header', base.margin.header),
          footer: attrInt(margin, 'footer', base.margin.footer),
          gutter: attrInt(margin, 'gutter', base.margin.gutter),
        }
      : base.margin,
  };
}

/** 모델의 용지 설정을 섹션의 hp:secPr 에 반영한다. */
function applyPageSetup(sectionRoot: XmlElement, page: PageSetup): void {
  const secPr = readPageSetup(sectionRoot);
  if (!secPr) return;
  const pagePr = firstChild(secPr, 'hp:pagePr');
  if (!pagePr) return;
  setAttr(pagePr, 'width', String(Math.round(page.width)));
  setAttr(pagePr, 'height', String(Math.round(page.height)));
  // HWPX 의 landscape 는 "용지를 어느 쪽으로 넓게 쓰는지"를 가리킨다.
  setAttr(pagePr, 'landscape', page.landscape ? 'NARROWLY' : 'WIDELY');
  const margin = firstChild(pagePr, 'hp:margin');
  if (!margin) return;
  const m = page.margin;
  for (const [name, value] of [
    ['left', m.left],
    ['right', m.right],
    ['top', m.top],
    ['bottom', m.bottom],
    ['header', m.header],
    ['footer', m.footer],
    ['gutter', m.gutter],
  ] as const) {
    setAttr(margin, name, String(Math.round(value)));
  }
}
