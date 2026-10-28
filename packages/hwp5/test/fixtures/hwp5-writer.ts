import { deflateSync } from 'fflate';
import { BODY_TAG, DOCINFO_TAG } from '../../src/records.js';
import { writeCfb } from './cfb-writer.js';

/**
 * 테스트용 합성 `.hwp` 생성기.
 *
 * 한글이 만든 실제 파일 대신, 스펙대로 조립한 파일로 리더를 검증한다.
 * 포맷의 함정을 일부러 포함시킨다: 8 WCHAR 폭 제어 문자, 0xFFF 를 넘는
 * 레코드 길이, 미니 스트림에 들어가는 작은 스트림.
 */

class RecordWriter {
  private readonly parts: Uint8Array[] = [];

  add(tag: number, level: number, data: Uint8Array): this {
    const big = data.byteLength >= 0xfff;
    const header = new Uint8Array(big ? 8 : 4);
    const dv = new DataView(header.buffer);
    const sizeField = big ? 0xfff : data.byteLength;
    dv.setUint32(0, (tag & 0x3ff) | ((level & 0x3ff) << 10) | (sizeField << 20), true);
    if (big) dv.setUint32(4, data.byteLength, true);
    this.parts.push(header, data);
    return this;
  }

  build(): Uint8Array {
    const total = this.parts.reduce((s, p) => s + p.byteLength, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const p of this.parts) {
      out.set(p, at);
      at += p.byteLength;
    }
    return out;
  }
}

class Buf {
  private readonly bytes: number[] = [];

  u8(v: number): this {
    this.bytes.push(v & 0xff);
    return this;
  }

  u16(v: number): this {
    this.bytes.push(v & 0xff, (v >>> 8) & 0xff);
    return this;
  }

  u32(v: number): this {
    this.bytes.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
    return this;
  }

  /** 길이(WORD) + UTF-16LE */
  str(value: string): this {
    this.u16(value.length);
    for (let i = 0; i < value.length; i += 1) this.u16(value.charCodeAt(i));
    return this;
  }

  /** COLORREF: 0x00BBGGRR */
  color(r: number, g: number, b: number): this {
    return this.u32((b << 16) | (g << 8) | r);
  }

  repeat(byte: number, count: number): this {
    for (let i = 0; i < count; i += 1) this.u8(byte);
    return this;
  }

  build(): Uint8Array {
    return new Uint8Array(this.bytes);
  }
}

export interface SyntheticParagraph {
  text: string;
  paraShapeId?: number;
  /** (문자 위치, charShape 인덱스) */
  charShapeRuns?: Array<[number, number]>;
}

export interface SyntheticHwpOptions {
  version?: [number, number, number, number];
  compressed?: boolean;
  distribution?: boolean;
  passwordProtected?: boolean;
  paragraphs?: SyntheticParagraph[];
  fonts?: string[];
  /** [baseSize(1/100pt), propertyBits, faceNameId] */
  charShapes?: Array<{ baseSize: number; property: number; faceNameId: number; color?: [number, number, number] }>;
  /** align: 0 양쪽 1 왼쪽 2 오른쪽 3 가운데 */
  paraShapes?: Array<{ align: number; marginLeft?: number; indent?: number }>;
  page?: { width: number; height: number; landscape?: boolean };
  /** BinData 스토리지에 넣을 첨부. */
  binData?: Record<string, Uint8Array>;
  previewText?: string;
}

function fileHeader(opts: SyntheticHwpOptions): Uint8Array {
  const out = new Uint8Array(256);
  const sig = 'HWP Document File';
  for (let i = 0; i < sig.length; i += 1) out[i] = sig.charCodeAt(i);
  const dv = new DataView(out.buffer);
  const [a, b, c, d] = opts.version ?? [5, 1, 0, 0];
  dv.setUint32(32, ((a & 0xff) << 24) | ((b & 0xff) << 16) | ((c & 0xff) << 8) | (d & 0xff), true);
  let flags = 0;
  if (opts.compressed !== false) flags |= 0x01;
  if (opts.passwordProtected) flags |= 0x02;
  if (opts.distribution) flags |= 0x04;
  dv.setUint32(36, flags, true);
  return out;
}

