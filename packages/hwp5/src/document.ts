import {
  charHeight,
  emptyPageSetup,
  type CharStyle,
  type DocMeta,
  type HorizontalAlign,
  type JamoParagraph,
  type JamoRun,
  type JamoSection,
  type JamoTextDocument,
  type PageSetup,
  type ParagraphStyle,
} from '@jamo/core';
import { CfbFile } from './cfb.js';
import {
  BODY_TAG,
  ByteReader,
  DOCINFO_TAG,
  Hwp5Error,
  inflateStream,
  parseFileHeader,
  parseRecords,
  versionAtLeast,
  type Hwp5FileHeader,
  type HwpRecord,
} from './records.js';

/**
 * 구형 `.hwp` (HWP 5.0 바이너리) 읽기.
 *
 * 쓰기는 지원하지 않는다. 의도적인 선택이다: HWP 5.0 바이너리를 다시 쓰려면
 * 레코드 트리 전체를 정확히 재구성해야 하고, 한 군데만 어긋나도 한글이 파일을
 * 거부한다. 읽어서 HWPX/DOCX 로 내보내는 쪽이 훨씬 안전하고, 사용자 입장에서도
 * 결과가 같다.
 */

export interface FaceName {
  name: string;
  alternateName?: string;
}

export interface CharShape {
  faceNameIds: number[];
  /** 1/100 pt. */
  baseSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikeout: boolean;
  superscript: boolean;
  subscript: boolean;
  textColor: string;
  shadeColor: string;
}

export interface ParaShape {
  align: HorizontalAlign;
  marginLeft: number;
  marginRight: number;
  indent: number;
  marginPrev: number;
  marginNext: number;
  lineSpacing: number;
}

export interface Hwp5Paragraph {
  text: string;
  /** (문자 위치, charShape 인덱스) 쌍. */
  charShapeRuns: Array<{ start: number; charShapeId: number }>;
  paraShapeId: number;
  styleId: number;
}

export class Hwp5File {
  private readonly cfb: CfbFile;
  readonly header: Hwp5FileHeader;
  private faceNamesCache: FaceName[] | undefined;
  private charShapesCache: CharShape[] | undefined;
  private paraShapesCache: ParaShape[] | undefined;

  private constructor(cfb: CfbFile, header: Hwp5FileHeader) {
    this.cfb = cfb;
    this.header = header;
  }

  static open(data: Uint8Array): Hwp5File {
    if (!CfbFile.looksLikeCfb(data)) {
      if (data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b) {
        throw new Hwp5Error('ZIP 기반 파일입니다. .hwpx 라면 @jamo/hwpx 로 여세요.');
      }
      throw new Hwp5Error('HWP 5.0 문서가 아닙니다 (OLE2 컨테이너가 아님).');
    }
    const cfb = CfbFile.open(data);
    const fileHeader = cfb.read('FileHeader');
    if (!fileHeader) throw new Hwp5Error('FileHeader 스트림이 없습니다.');
    const header = parseFileHeader(fileHeader);

    if (header.passwordProtected) {
      throw new Hwp5Error('암호가 걸린 문서입니다. 한글에서 암호를 푼 뒤 다시 시도하세요.');
    }
    if (header.drm) {
      throw new Hwp5Error('DRM 이 적용된 문서는 읽을 수 없습니다.');
    }
    return new Hwp5File(cfb, header);
  }

  static looksLikeHwp5(data: Uint8Array): boolean {
    if (!CfbFile.looksLikeCfb(data)) return false;
    try {
      const cfb = CfbFile.open(data);
      return cfb.has('FileHeader') && cfb.has('DocInfo');
    } catch {
      return false;
    }
  }

  /** 컨테이너 안의 스트림 목록. 디버깅과 첨부 추출에 쓴다. */
  list(): ReturnType<CfbFile['list']> {
    return this.cfb.list();
  }

  /** 압축을 고려해 스트림을 읽는다. */
  private stream(path: string): Uint8Array | undefined {
    const raw = this.cfb.read(path);
    if (!raw || raw.byteLength === 0) return raw;
    return this.header.compressed ? inflateStream(raw) : raw;
  }

  private records(path: string): HwpRecord[] {
    const data = this.stream(path);
    return data ? parseRecords(data) : [];
  }

  // ----------------------------------------------------------------- DocInfo

