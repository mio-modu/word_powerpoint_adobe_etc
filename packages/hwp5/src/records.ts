import { inflateSync, unzlibSync, decompressSync } from 'fflate';

/**
 * HWP 5.0 레코드 스트림.
 *
 * 스트림은 4바이트 헤더가 붙은 레코드의 연속이다.
 *   비트  0–9  : 태그 ID
 *   비트 10–19 : 트리 레벨
 *   비트 20–31 : 데이터 길이
 * 길이가 0xFFF(12비트 최대)면 "길이가 12비트에 안 들어간다"는 표시이고,
 * 실제 길이는 뒤따르는 4바이트에 들어 있다. 이 예외를 빠뜨리면 큰 표나
 * 긴 문단이 있는 문서에서 파싱이 어긋난다.
 */

export const HWPTAG_BEGIN = 0x010;

/** DocInfo 스트림 태그. */
export const DOCINFO_TAG = {
  DOCUMENT_PROPERTIES: HWPTAG_BEGIN,
  ID_MAPPINGS: HWPTAG_BEGIN + 1,
  BIN_DATA: HWPTAG_BEGIN + 2,
  FACE_NAME: HWPTAG_BEGIN + 3,
  BORDER_FILL: HWPTAG_BEGIN + 4,
  CHAR_SHAPE: HWPTAG_BEGIN + 5,
  TAB_DEF: HWPTAG_BEGIN + 6,
  NUMBERING: HWPTAG_BEGIN + 7,
  BULLET: HWPTAG_BEGIN + 8,
  PARA_SHAPE: HWPTAG_BEGIN + 9,
  STYLE: HWPTAG_BEGIN + 10,
  DOC_DATA: HWPTAG_BEGIN + 11,
  DISTRIBUTE_DOC_DATA: HWPTAG_BEGIN + 12,
  COMPATIBLE_DOCUMENT: HWPTAG_BEGIN + 14,
  LAYOUT_COMPATIBILITY: HWPTAG_BEGIN + 15,
  TRACKCHANGE: HWPTAG_BEGIN + 16,
} as const;

/** BodyText 스트림 태그. */
export const BODY_TAG = {
  PARA_HEADER: HWPTAG_BEGIN + 50,
  PARA_TEXT: HWPTAG_BEGIN + 51,
  PARA_CHAR_SHAPE: HWPTAG_BEGIN + 52,
  PARA_LINE_SEG: HWPTAG_BEGIN + 53,
  PARA_RANGE_TAG: HWPTAG_BEGIN + 54,
  CTRL_HEADER: HWPTAG_BEGIN + 55,
  LIST_HEADER: HWPTAG_BEGIN + 56,
  PAGE_DEF: HWPTAG_BEGIN + 57,
  FOOTNOTE_SHAPE: HWPTAG_BEGIN + 58,
  PAGE_BORDER_FILL: HWPTAG_BEGIN + 59,
  SHAPE_COMPONENT: HWPTAG_BEGIN + 60,
  TABLE: HWPTAG_BEGIN + 61,
} as const;

export interface HwpRecord {
  tag: number;
  level: number;
  /** 레코드 본문 (헤더 제외). */
  data: Uint8Array;
}

export class Hwp5Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Hwp5Error';
  }
}

/** 레코드 스트림을 끝까지 읽는다. */
export function parseRecords(stream: Uint8Array): HwpRecord[] {
  const out: HwpRecord[] = [];
  const dv = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  let at = 0;
  while (at + 4 <= stream.byteLength) {
    const header = dv.getUint32(at, true);
    at += 4;
    const tag = header & 0x3ff;
    const level = (header >> 10) & 0x3ff;
    let size = (header >> 20) & 0xfff;
    if (size === 0xfff) {
      if (at + 4 > stream.byteLength) break;
      size = dv.getUint32(at, true);
      at += 4;
    }
    if (size > stream.byteLength - at) {
      // 잘린 스트림. 읽은 만큼만 쓰고 멈춘다.
      out.push({ tag, level, data: stream.subarray(at) });
      break;
    }
    out.push({ tag, level, data: stream.subarray(at, at + size) });
    at += size;
  }
  return out;
}

export interface Hwp5FileHeader {
  /** `5.0.3.0` 형태. */
  version: string;
  versionNumber: number;
  compressed: boolean;
  passwordProtected: boolean;
  /** 배포용 문서. 본문이 별도로 암호화돼 있어 그냥은 읽을 수 없다. */
  distribution: boolean;
  drm: boolean;
  hasSignature: boolean;
  trackChanges: boolean;
}

