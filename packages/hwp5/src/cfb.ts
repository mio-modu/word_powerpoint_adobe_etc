/**
 * CFB (Compound File Binary) 리더. OLE2 복합 문서 컨테이너.
 *
 * 구형 `.hwp` 는 물론 `.doc`, `.ppt`, `.xls` 가 모두 이 컨테이너를 쓴다.
 * "파일 안의 작은 파일 시스템" 이라고 보면 된다. FAT 으로 섹터를 연결하고,
 * 디렉터리 항목이 적흑트리로 묶여 있다.
 *
 * 구현상 까다로운 지점 두 가지:
 * 1. 4096 바이트보다 작은 스트림은 일반 섹터가 아니라 "미니 스트림" 안에
 *    64바이트 단위로 들어간다. 이걸 놓치면 작은 스트림이 전부 깨진다.
 * 2. FAT 자체가 커지면 DIFAT 체인을 따라가야 한다. 헤더에 들어가는 건
 *    앞쪽 109개뿐이다.
 */

const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

const FREESECT = 0xffffffff;
const ENDOFCHAIN = 0xfffffffe;
const FATSECT = 0xfffffffd;
const DIFSECT = 0xfffffffc;
const NOSTREAM = 0xffffffff;

export class CfbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CfbError';
  }
}

export type CfbEntryType = 'root' | 'storage' | 'stream';

export interface CfbEntry {
  name: string;
  /** `BodyText/Section0` 처럼 `/` 로 이은 전체 경로. */
  path: string;
  type: CfbEntryType;
  size: number;
}

interface RawEntry {
  name: string;
  type: CfbEntryType;
  left: number;
  right: number;
  child: number;
  start: number;
  size: number;
}

export class CfbFile {
  private readonly view: DataView;
  private readonly bytes: Uint8Array;
  private readonly sectorSize: number;
  private readonly miniSectorSize: number;
  private readonly miniCutoff: number;
  private readonly fat: Uint32Array;
  private readonly miniFat: Uint32Array;
  private readonly entries: RawEntry[];
  private readonly byPath = new Map<string, RawEntry>();
  private miniStream: Uint8Array | undefined;

  private constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    for (let i = 0; i < SIGNATURE.length; i += 1) {
      if (bytes[i] !== SIGNATURE[i]) throw new CfbError('CFB(OLE2) 컨테이너가 아닙니다.');
    }

    const sectorShift = this.view.getUint16(30, true);
    const miniSectorShift = this.view.getUint16(32, true);
    this.sectorSize = 1 << sectorShift;
    this.miniSectorSize = 1 << miniSectorShift;
    this.miniCutoff = this.view.getUint32(56, true);
    if (this.sectorSize < 128 || this.sectorSize > 1 << 20) {
      throw new CfbError(`섹터 크기가 비정상입니다: ${this.sectorSize}`);
    }

