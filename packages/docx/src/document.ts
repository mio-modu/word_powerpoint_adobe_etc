import {
  attr,
  childElements,
  element,
  emptyPageSetup,
  firstChild,
  hwpunit,
  isTable,
  textContent,
  type CharStyle,
  type DocMeta,
  type JamoBlock,
  type JamoParagraph,
  type JamoTable,
  type JamoTextDocument,
  type PageSetup,
  type ParagraphStyle,
  type XmlElement,
} from '@jamo/core';
import {
  DEFAULT_TEXT_WIDTH_TWIP,
  buildTable,
  cellParagraphs,
  insertColumn,
  insertRow,
  cellAt,
  cellGrid,
  mergeCells,
  readTable,
  removeColumn,
  removeRow,
  setCellShade,
  splitCell,
} from './table.js';
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
  setParagraphFormat,
  setParagraphRunStyle,
  setParagraphStyleName,
  setParagraphText,
  setRunStyle,
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

  // ------------------------------------------------------------------- 서식

  setRunStyle(run: XmlElement, patch: Partial<CharStyle>): void {
    setRunStyle(run, patch);
  }

  setParagraphRunStyle(p: XmlElement, patch: Partial<CharStyle>): void {
    setParagraphRunStyle(p, patch);
  }

  setParagraphFormat(p: XmlElement, patch: Partial<ParagraphStyle>): void {
    setParagraphFormat(p, patch);
  }

  runStyleOf(p: XmlElement): CharStyle | undefined {
    const run = paragraphRuns(p)[0];
    return run ? readCharStyle(run) : undefined;
  }

  paragraphStyleOf(p: XmlElement): ParagraphStyle | undefined {
    return readParagraphStyle(p);
  }

  // --------------------------------------------------------------------- 표

  /** 본문의 표들 (문서 순서, 중첩 포함). */
  tables(): XmlElement[] {
    const out: XmlElement[] = [];
    const walk = (el: XmlElement): void => {
      for (const child of el.children) {
        if (child.kind !== 'element') continue;
        if (child.name === 'w:tbl') out.push(child);
        walk(child);
      }
    };
    walk(this.body);
    return out;
  }

  /** 표를 넣는다. `after` 뒤, 없으면 본문 끝(sectPr 앞). */
  insertTable(
    rows: number,
    cols: number,
    options: { after?: XmlElement; text?: string[][]; width?: number } = {},
  ): XmlElement {
    if (rows < 1 || cols < 1) throw new DocxError('표는 최소 1줄 1칸이어야 합니다');
    const body = this.body;
    const tbl = buildTable({
      rows,
      cols,
      width: options.width ?? DEFAULT_TEXT_WIDTH_TWIP,
      text: options.text,
    });
    // 표 바로 뒤에는 문단이 있어야 커서를 둘 수 있고 Word 도 그걸 기대한다.
    const trailing = buildParagraph([{ text: '' }]);

    const insertAt = options.after
      ? body.children.indexOf(options.after) + 1
      : (() => {
          const sectPr = firstChild(body, 'w:sectPr');
          return sectPr ? body.children.indexOf(sectPr) : body.children.length;
        })();
    body.children.splice(Math.max(insertAt, 0), 0, tbl, trailing);
    body.selfClosed = false;
    return tbl;
  }

  removeTable(tbl: XmlElement): boolean {
    const body = this.body;
    const i = body.children.indexOf(tbl);
    if (i < 0) return false;
    body.children.splice(i, 1);
    return true;
  }

  static cells(tbl: XmlElement): XmlElement[][] {
    return childElements(tbl, 'w:tr').map((tr) =>
      childElements(tr, 'w:tc')
        .map((tc) => cellParagraphs(tc)[0])
        .filter((p): p is XmlElement => p !== undefined),
    );
  }

  static insertRow(tbl: XmlElement, afterRow: number): boolean {
    return insertRow(tbl, afterRow);
  }

  static removeRow(tbl: XmlElement, row: number): boolean {
    return removeRow(tbl, row);
  }

  static insertColumn(tbl: XmlElement, afterCol: number): boolean {
    return insertColumn(tbl, afterCol);
  }

  static removeColumn(tbl: XmlElement, col: number): boolean {
    return removeColumn(tbl, col);
  }

  static cellAt(tbl: XmlElement, row: number, col: number): XmlElement | undefined {
    return cellAt(tbl, row, col);
  }

  static grid(tbl: XmlElement): Array<Array<XmlElement | undefined>> {
    return cellGrid(tbl);
  }

  static mergeCells(tbl: XmlElement, r1: number, c1: number, r2: number, c2: number): boolean {
    return mergeCells(tbl, r1, c1, r2, c2);
  }

  static splitCell(tbl: XmlElement, row: number, col: number): boolean {
    return splitCell(tbl, row, col);
  }

  setCellShade(tbl: XmlElement, row: number, col: number, color: string | undefined): boolean {
    const tc = cellAt(tbl, row, col);
    if (!tc) return false;
    setCellShade(tc, color);
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
    return {
      kind: 'text',
      meta: this.meta,
      sections: [{ page: this.pageSetup, blocks: this.blocks() }],
    };
  }

  /** 본문을 문단·표 블록 목록으로. 표 안의 문단은 표 블록 안에 들어간다. */
  blocks(): JamoBlock[] {
    const out: JamoBlock[] = [];
    for (const child of childElements(this.body)) {
      if (child.name === 'w:p') out.push(paragraphModel(child));
      else if (child.name === 'w:tbl') out.push(tableModel(child));
    }
    return out;
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

    const appendBeforeSectPr = (node: XmlElement): void => {
      const marker = firstChild(body, 'w:sectPr');
      if (marker) body.children.splice(body.children.indexOf(marker), 0, node);
      else body.children.push(node);
    };

    for (const section of model.sections) {
      for (const block of section.blocks) {
        if (isTable(block)) {
          appendBeforeSectPr(tableFromModel(block));
          // Word 는 표와 표 사이, 표와 문서 끝 사이에 문단을 요구한다.
          // 없으면 표가 붙어버리거나 파일이 복구 대상이 된다.
          appendBeforeSectPr(buildParagraph([{ text: '' }]));
          continue;
        }
        appendBeforeSectPr(
          buildParagraph(
            block.runs.map((r) => ({ text: r.text, style: r.style })),
            block.style,
          ),
        );
      }
    }
    body.selfClosed = false;
    if (model.meta.creator) file.setMeta({ creator: model.meta.creator });
    return file;
  }
}

