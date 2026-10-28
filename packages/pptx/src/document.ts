import {
  attr,
  childElements,
  descendants,
  element,
  emu,
  firstChild,
  hwpunit,
  parseXml,
  textContent,
  type DocMeta,
  type JamoPresentation,
  type CharStyle,
  type JamoShape,
  type JamoSlide,
  type XmlElement,
} from '@jamo/core';
import { CT, OpcError, OpcPackage, REL } from '@jamo/opc';
import {
  PART,
  SLIDE_SIZE_16_9,
  emptySlideXml,
  presPropsXml,
  presentationXml,
  slideLayoutXml,
  slideMasterXml,
  slidePart,
  tableStylesXml,
  themeXml,
  viewPropsXml,
} from './templates.js';
import {
  buildParagraph,
  buildRunProps,
  buildTextBox,
  paragraphRuns,
  paragraphText,
  readFrame,
  readPlaceholder,
  readRunStyle,
  readShapeName,
  readParagraphStyle,
  runText,
  setParagraphText,
  setRunText,
  shapeParagraphs,
  type ShapeFrame,
} from './presentationml.js';

export class PptxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PptxError';
  }
}

export interface BlankPptxOptions {
  /** 슬라이드 크기 (EMU). 기본 16:9. */
  slideSize?: { width: number; height: number };
  title?: string;
  creator?: string;
  application?: string;
  fontFamily?: string;
}

/**
 * PPTX 프레젠테이션 하나.
 *
 * 슬라이드는 `ppt/presentation.xml` 의 `p:sldIdLst` 순서가 진짜 순서이고,
 * 파일 이름(slide1, slide2 …)은 순서를 보장하지 않는다. 슬라이드를 지우거나
 * 옮기면 이름과 순서가 어긋나므로, 항상 sldIdLst → r:id → 관계 로 따라간다.
 */
export class PptxFile {
  readonly pkg: OpcPackage;
  readonly presentationPart: string;

  private constructor(pkg: OpcPackage, presentationPart: string) {
    this.pkg = pkg;
    this.presentationPart = presentationPart;
  }

  static open(data: Uint8Array): PptxFile {
    let pkg: OpcPackage;
    try {
      pkg = OpcPackage.open(data);
    } catch (cause) {
      if (cause instanceof OpcError) throw new PptxError(cause.message);
      throw cause;
    }
    const main = pkg.mainPart(REL.officeDocument);
    if (!main) throw new PptxError('본문 파트(officeDocument 관계)를 찾을 수 없습니다.');
    const root = pkg.xml(main)?.root;
    if (!root) throw new PptxError(`${main} 를 읽을 수 없습니다.`);
    if (root.name !== 'p:presentation') {
      throw new PptxError(
        `PowerPoint 파일이 아닙니다 (루트 요소: ${root.name}). DOCX 라면 @jamo/docx 로 여세요.`,
      );
    }
    return new PptxFile(pkg, main);
  }

  static blank(opts: BlankPptxOptions = {}): PptxFile {
    const size = opts.slideSize ?? SLIDE_SIZE_16_9;
    const pkg = OpcPackage.create();
    const put = (part: string, xml: string, ct: string): void => {
      pkg.setXml(part, parseXml(xml), ct);
    };

    put(PART.presentation, presentationXml(1, size), CT.presentation);
    put(PART.slideMaster, slideMasterXml(), CT.slideMaster);
    put(PART.slideLayout, slideLayoutXml(), CT.slideLayout);
    put(PART.theme, themeXml({ majorFont: opts.fontFamily, minorFont: opts.fontFamily }), CT.theme);
    put(PART.presProps, presPropsXml(), CT.presProps);
    put(PART.viewProps, viewPropsXml(), CT.viewProps);
    put(PART.tableStyles, tableStylesXml(), CT.tableStyles);
    put(slidePart(1), emptySlideXml(), CT.slide);
    pkg.setXml(PART.core, coreProps(opts), CT.coreProperties);
    pkg.setXml(PART.app, appProps(opts), CT.extendedProperties);

    // 패키지 루트 관계
    pkg.addRelationship('', REL.officeDocument, PART.presentation);
    pkg.addRelationship('', REL.coreProperties, PART.core);
    pkg.addRelationship('', REL.extendedProperties, PART.app);

    // presentation.xml 의 관계 순서는 템플릿의 rId 가정과 맞아야 한다:
    // rId1 = slideMaster, rId2 = slide1, 그 다음부터 나머지.
    pkg.addRelationship(PART.presentation, REL.slideMaster, PART.slideMaster);
    pkg.addRelationship(PART.presentation, REL.slide, slidePart(1));
    pkg.addRelationship(PART.presentation, REL.presProps, PART.presProps);
    pkg.addRelationship(PART.presentation, REL.viewProps, PART.viewProps);
    pkg.addRelationship(PART.presentation, REL.theme, PART.theme);
    pkg.addRelationship(PART.presentation, REL.tableStyles, PART.tableStyles);

    pkg.addRelationship(PART.slideMaster, REL.slideLayout, PART.slideLayout);
    pkg.addRelationship(PART.slideMaster, REL.theme, PART.theme);
    pkg.addRelationship(PART.slideLayout, REL.slideMaster, PART.slideMaster);
    pkg.addRelationship(slidePart(1), REL.slideLayout, PART.slideLayout);

    return new PptxFile(pkg, PART.presentation);
  }