  private docInfoRecords(): HwpRecord[] {
    const records = this.records('DocInfo');
    if (this.header.distribution && records.length === 0) {
      throw new Hwp5Error(
        '배포용 문서입니다. 본문이 별도로 암호화돼 있어 열 수 없습니다. ' +
          '한글에서 "배포용 문서 해제" 후 다시 저장하세요.',
      );
    }
    return records;
  }

  get faceNames(): FaceName[] {
    if (this.faceNamesCache) return this.faceNamesCache;
    const out: FaceName[] = [];
    for (const record of this.docInfoRecords()) {
      if (record.tag !== DOCINFO_TAG.FACE_NAME) continue;
      const r = new ByteReader(record.data);
      try {
        const property = r.u8();
        const name = r.str();
        const face: FaceName = { name };
        // 상위 비트가 추가 정보의 유무를 알려준다. 순서를 지켜 건너뛰어야
        // 뒤쪽 필드가 밀리지 않는다.
        if ((property & 0x80) !== 0) {
          r.u8();
          face.alternateName = r.str();
        }
        if ((property & 0x40) !== 0) r.skip(10); // panose
        if ((property & 0x20) !== 0) r.str(); // 기본 글꼴
        out.push(face);
      } catch {
        out.push({ name: '' });
      }
    }
    this.faceNamesCache = out;
    return out;
  }

  get charShapes(): CharShape[] {
    if (this.charShapesCache) return this.charShapesCache;
    const out: CharShape[] = [];
    for (const record of this.docInfoRecords()) {
      if (record.tag !== DOCINFO_TAG.CHAR_SHAPE) continue;
      const r = new ByteReader(record.data);
      try {
        const faceNameIds = Array.from({ length: 7 }, () => r.u16());
        r.skip(7); // 장평
        r.skip(7); // 자간
        r.skip(7); // 상대 크기
        r.skip(7); // 글자 위치
        const baseSize = r.i32();
        const property = r.u32();
        r.skip(2); // 그림자 간격 x, y
        const textColor = r.color();
        r.color(); // 밑줄 색
        const shadeColor = r.color();
        out.push({
          faceNameIds,
          baseSize,
          italic: (property & 0x1) !== 0,
          bold: (property & 0x2) !== 0,
          underline: ((property >>> 2) & 0x3) !== 0,
          superscript: (property & (1 << 15)) !== 0,
          subscript: (property & (1 << 16)) !== 0,
          strikeout: ((property >>> 18) & 0x7) !== 0,
          textColor,
          shadeColor,
        });
      } catch {
        // 손상된 항목은 기본값으로 메워 인덱스를 어긋나지 않게 한다.
        out.push(defaultCharShape());
      }
    }
    this.charShapesCache = out;
    return out;
  }

  get paraShapes(): ParaShape[] {
    if (this.paraShapesCache) return this.paraShapesCache;
    const ALIGN: HorizontalAlign[] = ['justify', 'left', 'right', 'center', 'distribute', 'distribute'];
    const out: ParaShape[] = [];
    for (const record of this.docInfoRecords()) {
      if (record.tag !== DOCINFO_TAG.PARA_SHAPE) continue;
      const r = new ByteReader(record.data);
      try {
        const property1 = r.u32();
        out.push({
          align: ALIGN[(property1 >>> 2) & 0x7] ?? 'justify',
          marginLeft: r.i32(),
          marginRight: r.i32(),
          indent: r.i32(),
          marginPrev: r.i32(),
          marginNext: r.i32(),
          lineSpacing: r.i32(),
        });
      } catch {
        out.push({
          align: 'justify',
          marginLeft: 0,
          marginRight: 0,
          indent: 0,
          marginPrev: 0,
          marginNext: 0,
          lineSpacing: 160,
        });
      }
    }
    this.paraShapesCache = out;
    return out;
  }

  // ---------------------------------------------------------------- BodyText

  get sectionPaths(): string[] {
    const names = this.cfb.children('BodyText');
    // Section0, Section1 … 숫자 순서로 정렬한다. 문자열 정렬이면 Section10 이
    // Section2 보다 앞에 온다.
    return names
      .filter((n) => /^Section\d+$/.test(n))
      .sort((a, b) => Number(a.slice(7)) - Number(b.slice(7)))
      .map((n) => `BodyText/${n}`);
  }

  get sectionCount(): number {
    return this.sectionPaths.length;
  }