    this.fat = this.readFat();
    this.miniFat = this.readMiniFat();
    this.entries = this.readDirectory();
    this.indexTree();
  }

  static open(bytes: Uint8Array): CfbFile {
    return new CfbFile(bytes);
  }

  static looksLikeCfb(bytes: Uint8Array): boolean {
    return bytes.length >= 8 && SIGNATURE.every((b, i) => bytes[i] === b);
  }

  // ------------------------------------------------------------------ 섹터

  private sectorOffset(sector: number): number {
    return (sector + 1) * this.sectorSize;
  }

  private readSector(sector: number): Uint8Array {
    const start = this.sectorOffset(sector);
    if (start + this.sectorSize > this.bytes.length) {
      // 마지막 섹터가 잘린 파일도 있다. 있는 만큼만 돌려준다.
      if (start >= this.bytes.length) throw new CfbError(`섹터 ${sector} 가 파일 범위를 벗어납니다.`);
      return this.bytes.subarray(start);
    }
    return this.bytes.subarray(start, start + this.sectorSize);
  }

  private readFat(): Uint32Array {
    const fatCount = this.view.getUint32(44, true);
    const entriesPerSector = this.sectorSize / 4;

    // DIFAT: 헤더에 109개, 그 뒤는 섹터 체인으로 이어진다.
    const fatSectors: number[] = [];
    for (let i = 0; i < 109 && fatSectors.length < fatCount; i += 1) {
      const sector = this.view.getUint32(76 + i * 4, true);
      if (sector === FREESECT || sector === ENDOFCHAIN) break;
      fatSectors.push(sector);
    }

    let difat = this.view.getUint32(68, true);
    const difatCount = this.view.getUint32(72, true);
    let guard = 0;
    while (difat !== ENDOFCHAIN && difat !== FREESECT && guard <= difatCount + 1) {
      const sec = this.readSector(difat);
      const dv = new DataView(sec.buffer, sec.byteOffset, sec.byteLength);
      for (let i = 0; i < entriesPerSector - 1; i += 1) {
        const s = dv.getUint32(i * 4, true);
        if (s === FREESECT || s === ENDOFCHAIN) continue;
        fatSectors.push(s);
      }
      difat = dv.getUint32((entriesPerSector - 1) * 4, true);
      guard += 1;
    }

    const fat = new Uint32Array(fatSectors.length * entriesPerSector);
    let at = 0;
    for (const sector of fatSectors) {
      const sec = this.readSector(sector);
      const dv = new DataView(sec.buffer, sec.byteOffset, sec.byteLength);
      const n = Math.floor(sec.byteLength / 4);
      for (let i = 0; i < n && at < fat.length; i += 1, at += 1) {
        fat[at] = dv.getUint32(i * 4, true);
      }
    }
    return fat;
  }

  private readMiniFat(): Uint32Array {
    const start = this.view.getUint32(60, true);
    const count = this.view.getUint32(64, true);
    if (start === ENDOFCHAIN || count === 0) return new Uint32Array(0);
    const data = this.readChain(start, count * this.sectorSize);
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const out = new Uint32Array(Math.floor(data.byteLength / 4));
    for (let i = 0; i < out.length; i += 1) out[i] = dv.getUint32(i * 4, true);
    return out;
  }

  /** FAT 체인을 따라 섹터를 이어 붙인다. */
  private readChain(start: number, maxBytes: number): Uint8Array {
    const parts: Uint8Array[] = [];
    let sector = start;
    let total = 0;
    const seen = new Set<number>();
    while (sector !== ENDOFCHAIN && sector !== FREESECT && total < maxBytes) {
      if (sector === FATSECT || sector === DIFSECT) break;
      if (seen.has(sector)) throw new CfbError('FAT 체인에 순환이 있습니다. 손상된 파일입니다.');
      seen.add(sector);
      const sec = this.readSector(sector);
      parts.push(sec);
      total += sec.byteLength;
      const next = this.fat[sector];
      if (next === undefined) break;
      sector = next;
    }
    return concat(parts, Math.min(total, maxBytes));
  }

  private readMiniChain(start: number, size: number): Uint8Array {
    const mini = this.ensureMiniStream();
    const parts: Uint8Array[] = [];
    let sector = start;
    let total = 0;
    const seen = new Set<number>();
    while (sector !== ENDOFCHAIN && sector !== FREESECT && total < size) {
      if (seen.has(sector)) throw new CfbError('미니 FAT 체인에 순환이 있습니다.');
      seen.add(sector);
      const offset = sector * this.miniSectorSize;
      parts.push(mini.subarray(offset, offset + this.miniSectorSize));
      total += this.miniSectorSize;
      const next = this.miniFat[sector];
      if (next === undefined) break;
      sector = next;
    }
    return concat(parts, Math.min(total, size));
  }

  private ensureMiniStream(): Uint8Array {
    if (this.miniStream) return this.miniStream;
    const root = this.entries[0];
    if (!root) throw new CfbError('루트 디렉터리 항목이 없습니다.');
    this.miniStream = this.readChain(root.start, root.size);
    return this.miniStream;
  }

  // -------------------------------------------------------------- 디렉터리

  private readDirectory(): RawEntry[] {
    const firstDir = this.view.getUint32(48, true);
    // 디렉터리 길이는 헤더에 없다. 체인을 끝까지 따라간다.
    const data = this.readChain(firstDir, Number.MAX_SAFE_INTEGER);
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const count = Math.floor(data.byteLength / 128);
    const out: RawEntry[] = [];
    const decoder = new TextDecoder('utf-16le');

    for (let i = 0; i < count; i += 1) {
      const base = i * 128;
      const typeByte = dv.getUint8(base + 66);
      if (typeByte === 0) {
        out.push({ name: '', type: 'stream', left: NOSTREAM, right: NOSTREAM, child: NOSTREAM, start: 0, size: 0 });
        continue;
      }
      const nameLen = dv.getUint16(base + 64, true);
      // nameLen 은 널 종료 문자를 포함한 바이트 수.
      const raw = data.subarray(base, base + Math.max(0, Math.min(64, nameLen - 2)));
      const name = decoder.decode(raw);
      const type: CfbEntryType = typeByte === 5 ? 'root' : typeByte === 1 ? 'storage' : 'stream';
      // 스트림 크기는 64비트지만 상위 32비트는 사실상 0 이다.
      const sizeLow = dv.getUint32(base + 120, true);
      const sizeHigh = dv.getUint32(base + 124, true);
      out.push({
        name,
        type,
        left: dv.getUint32(base + 68, true),
        right: dv.getUint32(base + 72, true),
        child: dv.getUint32(base + 76, true),
        start: dv.getUint32(base + 116, true),
        size: sizeHigh > 0 ? Number.MAX_SAFE_INTEGER : sizeLow,
      });
    }
    return out;
  }

  /** 적흑트리를 훑어 경로 → 항목 색인을 만든다. */
  private indexTree(): void {
    const root = this.entries[0];
    if (!root) return;
    this.byPath.set('', root);

    const walkSiblings = (id: number, prefix: string): void => {
      if (id === NOSTREAM || id >= this.entries.length) return;
      const entry = this.entries[id]!;
      if (entry.name === '') return;
      const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      this.byPath.set(path, entry);
      if (entry.type === 'storage' || entry.type === 'root') {
        walkSiblings(entry.child, path);
      }
      walkSiblings(entry.left, prefix);
      walkSiblings(entry.right, prefix);
    };
    walkSiblings(root.child, '');
  }

  // ------------------------------------------------------------------ 공개

  list(): CfbEntry[] {
    const out: CfbEntry[] = [];
    for (const [path, entry] of this.byPath) {
      if (path === '') continue;
      out.push({ name: entry.name, path, type: entry.type, size: entry.size });
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  has(path: string): boolean {
    return this.byPath.has(path);
  }

  /** 스트림 내용을 읽는다. 없으면 undefined. */
  read(path: string): Uint8Array | undefined {
    const entry = this.byPath.get(path);
    if (!entry || entry.type !== 'stream') return undefined;
    if (entry.size === 0) return new Uint8Array(0);
    const data =
      entry.size < this.miniCutoff
        ? this.readMiniChain(entry.start, entry.size)
        : this.readChain(entry.start, entry.size);
    return data.byteLength > entry.size ? data.subarray(0, entry.size) : data;
  }

  /** 스토리지(폴더) 바로 아래 항목 이름들. */
  children(storagePath: string): string[] {
    const prefix = storagePath === '' ? '' : `${storagePath}/`;
    const out: string[] = [];
    for (const path of this.byPath.keys()) {
      if (path === '' || !path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      if (rest !== '' && !rest.includes('/')) out.push(rest);
    }
    return out.sort();
  }
}

function concat(parts: Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    if (at >= size) break;
    const take = Math.min(part.byteLength, size - at);
    out.set(part.subarray(0, take), at);
    at += take;
  }
  return out;
}