  save(): Uint8Array {
    return this.pkg.save();
  }

  get root(): XmlElement {
    return this.pkg.requireXml(this.presentationPart).root;
  }

  // --------------------------------------------------------------- 슬라이드

  /** 표시 순서대로의 슬라이드 파트 경로. */
  slidePaths(): string[] {
    const lst = firstChild(this.root, 'p:sldIdLst');
    if (!lst) return [];
    const out: string[] = [];
    for (const sldId of childElements(lst, 'p:sldId')) {
      const rid = attr(sldId, 'r:id');
      if (!rid) continue;
      const part = this.pkg.resolveRelationshipId(this.presentationPart, rid);
      if (part) out.push(part);
    }
    return out;
  }

  get slideCount(): number {
    return this.slidePaths().length;
  }

  slideRoot(index: number): XmlElement {
    const part = this.slidePaths()[index];
    if (part === undefined) throw new PptxError(`슬라이드 ${index} 이 없습니다`);
    const root = this.pkg.xml(part)?.root;
    if (!root) throw new PptxError(`${part} 를 읽을 수 없습니다`);
    return root;
  }

  /** 슬라이드의 도형 트리. */
  shapeTree(index: number): XmlElement {
    const cSld = firstChild(this.slideRoot(index), 'p:cSld');
    const spTree = cSld && firstChild(cSld, 'p:spTree');
    if (!spTree) throw new PptxError(`슬라이드 ${index} 에 p:spTree 가 없습니다`);
    return spTree;
  }

  /** 텍스트를 담을 수 있는 도형들 (그룹 안쪽까지). */
  shapes(index: number): XmlElement[] {
    return descendants(this.shapeTree(index), 'p:sp');
  }

  get slideSize(): { width: number; height: number } {
    const sz = firstChild(this.root, 'p:sldSz');
    const n = (name: string, fallback: number): number => {
      const raw = sz && attr(sz, name);
      if (raw === undefined || raw === null) return fallback;
      const v = Number.parseInt(raw, 10);
      return Number.isFinite(v) ? v : fallback;
    };
    return {
      width: n('cx', SLIDE_SIZE_16_9.width),
      height: n('cy', SLIDE_SIZE_16_9.height),
    };
  }

  /** 슬라이드를 맨 뒤에 추가하고 인덱스를 돌려준다. */
  addSlide(): number {
    const used = new Set(this.pkg.partNames().filter((p) => p.startsWith('ppt/slides/slide')));
    let n = 1;
    while (used.has(slidePart(n))) n += 1;
    const part = slidePart(n);

    this.pkg.setXml(part, parseXml(emptySlideXml()), CT.slide);
    const layout = this.pkg.relatedPart(PART.slideMaster, REL.slideLayout) ?? PART.slideLayout;
    this.pkg.addRelationship(part, REL.slideLayout, layout);

    const rid = this.pkg.addRelationship(this.presentationPart, REL.slide, part);
    const lst =
      firstChild(this.root, 'p:sldIdLst') ??
      (() => {
        const created = element('p:sldIdLst');
        // sldIdLst 는 sldMasterIdLst 다음, sldSz 앞이어야 한다.
        const sldSz = firstChild(this.root, 'p:sldSz');
        if (sldSz) this.root.children.splice(this.root.children.indexOf(sldSz), 0, created);
        else this.root.children.push(created);
        this.root.selfClosed = false;
        return created;
      })();

    const maxId = childElements(lst, 'p:sldId').reduce((max, el) => {
      const v = Number.parseInt(attr(el, 'id') ?? '0', 10);
      return Number.isFinite(v) && v > max ? v : max;
    }, 255);
    lst.children.push(element('p:sldId', { id: String(maxId + 1), 'r:id': rid }));
    lst.selfClosed = false;
    return this.slideCount - 1;
  }

  removeSlide(index: number): boolean {
    const paths = this.slidePaths();
    const part = paths[index];
    if (part === undefined) return false;
    const lst = firstChild(this.root, 'p:sldIdLst');
    if (lst) {
      const entry = childElements(lst, 'p:sldId')[index];
      if (entry) lst.children.splice(lst.children.indexOf(entry), 1);
    }
    this.pkg.removePart(part);
    return true;
  }