function docInfo(opts: SyntheticHwpOptions): Uint8Array {
  const w = new RecordWriter();

  for (const font of opts.fonts ?? ['함초롬바탕', '맑은 고딕']) {
    w.add(DOCINFO_TAG.FACE_NAME, 1, new Buf().u8(0).str(font).build());
  }

  const charShapes =
    opts.charShapes ?? [{ baseSize: 1000, property: 0, faceNameId: 0 }];
  for (const cs of charShapes) {
    const b = new Buf();
    for (let i = 0; i < 7; i += 1) b.u16(cs.faceNameId);
    b.repeat(100, 7); // 장평
    b.repeat(0, 7); // 자간
    b.repeat(100, 7); // 상대 크기
    b.repeat(0, 7); // 글자 위치
    b.u32(cs.baseSize);
    b.u32(cs.property);
    b.u8(10).u8(10); // 그림자 간격
    const [r, g, bl] = cs.color ?? [0, 0, 0];
    b.color(r, g, bl); // 글자 색
    b.color(0, 0, 0); // 밑줄 색
    b.color(255, 255, 255); // 음영 색
    b.color(178, 178, 178); // 그림자 색
    b.u16(0); // 테두리/배경 ID
    w.add(DOCINFO_TAG.CHAR_SHAPE, 1, b.build());
  }

  const paraShapes = opts.paraShapes ?? [{ align: 0 }];
  for (const ps of paraShapes) {
    const b = new Buf();
    b.u32((ps.align & 0x7) << 2);
    b.u32(ps.marginLeft ?? 0);
    b.u32(0); // 오른쪽 여백
    b.u32(ps.indent ?? 0);
    b.u32(0); // 위 간격
    b.u32(0); // 아래 간격
    b.u32(160); // 줄 간격
    b.u16(0).u16(0).u16(0);
    w.add(DOCINFO_TAG.PARA_SHAPE, 1, b.build());
  }

  return w.build();
}

function paraText(text: string): Uint8Array {
  // 제어 문자 중 탭(9)은 8 WCHAR 를 차지한다. 그 규칙대로 기록한다.
  const codes: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code === 9) {
      codes.push(9, 0, 0, 0, 0, 0, 0, 9);
    } else if (code === 10) {
      codes.push(10);
    } else if (code > 0xffff) {
      // 서러게이트 쌍
      const v = code - 0x10000;
      codes.push(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
    } else {
      codes.push(code);
    }
  }
  const out = new Uint8Array(codes.length * 2);
  const dv = new DataView(out.buffer);
  codes.forEach((c, i) => dv.setUint16(i * 2, c, true));
  return out;
}

function bodySection(opts: SyntheticHwpOptions): Uint8Array {
  const w = new RecordWriter();
  const page = opts.page ?? { width: 59528, height: 84188 };
  w.add(
    BODY_TAG.PAGE_DEF,
    1,
    new Buf()
      .u32(page.width)
      .u32(page.height)
      .u32(8504) // 왼쪽
      .u32(8504) // 오른쪽
      .u32(5668) // 위
      .u32(4252) // 아래
      .u32(4252) // 머리말
      .u32(4252) // 꼬리말
      .u32(0) // 제본
      .u32(page.landscape ? 1 : 0)
      .build(),
  );

  for (const para of opts.paragraphs ?? [{ text: '' }]) {
    const runs = para.charShapeRuns ?? [[0, 0]];
    w.add(
      BODY_TAG.PARA_HEADER,
      1,
      new Buf()
        .u32(para.text.length)
        .u32(0)
        .u16(para.paraShapeId ?? 0)
        .u8(0)
        .u8(0)
        .u16(runs.length)
        .u16(0)
        .u16(1)
        .u32(0)
        .build(),
    );
    w.add(BODY_TAG.PARA_TEXT, 2, paraText(para.text));
    const cs = new Buf();
    for (const [start, id] of runs) cs.u32(start).u32(id);
    w.add(BODY_TAG.PARA_CHAR_SHAPE, 2, cs.build());
  }
  return w.build();
}

export function writeSyntheticHwp(opts: SyntheticHwpOptions = {}): Uint8Array {
  const compressed = opts.compressed !== false;
  const pack = (data: Uint8Array): Uint8Array => (compressed ? deflateSync(data) : data);

  const streams: Record<string, Uint8Array> = {
    FileHeader: fileHeader(opts),
    DocInfo: pack(docInfo(opts)),
    'BodyText/Section0': pack(bodySection(opts)),
  };

  if (opts.previewText !== undefined) {
    const text = opts.previewText;
    const bytes = new Uint8Array(text.length * 2);
    const dv = new DataView(bytes.buffer);
    for (let i = 0; i < text.length; i += 1) dv.setUint16(i * 2, text.charCodeAt(i), true);
    streams['PrvText'] = bytes;
  }
  for (const [name, data] of Object.entries(opts.binData ?? {})) {
    streams[`BinData/${name}`] = pack(data);
  }

  return writeCfb({ streams });
}