const HWP_SIGNATURE = 'HWP Document File';

export function parseFileHeader(stream: Uint8Array): Hwp5FileHeader {
  if (stream.byteLength < 40) throw new Hwp5Error('FileHeader 스트림이 너무 짧습니다.');
  const signature = new TextDecoder('ascii').decode(stream.subarray(0, HWP_SIGNATURE.length));
  if (signature !== HWP_SIGNATURE) {
    throw new Hwp5Error(`HWP 5.0 문서가 아닙니다 (서명: ${JSON.stringify(signature)}).`);
  }
  const dv = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  const v = dv.getUint32(32, true);
  const flags = dv.getUint32(36, true);
  return {
    version: `${(v >>> 24) & 0xff}.${(v >>> 16) & 0xff}.${(v >>> 8) & 0xff}.${v & 0xff}`,
    versionNumber: v,
    compressed: (flags & 0x01) !== 0,
    passwordProtected: (flags & 0x02) !== 0,
    distribution: (flags & 0x04) !== 0,
    drm: (flags & 0x10) !== 0,
    hasSignature: (flags & 0x80) !== 0,
    trackChanges: (flags & 0x4000) !== 0,
  };
}

/**
 * 압축된 스트림을 푼다.
 *
 * HWP 는 zlib 래퍼 없는 raw deflate 를 쓰는데, 생성 프로그램에 따라 zlib
 * 헤더가 붙은 파일도 돌아다닌다. 둘 다 시도한다. 여기서 포기하면 문서를
 * 아예 못 여니, 관용적으로 처리하는 편이 낫다.
 */
export function inflateStream(data: Uint8Array): Uint8Array {
  const attempts: Array<(d: Uint8Array) => Uint8Array> = [inflateSync, unzlibSync, decompressSync];
  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      return attempt(data);
    } catch (cause) {
      lastError = cause;
    }
  }
  throw new Hwp5Error(
    `압축된 스트림을 풀 수 없습니다: ${(lastError as Error | undefined)?.message ?? '알 수 없는 오류'}`,
  );
}

/** 버전 비교용. `5.0.3.2` → 0x05000302 */
export function versionAtLeast(header: Hwp5FileHeader, major: number, minor: number, build: number, revision: number): boolean {
  const target = ((major & 0xff) << 24) | ((minor & 0xff) << 16) | ((build & 0xff) << 8) | (revision & 0xff);
  return header.versionNumber >>> 0 >= target >>> 0;
}

/** 리틀엔디언 순차 읽기. 레코드 본문은 전부 이 방식이다. */
export class ByteReader {
  private at = 0;
  private readonly dv: DataView;

  constructor(private readonly bytes: Uint8Array) {
    this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get offset(): number {
    return this.at;
  }

  get remaining(): number {
    return this.bytes.byteLength - this.at;
  }

  skip(n: number): void {
    this.at += n;
  }

  u8(): number {
    const v = this.dv.getUint8(this.at);
    this.at += 1;
    return v;
  }

  i8(): number {
    const v = this.dv.getInt8(this.at);
    this.at += 1;
    return v;
  }

  u16(): number {
    const v = this.dv.getUint16(this.at, true);
    this.at += 2;
    return v;
  }

  i16(): number {
    const v = this.dv.getInt16(this.at, true);
    this.at += 2;
    return v;
  }

  u32(): number {
    const v = this.dv.getUint32(this.at, true);
    this.at += 4;
    return v;
  }

  i32(): number {
    const v = this.dv.getInt32(this.at, true);
    this.at += 4;
    return v;
  }

  /** 길이(WORD) + UTF-16LE 문자열. HWP 의 표준 문자열 표현. */
  str(): string {
    const len = this.u16();
    const bytes = this.bytes.subarray(this.at, this.at + len * 2);
    this.at += len * 2;
    return new TextDecoder('utf-16le').decode(bytes);
  }

  /** COLORREF(0x00BBGGRR) → `#RRGGBB` */
  color(): string {
    const v = this.u32();
    const r = v & 0xff;
    const g = (v >>> 8) & 0xff;
    const b = (v >>> 16) & 0xff;
    return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  }

  bytesLeft(): Uint8Array {
    return this.bytes.subarray(this.at);
  }
}