  /**
   * 슬라이드에 텍스트 상자를 추가한다.
   *
   * 좌표를 생략하면 슬라이드 폭의 80% 를 차지하는 상자를 세로로 쌓아 놓는다.
   * 처음부터 레이아웃을 신경 쓰지 않고 내용만 붓고 싶을 때를 위한 기본값.
   */
  addTextBox(
    slideIndex: number,
    lines: string | string[],
    options: { frame?: ShapeFrame; fontSize?: number; bold?: boolean; align?: 'left' | 'center' | 'right' } = {},
  ): XmlElement {
    const spTree = this.shapeTree(slideIndex);
    const existing = descendants(spTree, 'p:sp').length;
    const size = this.slideSize;
    const frame =
      options.frame ??
      {
        x: Math.round(size.width * 0.1),
        y: Math.round(size.height * 0.12) + existing * Math.round(size.height * 0.18),
        width: Math.round(size.width * 0.8),
        height: Math.round(size.height * 0.16),
      };

    const texts = Array.isArray(lines) ? lines : [lines];
    const style = {
      fontSize: options.fontSize,
      bold: options.bold,
    };
    const sp = buildTextBox({
      id: nextShapeId(spTree),
      frame,
      paragraphs: texts.map((text) => ({
        runs: [{ text, style }],
        style: options.align ? { align: options.align } : undefined,
      })),
    });
    spTree.children.push(sp);
    spTree.selfClosed = false;
    return sp;
  }

  /** 제목 + 본문 한 장을 한 번에 만든다. */
  addTitleSlide(title: string, body: string[] = []): number {
    const index = this.addSlide();
    const size = this.slideSize;
    this.addTextBox(index, title, {
      frame: {
        x: Math.round(size.width * 0.08),
        y: Math.round(size.height * 0.1),
        width: Math.round(size.width * 0.84),
        height: Math.round(size.height * 0.2),
      },
      fontSize: 36,
      bold: true,
    });
    if (body.length > 0) {
      this.addTextBox(index, body, {
        frame: {
          x: Math.round(size.width * 0.08),
          y: Math.round(size.height * 0.36),
          width: Math.round(size.width * 0.84),
          height: Math.round(size.height * 0.5),
        },
        fontSize: 20,
      });
    }
    return index;
  }

  // -------------------------------------------------------------- 텍스트

