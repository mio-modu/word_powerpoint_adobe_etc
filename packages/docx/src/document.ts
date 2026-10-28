import {
  attr,
  childElements,
  element,
  emptyPageSetup,
  firstChild,
  hwpunit,
  textContent,
  type DocMeta,
  type JamoParagraph,
  type JamoTextDocument,
  type PageSetup,
  type XmlElement,
} from '@jamo/core';
import { CT, OpcError, OpcPackage, REL } from '@jamo/opc';
import {
  A4_TWIP,
  PART,
  blankAppPropsXml,
  blankCorePropsXml,
  blankDocumentXml,
  blankSettingsXml,
  blankStylesXml,
  sectionProperties,
  type BlankDocxOptions,
} from './blank.js';
import {
  bodyParagraphs,
  buildParagraph,
  paragraphRuns,
  paragraphText,
  readCharStyle,
  readParagraphStyle,
  setParagraphStyleName,
  setParagraphText,
  setRunText,
} from './wordml.js';

export class DocxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocxError';
  }
}

/**
 * DOCX 문서 하나.
 *
 * OPC 패키지를 그대로 들고 있으므로, 우리가 모르는 파트(테마, 차트, 이미지,
 * 추적 변경 기록 등)는 손대지 않고 보존된다. 텍스트 한 줄만 고쳐 저장해도
 * Word 에서 열었을 때 나머지가 그대로다.
 */
export class DocxFile {
  readonly pkg: OpcPackage;
  readonly documentPart: string;

  private constructor(pkg: OpcPackage, documentPart: string) {
    this.pkg = pkg;
    this.documentPart = documentPart;
  }

  static open(data: Uint8Array): DocxFile {
    let pkg: OpcPackage;
    try {
      pkg = OpcPackage.open(data);
    } catch (cause) {
      if (cause instanceof OpcError) throw new DocxError(cause.message);
      throw cause;
    }
    const main = pkg.mainPart(REL.officeDocument);
    if (!main) throw new DocxError('본문 파트(officeDocument 관계)를 찾을 수 없습니다.');
    const doc = pkg.xml(main);
    if (!doc) throw new DocxError(`${main} 를 읽을 수 없습니다.`);
    if (doc.root.name !== 'w:document') {
      throw new DocxError(
        `Word 문서가 아닙니다 (루트 요소: ${doc.root.name}). PPTX 라면 @jamo/pptx 로 여세요.`,
      );
    }
    return new DocxFile(pkg, main);
  }

  static blank(opts: BlankDocxOptions = {}): DocxFile {
    const pkg = OpcPackage.create();
    pkg.setXml(PART.document, blankDocumentXml(opts), CT.wordDocument);
    pkg.setXml(PART.styles, blankStylesXml(opts), CT.wordStyles);
    pkg.setXml(PART.settings, blankSettingsXml(), CT.wordSettings);
    pkg.setXml(PART.core, blankCorePropsXml(opts), CT.coreProperties);
    pkg.setXml(PART.app, blankAppPropsXml(opts), CT.extendedProperties);

    pkg.addRelationship('', REL.officeDocument, PART.document);
    pkg.addRelationship('', REL.coreProperties, PART.core);
    pkg.addRelationship('', REL.extendedProperties, PART.app);
    pkg.addRelationship(PART.document, REL.styles, PART.styles);
    pkg.addRelationship(PART.document, REL.settings, PART.settings);

    return new DocxFile(pkg, PART.document);
  }

  save(): Uint8Array {
    return this.pkg.save();
  }

  // -------------------------------------------------------------------- 본문

  get root(): XmlElement {
    return this.pkg.requireXml(this.documentPart).root;
  }

  get body(): XmlElement {
    const body = firstChild(this.root, 'w:body');
    if (!body) throw new DocxError('w:body 가 없습니다.');
    return body;
  }

  /** 본문 최상위 문단. 표 안의 문단은 `allParagraphs()` 로. */
  paragraphs(): XmlElement[] {
    return bodyParagraphs(this.body);
  }

  /** 표 셀 안쪽까지 포함한 모든 문단 (문서 순서). */
  allParagraphs(): XmlElement[] {
    const out: XmlElement[] = [];
    const walk = (el: XmlElement): void => {
      for (const child of el.children) {
        if (child.kind !== 'element') continue;
        if (child.name === 'w:p') {
          out.push(child);
          continue;
        }
        if (child.name === 'w:pPr' || child.name === 'w:rPr') continue;
        walk(child);
      }
    };
    walk(this.body);
    return out;
  }

  static text(p: XmlElement): string {
    return paragraphText(p);
  }

  static runs(p: XmlElement): XmlElement[] {
    return paragraphRuns(p);
  }

  static setRunText(run: XmlElement, value: string): void {
    setRunText(run, value);
  }

  setParagraphText(p: XmlElement, value: string): void {
    setParagraphText(p, value);
  }

  setParagraphStyle(p: XmlElement, styleId: string): void {
    setParagraphStyleName(p, styleId);
  }

  /**
   * 문단을 본문 끝에 붙인다.
   *
   * `w:sectPr` 는 본문의 **마지막 자식**이어야 하므로 그 앞에 넣는다.
   * 뒤에 붙이면 Word 가 파일을 복구 대상으로 본다.
   */
  appendParagraph(text: string, styleId?: string): XmlElement {
    const body = this.body;
    const p = buildParagraph([{ text }], styleId ? { styleName: styleId } : undefined);
    const sectPr = firstChild(body, 'w:sectPr');
    if (sectPr) body.children.splice(body.children.indexOf(sectPr), 0, p);
    else body.children.push(p);
    body.selfClosed = false;
    return p;
  }