  /** 섹션의 문단 목록. */
  paragraphs(sectionIndex: number): Hwp5Paragraph[] {
    const path = this.sectionPaths[sectionIndex];
    if (path === undefined) throw new Hwp5Error(`섹션 ${sectionIndex} 이 없습니다.`);
    const records = this.records(path);
    const out: Hwp5Paragraph[] = [];
    let current: Hwp5Paragraph | undefined;

    for (const record of records) {
      switch (record.tag) {
        case BODY_TAG.PARA_HEADER: {
          const r = new ByteReader(record.data);
          r.u32(); // 글자 수
          r.u32(); // 컨트롤 마스크
          const paraShapeId = r.u16();
          const styleId = r.u8();
          current = { text: '', charShapeRuns: [], paraShapeId, styleId };
          out.push(current);
          break;
        }
        case BODY_TAG.PARA_TEXT: {
          if (current) current.text = decodeParaText(record.data);
          break;
        }
        case BODY_TAG.PARA_CHAR_SHAPE: {
          if (!current) break;
          const r = new ByteReader(record.data);
          while (r.remaining >= 8) {
            current.charShapeRuns.push({ start: r.u32(), charShapeId: r.u32() });
          }
          break;
        }
        default:
          break;
      }
    }
    return out;
  }

  pageSetup(sectionIndex: number): PageSetup {
    const base = emptyPageSetup();
    const path = this.sectionPaths[sectionIndex];
    if (path === undefined) return base;
    for (const record of this.records(path)) {
      if (record.tag !== BODY_TAG.PAGE_DEF) continue;
      const r = new ByteReader(record.data);
      try {
        const width = r.u32();
        const height = r.u32();
        const left = r.u32();
        const right = r.u32();
        const top = r.u32();
        const bottom = r.u32();
        const headerMargin = r.u32();
        const footerMargin = r.u32();
        const gutter = r.u32();
        const property = r.u32();
        return {
          width,
          height,
          landscape: (property & 0x1) !== 0,
          margin: { left, right, top, bottom, header: headerMargin, footer: footerMargin, gutter },
        };
      } catch {
        return base;
      }
    }
    return base;
  }

  // -------------------------------------------------------------------- 결과

  getText(): string {
    const out: string[] = [];
    for (let i = 0; i < this.sectionCount; i += 1) {
      for (const p of this.paragraphs(i)) out.push(p.text);
    }
    return out.join('\n');
  }

  get meta(): DocMeta {
    // 요약 정보 스트림은 별도 포맷(OLE Property Set)이다. 지금은 미리보기
    // 텍스트에서 제목만 추정하고, 나머지는 비워 둔다.
    const preview = this.cfb.read('PrvText');
    const meta: DocMeta = { language: 'ko' };
    if (preview && preview.byteLength > 0) {
      const text = new TextDecoder('utf-16le').decode(preview).trim();
      const firstLine = text.split(/\r?\n/)[0]?.trim();
      if (firstLine) meta.title = firstLine.slice(0, 120);
    }
    return meta;
  }

  /** 첨부된 바이너리(이미지 등). 키는 `BIN0001.png` 형태. */
  binData(): Map<string, Uint8Array> {
    const out = new Map<string, Uint8Array>();
    for (const name of this.cfb.children('BinData')) {
      const raw = this.cfb.read(`BinData/${name}`);
      if (!raw) continue;
      // BinData 는 문서가 압축 설정이면 같이 압축돼 있다.
      try {
        out.set(name, this.header.compressed ? inflateStream(raw) : raw);
      } catch {
        out.set(name, raw);
      }
    }
    return out;
  }

  toModel(): JamoTextDocument {
    const charShapes = this.charShapes;
    const paraShapes = this.paraShapes;
    const faceNames = this.faceNames;
    const sections: JamoSection[] = [];

    for (let i = 0; i < this.sectionCount; i += 1) {
      const paragraphs: JamoParagraph[] = this.paragraphs(i).map((p) =>
        toModelParagraph(p, charShapes, paraShapes, faceNames),
      );
      sections.push({ page: this.pageSetup(i), paragraphs });
    }
    return { kind: 'text', meta: this.meta, sections };
  }
}

function defaultCharShape(): CharShape {
  return {
    faceNameIds: [0, 0, 0, 0, 0, 0, 0],
    baseSize: 1000,
    bold: false,
    italic: false,
    underline: false,
    strikeout: false,
    superscript: false,
    subscript: false,
    textColor: '#000000',
    shadeColor: '#FFFFFF',
  };
}