  static paragraphs(sp: XmlElement): XmlElement[] {
    return shapeParagraphs(sp);
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

  static setParagraphText(p: XmlElement, value: string): void {
    setParagraphText(p, value);
  }

  /**
   * 도형 전체의 글자 서식을 바꾼다.
   *
   * 슬라이드에서는 한 도형이 하나의 글상자 역할을 하므로, 선택 영역 대신
   * 도형 단위로 적용하는 쪽이 실제 사용과 맞는다.
   */
  static setShapeStyle(sp: XmlElement, patch: Partial<CharStyle>): void {
    for (const p of shapeParagraphs(sp)) {
      for (const run of paragraphRuns(p)) {
        const merged: CharStyle = { ...(readRunStyle(run) ?? {}), ...patch };
        const rPr = firstChild(run, 'a:rPr');
        const rebuilt = buildRunProps(merged, rPr ? (attr(rPr, 'lang') ?? 'ko-KR') : 'ko-KR');
        if (rPr) run.children[run.children.indexOf(rPr)] = rebuilt;
        else run.children.unshift(rebuilt);
        run.selfClosed = false;
      }
    }
  }

  /** 도형의 텍스트 전체를 줄 단위로 바꾼다. */
  static setShapeText(sp: XmlElement, lines: string[]): void {
    const txBody = firstChild(sp, 'p:txBody');
    if (!txBody) throw new PptxError('텍스트를 담을 수 없는 도형입니다 (p:txBody 없음)');
    const bodyPr = firstChild(txBody, 'a:bodyPr');
    const lstStyle = firstChild(txBody, 'a:lstStyle');
    const firstPara = childElements(txBody, 'a:p')[0];
    const style = firstPara ? readRunStyle(paragraphRuns(firstPara)[0] ?? firstPara) : undefined;

    const head: XmlElement[] = [];
    if (bodyPr) head.push(bodyPr);
    if (lstStyle) head.push(lstStyle);
    txBody.children = [
      ...head,
      ...(lines.length > 0 ? lines : ['']).map((text) => buildParagraph([{ text, style }])),
    ];
    txBody.selfClosed = false;
  }

  getText(): string {
    const out: string[] = [];
    for (let i = 0; i < this.slideCount; i += 1) {
      const lines: string[] = [];
      for (const sp of this.shapes(i)) {
        for (const p of shapeParagraphs(sp)) lines.push(paragraphText(p));
      }
      out.push(lines.join('\n'));
    }
    return out.join('\n\n');
  }

  // ------------------------------------------------------------------ 메타

  get meta(): DocMeta {
    const core = this.pkg.relatedPart('', REL.coreProperties);
    const meta: DocMeta = {};
    const root = core ? this.pkg.xml(core)?.root : undefined;
    if (!root) return meta;
    const read = (name: string): string | undefined => {
      const el = firstChild(root, name);
      return el ? textContent(el) : undefined;
    };
    meta.title = read('dc:title');
    meta.creator = read('dc:creator');
    meta.lastModifiedBy = read('cp:lastModifiedBy');
    meta.createdAt = read('dcterms:created');
    meta.modifiedAt = read('dcterms:modified');
    return meta;
  }

  setMeta(patch: DocMeta): void {
    const core = this.pkg.relatedPart('', REL.coreProperties);
    if (!core) throw new PptxError('docProps/core.xml 이 없습니다.');
    const root = this.pkg.xml(core)!.root;
    const fields: Array<[keyof DocMeta, string]> = [
      ['title', 'dc:title'],
      ['creator', 'dc:creator'],
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

  // --------------------------------------------------------------- 모델화

  toModel(): JamoPresentation {
    const size = this.slideSize;
    const slides: JamoSlide[] = [];
    for (let i = 0; i < this.slideCount; i += 1) {
      const shapes: JamoShape[] = this.shapes(i).map((sp, shapeIndex) => {
        const frame = readFrame(sp);
        return {
          id: String(shapeIndex),
          name: readShapeName(sp),
          placeholder: readPlaceholder(sp),
          frame: frame
            ? {
                x: hwpunit.fromEmu(frame.x),
                y: hwpunit.fromEmu(frame.y),
                width: hwpunit.fromEmu(frame.width),
                height: hwpunit.fromEmu(frame.height),
              }
            : undefined,
          paragraphs: shapeParagraphs(sp).map((p) => ({
            runs: paragraphRuns(p).map((run) => ({
              text: runText(run),
              style: readRunStyle(run),
              source: run,
            })),
            style: readParagraphStyle(p),
            source: p,
          })),
          source: sp,
        };
      });
      slides.push({ shapes, source: this.slideRoot(i) });
    }
    return {
      kind: 'slides',
      meta: this.meta,
      slideSize: { width: hwpunit.fromEmu(size.width), height: hwpunit.fromEmu(size.height) },
      slides,
    };
  }

  /** 개요(제목 + 불릿)에서 덱을 만든다. */
  static fromOutline(
    outline: Array<{ title: string; bullets?: string[] }>,
    opts: BlankPptxOptions = {},
  ): PptxFile {
    const file = PptxFile.blank(opts);
    // blank() 가 만든 빈 첫 장을 첫 항목으로 채운다.
    const first = outline[0];
    if (first) {
      const size = file.slideSize;
      file.addTextBox(0, first.title, {
        frame: {
          x: Math.round(size.width * 0.08),
          y: Math.round(size.height * 0.1),
          width: Math.round(size.width * 0.84),
          height: Math.round(size.height * 0.2),
        },
        fontSize: 36,
        bold: true,
      });
      if (first.bullets?.length) {
        file.addTextBox(0, first.bullets, {
          frame: {
            x: Math.round(size.width * 0.08),
            y: Math.round(size.height * 0.36),
            width: Math.round(size.width * 0.84),
            height: Math.round(size.height * 0.5),
          },
          fontSize: 20,
        });
      }
    }
    for (const item of outline.slice(1)) {
      file.addTitleSlide(item.title, item.bullets ?? []);
    }
    if (opts.title) file.setMeta({ title: opts.title });
    return file;
  }
}

function nextShapeId(spTree: XmlElement): number {
  let max = 1;
  for (const cNvPr of descendants(spTree, 'p:cNvPr')) {
    const v = Number.parseInt(attr(cNvPr, 'id') ?? '0', 10);
    if (Number.isFinite(v) && v > max) max = v;
  }
  return max + 1;
}

function coreProps(opts: BlankPptxOptions): ReturnType<typeof parseXml> {
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return parseXml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" \
xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" \
xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\
<dc:title>${esc(opts.title ?? '')}</dc:title>\
<dc:creator>${esc(opts.creator ?? '')}</dc:creator>\
<cp:lastModifiedBy>${esc(opts.creator ?? '')}</cp:lastModifiedBy>\
<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>\
<dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>\
</cp:coreProperties>`);
}

function appProps(opts: BlankPptxOptions): ReturnType<typeof parseXml> {
  return parseXml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" \
xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">\
<Application>${opts.application ?? 'Jamo Office'}</Application>\
</Properties>`);
}