  insertParagraphAfter(ref: XmlElement, text: string, styleId?: string): XmlElement {
    const body = this.body;
    const p = buildParagraph([{ text }], styleId ? { styleName: styleId } : undefined);
    const i = body.children.indexOf(ref);
    if (i < 0) return this.appendParagraph(text, styleId);
    body.children.splice(i + 1, 0, p);
    return p;
  }

  removeParagraph(p: XmlElement): boolean {
    const body = this.body;
    const i = body.children.indexOf(p);
    if (i < 0) return false;
    body.children.splice(i, 1);
    return true;
  }

  getText(): string {
    return this.allParagraphs().map(paragraphText).join('\n');
  }

  // ------------------------------------------------------------------ 메타

  get meta(): DocMeta {
    const core = this.pkg.relatedPart('', REL.coreProperties);
    const meta: DocMeta = {};
    if (!core) return meta;
    const root = this.pkg.xml(core)?.root;
    if (!root) return meta;
    const read = (name: string): string | undefined => {
      const el = firstChild(root, name);
      return el ? textContent(el) : undefined;
    };
    meta.title = read('dc:title');
    meta.creator = read('dc:creator');
    meta.description = read('dc:description');
    meta.keywords = read('cp:keywords');
    meta.lastModifiedBy = read('cp:lastModifiedBy');
    meta.createdAt = read('dcterms:created');
    meta.modifiedAt = read('dcterms:modified');
    return meta;
  }

  setMeta(patch: DocMeta): void {
    const core = this.pkg.relatedPart('', REL.coreProperties);
    if (!core) throw new DocxError('docProps/core.xml 이 없습니다.');
    const root = this.pkg.xml(core)!.root;
    const fields: Array<[keyof DocMeta, string]> = [
      ['title', 'dc:title'],
      ['creator', 'dc:creator'],
      ['description', 'dc:description'],
      ['keywords', 'cp:keywords'],
      ['lastModifiedBy', 'cp:lastModifiedBy'],
    ];
    for (const [key, name] of fields) {
      const value = patch[key];
      if (value === undefined) continue;
      let el = firstChild(root, name);
      if (!el) {
        el = element(name);
        root.children.push(el);
        root.selfClosed = false;
      }
      el.children = [{ kind: 'text', text: String(value) }];
      el.selfClosed = false;
    }
  }

  // ----------------------------------------------------------------- 모델화

  get pageSetup(): PageSetup {
    const base = emptyPageSetup();
    const sectPr = firstChild(this.body, 'w:sectPr');
    if (!sectPr) return base;
    const pgSz = firstChild(sectPr, 'w:pgSz');
    const pgMar = firstChild(sectPr, 'w:pgMar');
    const t = (el: XmlElement | undefined, name: string, fallback: number): number => {
      if (!el) return fallback;
      const raw = attr(el, name);
      if (raw === undefined) return fallback;
      const n = Number.parseInt(raw, 10);
      return Number.isFinite(n) ? hwpunit.fromTwip(n) : fallback;
    };
    return {
      width: t(pgSz, 'w:w', hwpunit.fromTwip(A4_TWIP.width)),
      height: t(pgSz, 'w:h', hwpunit.fromTwip(A4_TWIP.height)),
      landscape: pgSz !== undefined && attr(pgSz, 'w:orient') === 'landscape',
      margin: {
        left: t(pgMar, 'w:left', base.margin.left),
        right: t(pgMar, 'w:right', base.margin.right),
        top: t(pgMar, 'w:top', base.margin.top),
        bottom: t(pgMar, 'w:bottom', base.margin.bottom),
        header: t(pgMar, 'w:header', base.margin.header),
        footer: t(pgMar, 'w:footer', base.margin.footer),
        gutter: t(pgMar, 'w:gutter', base.margin.gutter),
      },
    };
  }

  toModel(): JamoTextDocument {
    const paragraphs: JamoParagraph[] = this.allParagraphs().map((p) => {
      const runs = paragraphRuns(p).map((run) => ({
        text: paragraphText(run),
        style: readCharStyle(run),
        source: run,
      }));
      return {
        runs: runs.length > 0 ? runs : [{ text: '', source: undefined }],
        style: readParagraphStyle(p),
        source: p,
      };
    });
    return {
      kind: 'text',
      meta: this.meta,
      sections: [{ page: this.pageSetup, paragraphs }],
    };
  }

  /** 중립 모델에서 DOCX 를 새로 만든다 (HWPX → DOCX 변환 경로). */
  static fromModel(model: JamoTextDocument, opts: BlankDocxOptions = {}): DocxFile {
    const file = DocxFile.blank({ ...opts, title: model.meta.title ?? opts.title });
    const body = file.body;
    const sectPr = firstChild(body, 'w:sectPr');
    // blank() 가 넣어둔 빈 문단을 치운다.
    body.children = sectPr ? [sectPr] : [];

    const first = model.sections[0];
    if (first) {
      const page = first.page;
      const replacement = sectionProperties(
        { width: hwpunit.toTwip(page.width), height: hwpunit.toTwip(page.height) },
        page.landscape,
      );
      if (sectPr) body.children[body.children.indexOf(sectPr)] = replacement;
      else body.children.push(replacement);
    }

    for (const section of model.sections) {
      for (const para of section.paragraphs) {
        const p = buildParagraph(
          para.runs.map((r) => ({ text: r.text, style: r.style })),
          para.style,
        );
        const marker = firstChild(body, 'w:sectPr');
        if (marker) body.children.splice(body.children.indexOf(marker), 0, p);
        else body.children.push(p);
      }
    }
    body.selfClosed = false;
    if (model.meta.creator) file.setMeta({ creator: model.meta.creator });
    return file;
  }
}
