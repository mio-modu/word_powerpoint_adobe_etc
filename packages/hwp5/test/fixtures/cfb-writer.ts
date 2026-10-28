/**
 * 테스트용 최소 CFB 라이터.
 *
 * 진짜 `.hwp` 파일을 구할 수 없는 환경에서도 리더를 제대로 검증하려면
 * 입력을 만들 수 있어야 한다. 특히 다음을 의도적으로 재현한다:
 *  - 4096 바이트 미만 스트림은 미니 스트림에 들어간다
 *  - 큰 스트림은 일반 섹터 체인을 쓴다
 *  - 스토리지(폴더) 안의 스트림
 *
 * 제품 코드가 아니라 픽스처 생성기이므로 DIFAT(FAT 109섹터 초과)은 다루지
 * 않는다. 테스트 파일은 그 규모에 이르지 않는다.
 */

const SECTOR = 512;
const MINI_SECTOR = 64;
const MINI_CUTOFF = 4096;
const FAT_ENTRIES_PER_SECTOR = SECTOR / 4;

const FREESECT = 0xffffffff;
const ENDOFCHAIN = 0xfffffffe;
const FATSECT = 0xfffffffd;
const NOSTREAM = 0xffffffff;

export interface CfbInput {
  /** `BodyText/Section0` 처럼 `/` 로 구분한 경로 → 내용. */
  streams: Record<string, Uint8Array>;
}

interface DirEntry {
  name: string;
  type: 1 | 2 | 5;
  child: number;
  right: number;
  start: number;
  size: number;
}

export function writeCfb(input: CfbInput): Uint8Array {
  // 1) 경로를 트리로 정리한다.
  const storages = new Set<string>();
  for (const path of Object.keys(input.streams)) {
    const parts = path.split('/');
    for (let i = 0; i < parts.length - 1; i += 1) storages.add(parts.slice(0, i + 1).join('/'));
  }

  const childrenOf = (parent: string): string[] => {
    const prefix = parent === '' ? '' : `${parent}/`;
    const names: string[] = [];
    for (const path of [...storages, ...Object.keys(input.streams)]) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      if (rest !== '' && !rest.includes('/')) names.push(path);
    }
    return [...new Set(names)].sort();
  };

  // 2) 디렉터리 항목을 만든다. 0번은 루트.
  const entries: DirEntry[] = [
    { name: 'Root Entry', type: 5, child: NOSTREAM, right: NOSTREAM, start: 0, size: 0 },
  ];
  const indexByPath = new Map<string, number>([['', 0]]);

  const addSubtree = (parent: string): number => {
    const kids = childrenOf(parent);
    if (kids.length === 0) return NOSTREAM;
    const ids: number[] = [];
    for (const path of kids) {
      const name = path.slice(path.lastIndexOf('/') + 1);
      const isStorage = storages.has(path);
      const id = entries.length;
      entries.push({
        name,
        type: isStorage ? 1 : 2,
        child: NOSTREAM,
        right: NOSTREAM,
        start: 0,
        size: isStorage ? 0 : (input.streams[path]?.byteLength ?? 0),
      });
      indexByPath.set(path, id);
      ids.push(id);
    }
    // 적흑트리 대신 오른쪽으로만 이어진 사슬로 둔다. 리더는 left/right/child
    // 를 따라가기만 하므로 균형은 필요 없다.
    for (let i = 0; i < ids.length - 1; i += 1) entries[ids[i]!]!.right = ids[i + 1]!;
    for (const path of kids) {
      if (storages.has(path)) {
        entries[indexByPath.get(path)!]!.child = addSubtree(path);
      }
    }
    return ids[0]!;
  };
  entries[0]!.child = addSubtree('');

  // 3) 스트림을 미니/일반으로 나눈다.
  const miniParts: Uint8Array[] = [];
  let miniSectorCount = 0;
  const bigStreams: Array<{ id: number; data: Uint8Array }> = [];

  for (const [path, data] of Object.entries(input.streams)) {
    const id = indexByPath.get(path)!;
    if (data.byteLength === 0) {
      entries[id]!.start = ENDOFCHAIN;
      continue;
    }
    if (data.byteLength < MINI_CUTOFF) {
      entries[id]!.start = miniSectorCount;
      const needed = Math.ceil(data.byteLength / MINI_SECTOR);
      const padded = new Uint8Array(needed * MINI_SECTOR);
      padded.set(data);
      miniParts.push(padded);
      miniSectorCount += needed;
    } else {
      bigStreams.push({ id, data });
    }
  }

  const miniStream = concat(miniParts);

  // 미니 FAT: 각 스트림이 자기 섹터들을 순서대로 이어 쓴다.
  const miniFat = new Uint32Array(miniSectorCount);
  miniFat.fill(ENDOFCHAIN);
  {
    let at = 0;
    for (const data of miniParts) {
      const n = data.byteLength / MINI_SECTOR;
      for (let i = 0; i < n - 1; i += 1) miniFat[at + i] = at + i + 1;
      miniFat[at + n - 1] = ENDOFCHAIN;
      at += n;
    }
  }

  // 4) 섹터에 담길 항목들을 순서대로 늘어놓는다.
  const items: Array<{ bytes: Uint8Array; assign?: (startSector: number) => void }> = [];
  for (const { id, data } of bigStreams) {
    items.push({ bytes: data, assign: (s) => void (entries[id]!.start = s) });
  }
  let miniStreamStart = ENDOFCHAIN;
  if (miniStream.byteLength > 0) {
    items.push({ bytes: miniStream, assign: (s) => void (miniStreamStart = s) });
  }
  let miniFatStart = ENDOFCHAIN;
  if (miniFat.length > 0) {
    items.push({ bytes: u32Bytes(miniFat), assign: (s) => void (miniFatStart = s) });
  }

  const dirBytes = buildDirectory(entries);
  let dirStart = ENDOFCHAIN;
  items.push({ bytes: dirBytes, assign: (s) => void (dirStart = s) });

  const itemSectors = items.reduce((sum, it) => sum + Math.ceil(it.bytes.byteLength / SECTOR), 0);

  // FAT 섹터 수는 자기 자신도 포함해 세야 하므로 안정될 때까지 반복한다.
  let fatSectorCount = 1;
  for (;;) {
    const total = fatSectorCount + itemSectors;
    const needed = Math.max(1, Math.ceil(total / FAT_ENTRIES_PER_SECTOR));
    if (needed === fatSectorCount) break;
    fatSectorCount = needed;
  }

  const fat = new Uint32Array(fatSectorCount * FAT_ENTRIES_PER_SECTOR);
  fat.fill(FREESECT);
  for (let i = 0; i < fatSectorCount; i += 1) fat[i] = FATSECT;

  // 5) 섹터를 배정하고 FAT 체인을 잇는다.
  let nextSector = fatSectorCount;
  const payload: Uint8Array[] = [];
  for (const item of items) {
    const n = Math.ceil(item.bytes.byteLength / SECTOR);
    const start = nextSector;
    for (let i = 0; i < n; i += 1) {
      fat[start + i] = i === n - 1 ? ENDOFCHAIN : start + i + 1;
    }
    const padded = new Uint8Array(n * SECTOR);
    padded.set(item.bytes);
    payload.push(padded);
    item.assign?.(start);
    nextSector += n;
  }

  // 루트 항목에 미니 스트림 위치를 기록한다.
  entries[0]!.start = miniStreamStart;
  entries[0]!.size = miniStream.byteLength;
  const dirBytesFinal = buildDirectory(entries);
  // 디렉터리는 마지막 항목이므로 그 자리에 다시 써 넣으면 된다.
  const dirPadded = payload[payload.length - 1]!;
  dirPadded.fill(0);
  dirPadded.set(dirBytesFinal);

  // 6) 헤더
  const header = new Uint8Array(SECTOR);
  const hv = new DataView(header.buffer);
  header.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  hv.setUint16(24, 0x003e, true); // minor version
  hv.setUint16(26, 0x0003, true); // major version
  hv.setUint16(28, 0xfffe, true); // little endian
  hv.setUint16(30, 9, true); // 섹터 512
  hv.setUint16(32, 6, true); // 미니 섹터 64
  hv.setUint32(44, fatSectorCount, true);
  hv.setUint32(48, dirStart, true);
  hv.setUint32(56, MINI_CUTOFF, true);
  hv.setUint32(60, miniFatStart, true);
  hv.setUint32(64, miniFat.length > 0 ? Math.ceil((miniFat.length * 4) / SECTOR) : 0, true);
  hv.setUint32(68, ENDOFCHAIN, true); // DIFAT 없음
  hv.setUint32(72, 0, true);
  for (let i = 0; i < 109; i += 1) {
    hv.setUint32(76 + i * 4, i < fatSectorCount ? i : FREESECT, true);
  }

  const fatBytes = new Uint8Array(fatSectorCount * SECTOR);
  fatBytes.set(u32Bytes(fat));

  return concat([header, fatBytes, ...payload]);
}