/**
 * PARA_TEXT 디코딩.
 *
 * UTF-16LE 이지만 0–31 은 제어 문자다. 중요한 건 폭이 다르다는 것:
 * 일부는 1 WCHAR 이고, 나머지는 **8 WCHAR(16바이트)** 를 차지한다.
 * 8 WCHAR 짜리를 1개로 세면 그 뒤 문자열이 전부 깨진다.
 */
const SINGLE_WIDE_CONTROLS = new Set([0, 10, 13, 24, 25, 26, 27, 28, 29, 30, 31]);

export function decodeParaText(data: Uint8Array): string {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = Math.floor(data.byteLength / 2);
  let out = '';
  let i = 0;
  while (i < count) {
    const code = dv.getUint16(i * 2, true);
    if (code >= 32) {
      out += String.fromCharCode(code);
      i += 1;
      continue;
    }
    if (SINGLE_WIDE_CONTROLS.has(code)) {
      switch (code) {
        case 10:
          out += '\n';
          break;
        case 24:
          out += '-';
          break;
        case 30:
          out += ' ';
          break;
        case 31:
          out += ' ';
          break;
        default:
          // 13 은 문단 끝 표시다. 문단은 이미 레코드 단위로 나뉘어 있으니 버린다.
          break;
      }
      i += 1;
      continue;
    }
    // 확장/인라인 제어 문자: 8 WCHAR 를 차지한다.
    if (code === 9) out += '\t';
    i += 8;
  }
  return out;
}

function toModelParagraph(
  p: Hwp5Paragraph,
  charShapes: CharShape[],
  paraShapes: ParaShape[],
  faceNames: FaceName[],
): JamoParagraph {
  const style = paragraphStyleOf(paraShapes[p.paraShapeId]);
  const runs: JamoRun[] = [];

  if (p.charShapeRuns.length === 0) {
    runs.push({ text: p.text });
  } else {
    // charShapeRuns 의 start 는 **문자 위치**다. 제어 문자를 지운 뒤의
    // 문자열과는 어긋날 수 있어 정확한 매핑은 보장되지 않는다. 길이가 맞는
    // 경우에만 쪼개고, 아니면 통째로 첫 서식을 적용한다.
    const sorted = [...p.charShapeRuns].sort((a, b) => a.start - b.start);
    const fits = sorted.every((r) => r.start <= p.text.length);
    if (!fits) {
      runs.push({
        text: p.text,
        style: charStyleOf(charShapes[sorted[0]!.charShapeId], faceNames),
      });
    } else {
      for (let i = 0; i < sorted.length; i += 1) {
        const from = sorted[i]!.start;
        const to = i + 1 < sorted.length ? sorted[i + 1]!.start : p.text.length;
        const text = p.text.slice(from, to);
        if (text === '' && sorted.length > 1) continue;
        runs.push({ text, style: charStyleOf(charShapes[sorted[i]!.charShapeId], faceNames) });
      }
    }
  }
  if (runs.length === 0) runs.push({ text: '' });
  return { runs, style };
}

function charStyleOf(shape: CharShape | undefined, faceNames: FaceName[]): CharStyle | undefined {
  if (!shape) return undefined;
  const style: CharStyle = {
    fontSize: charHeight.toPoint(shape.baseSize),
    bold: shape.bold,
    italic: shape.italic,
    underline: shape.underline,
    strikeout: shape.strikeout,
  };
  // faceNameIds[0] 은 한글 글꼴. 한글 문서의 대표값으로 쓴다.
  const faceId = shape.faceNameIds[0];
  const face = faceId === undefined ? undefined : faceNames[faceId];
  if (face?.name) style.fontFamily = face.name;
  if (shape.textColor !== '#000000') style.color = shape.textColor;
  if (shape.superscript) style.superscript = true;
  if (shape.subscript) style.subscript = true;
  return style;
}

function paragraphStyleOf(shape: ParaShape | undefined): ParagraphStyle | undefined {
  if (!shape) return undefined;
  return {
    align: shape.align,
    indentLeft: shape.marginLeft,
    indentRight: shape.marginRight,
    indentFirstLine: shape.indent,
    spaceBefore: shape.marginPrev,
    spaceAfter: shape.marginNext,
  };
}

export { versionAtLeast };
