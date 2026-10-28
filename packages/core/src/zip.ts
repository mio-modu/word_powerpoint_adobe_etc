import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';

/**
 * HWPX, DOCX, PPTX 는 전부 "ZIP 안에 XML" 이다.
 * 이 모듈이 그 공통 껍데기를 담당한다.
 *
 * 한 가지 중요한 규칙: OCF 계열(ODF/EPUB/HWPX)은 `mimetype` 항목이
 * **맨 앞에, 무압축(stored)으로** 들어가야 한다. 파일 앞 30바이트만 읽고
 * 종류를 판별하는 도구들이 그걸 전제로 동작하기 때문이다.
 */

export type ZipEntries = Map<string, Uint8Array>;

export interface ZipWriteOptions {
  /** 무압축으로 저장할 항목 경로. */
  stored?: readonly string[];
  /** 이 순서를 먼저 지킨 뒤, 나머지는 입력 순서대로 쓴다. */
  order?: readonly string[];
  /** deflate 레벨 0–9. 기본 6. */
  level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
}

export function unzip(data: Uint8Array): ZipEntries {
  const raw = unzipSync(data);
  const out: ZipEntries = new Map();
  for (const [name, bytes] of Object.entries(raw)) {
    // 디렉터리 항목은 버린다.
    if (name.endsWith('/')) continue;
    out.set(name, bytes);
  }
  return out;
}

export function zip(entries: ZipEntries, options: ZipWriteOptions = {}): Uint8Array {
  const stored = new Set(options.stored ?? []);
  const level = options.level ?? 6;

  const names: string[] = [];
  for (const name of options.order ?? []) {
    if (entries.has(name)) names.push(name);
  }
  for (const name of entries.keys()) {
    if (!names.includes(name)) names.push(name);
  }

  // fflate 는 객체 키 순서대로 기록하므로, 삽입 순서가 곧 ZIP 순서다.
  const input: Record<string, [Uint8Array, { level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 }]> = {};
  for (const name of names) {
    input[name] = [entries.get(name)!, { level: stored.has(name) ? 0 : level }];
  }
  return zipSync(input);
}

export function entryToString(entries: ZipEntries, path: string): string | undefined {
  const bytes = entries.get(path);
  return bytes === undefined ? undefined : strFromU8(bytes);
}

export function stringToEntry(value: string): Uint8Array {
  return strToU8(value);
}

/** ZIP 로컬 헤더 시그니처 확인. 잘못된 파일을 일찍 걸러낸다. */
export function looksLikeZip(data: Uint8Array): boolean {
  return data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04;
}

/** OLE2/CFB(= 구형 .hwp, .doc, .ppt) 시그니처 확인. */
export function looksLikeCfb(data: Uint8Array): boolean {
  const sig = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  if (data.length < 8) return false;
  return sig.every((b, i) => data[i] === b);
}