function buildDirectory(entries: DirEntry[]): Uint8Array {
  // 디렉터리는 섹터 단위로 맞춘다. 512/128 = 4개씩.
  const count = Math.max(4, Math.ceil(entries.length / 4) * 4);
  const out = new Uint8Array(count * 128);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < count; i += 1) {
    const base = i * 128;
    const entry = entries[i];
    if (!entry) {
      dv.setUint32(base + 68, NOSTREAM, true);
      dv.setUint32(base + 72, NOSTREAM, true);
      dv.setUint32(base + 76, NOSTREAM, true);
      continue;
    }
    const nameBytes = utf16le(entry.name);
    out.set(nameBytes.subarray(0, 62), base);
    dv.setUint16(base + 64, Math.min(nameBytes.byteLength + 2, 64), true);
    dv.setUint8(base + 66, entry.type);
    dv.setUint8(base + 67, 1); // black
    dv.setUint32(base + 68, NOSTREAM, true); // left
    dv.setUint32(base + 72, entry.right, true);
    dv.setUint32(base + 76, entry.child, true);
    dv.setUint32(base + 116, entry.start, true);
    dv.setUint32(base + 120, entry.size, true);
    dv.setUint32(base + 124, 0, true);
  }
  return out;
}

function utf16le(value: string): Uint8Array {
  const out = new Uint8Array(value.length * 2);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < value.length; i += 1) dv.setUint16(i * 2, value.charCodeAt(i), true);
  return out;
}

function u32Bytes(values: Uint32Array): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < values.length; i += 1) dv.setUint32(i * 4, values[i]!, true);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.byteLength, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}