function paragraphModel(p: XmlElement): JamoParagraph {
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
}

function tableModel(tbl: XmlElement): JamoTable {
  const model = readTable(tbl);
  for (const row of model.rows) {
    for (const cell of row.cells) {
      const tc = cell.source as XmlElement | undefined;
      cell.paragraphs = tc ? cellParagraphs(tc).map(paragraphModel) : [];
      if (cell.paragraphs.length === 0) cell.paragraphs = [{ runs: [{ text: '' }] }];
    }
  }
  return model;
}

function tableFromModel(table: JamoTable): XmlElement {
  const colCount = Math.max(1, ...table.rows.map((r) => r.cells.length));
  const text = table.rows.map((row) =>
    Array.from({ length: colCount }, (_unused, c) =>
      (row.cells[c]?.paragraphs ?? [])
        .map((para) => para.runs.map((run) => run.text).join(''))
        .join('\n'),
    ),
  );
  const tbl = buildTable({
    rows: Math.max(table.rows.length, 1),
    cols: colCount,
    width: table.width ? hwpunit.toTwip(table.width) : DEFAULT_TEXT_WIDTH_TWIP,
    text,
  });
  // 칸 배경색을 옮긴다.
  const grid = cellGrid(tbl);
  table.rows.forEach((row, r) => {
    row.cells.forEach((cell) => {
      if (!cell.shade) return;
      const tc = grid[r]?.[cell.colAddr];
      if (tc) setCellShade(tc, cell.shade);
    });
  });
  return tbl;
}
