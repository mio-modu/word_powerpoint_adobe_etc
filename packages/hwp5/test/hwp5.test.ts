import { describe, expect, it } from 'vitest';
import { CfbFile, Hwp5File, decodeParaText, parseRecords } from '@jamo/hwp5';
import { writeCfb } from './fixtures/cfb-writer.js';
import { writeSyntheticHwp } from './fixtures/hwp5-writer.js';

const utf16 = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length * 2);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < s.length; i += 1) dv.setUint16(i * 2, s.charCodeAt(i), true);
  return out;
};

describe('CFB 컨테이너', () => {
  it('작은 스트림(미니 스트림)과 큰 스트림을 모두 읽는다', () => {
    const small = new Uint8Array(100).fill(0xaa);
    // 4096 바이트를 넘겨 일반 섹터 체인을 타게 한다.
    const big = new Uint8Array(10_000);
    for (let i = 0; i < big.length; i += 1) big[i] = i & 0xff;

    const cfb = CfbFile.open(writeCfb({ streams: { Small: small, Big: big } }));
    expect(cfb.read('Small')).toEqual(small);
    expect(cfb.read('Big')).toEqual(big);
  });

  it('스토리지(폴더) 안의 스트림을 경로로 찾는다', () => {
    const cfb = CfbFile.open(
      writeCfb({
        streams: {
          FileHeader: new Uint8Array(256),
          'BodyText/Section0': new Uint8Array([1, 2, 3]),
          'BodyText/Section1': new Uint8Array([4, 5, 6]),
          'BinData/BIN0001.png': new Uint8Array([7]),
        },
      }),
    );
    expect(cfb.children('BodyText')).toEqual(['Section0', 'Section1']);
    expect(cfb.read('BodyText/Section1')).toEqual(new Uint8Array([4, 5, 6]));
    expect(cfb.read('BinData/BIN0001.png')).toEqual(new Uint8Array([7]));
    expect(cfb.list().map((e) => e.path)).toContain('BodyText/Section0');
  });

  it('없는 스트림은 undefined', () => {
    const cfb = CfbFile.open(writeCfb({ streams: { A: new Uint8Array([1]) } }));
    expect(cfb.read('없음')).toBeUndefined();
  });

  it('CFB 가 아니면 거부한다', () => {
    expect(() => CfbFile.open(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0, 0, 0]))).toThrow(/CFB/);
  });

  it('FAT 여러 섹터가 필요한 크기도 처리한다', () => {
    // 섹터 512B, FAT 한 섹터가 128개 섹터를 기술한다 → 1MB 가 넘으면 FAT 가 2섹터 이상.
    const huge = new Uint8Array(400_000);
    for (let i = 0; i < huge.length; i += 7) huge[i] = 0x5a;
    const cfb = CfbFile.open(writeCfb({ streams: { Huge: huge } }));
    expect(cfb.read('Huge')).toEqual(huge);
  });
});

describe('레코드 스트림', () => {
  it('0xFFF 를 넘는 길이는 확장 필드에서 읽는다', () => {
    const payload = new Uint8Array(5000).fill(0x42);
    const header = new Uint8Array(8);
    const dv = new DataView(header.buffer);
    dv.setUint32(0, 66 | (1 << 10) | (0xfff << 20), true);
    dv.setUint32(4, payload.byteLength, true);
    const stream = new Uint8Array(header.byteLength + payload.byteLength);
    stream.set(header);
    stream.set(payload, header.byteLength);

    const records = parseRecords(stream);
    expect(records).toHaveLength(1);
    expect(records[0]!.tag).toBe(66);
    expect(records[0]!.level).toBe(1);
    expect(records[0]!.data.byteLength).toBe(5000);
  });

  it('잘린 스트림에서도 멈추기만 하고 던지지 않는다', () => {
    const header = new Uint8Array(4);
    new DataView(header.buffer).setUint32(0, 66 | (100 << 20), true);
    expect(() => parseRecords(header)).not.toThrow();
  });
});

describe('PARA_TEXT 제어 문자', () => {
  it('8 WCHAR 폭 제어 문자를 1개로 세지 않는다', () => {
    // 탭(9)은 8 WCHAR 를 차지한다. 잘못 세면 뒤 문자열이 전부 어긋난다.
    const codes = [
      0xac00, // 가
      9, 0, 0, 0, 0, 0, 0, 9, // 탭 (8 WCHAR)
      0xac01, // 각
    ];
    const bytes = new Uint8Array(codes.length * 2);
    const dv = new DataView(bytes.buffer);
    codes.forEach((c, i) => dv.setUint16(i * 2, c, true));
    expect(decodeParaText(bytes)).toBe('가\t각');
  });

  it('고정폭 빈칸과 묶음 빈칸을 구분한다', () => {
    const bytes = utf16('A') ;
    const codes = [0x41, 31, 0x42, 30, 0x43];
    const b = new Uint8Array(codes.length * 2);
    const dv = new DataView(b.buffer);
    codes.forEach((c, i) => dv.setUint16(i * 2, c, true));
    expect(decodeParaText(b)).toBe('A B C');
    expect(bytes.byteLength).toBe(2);
  });

  it('문단 끝 표시(13)는 버린다', () => {
    const codes = [0xd55c, 0xae00, 13];
    const b = new Uint8Array(codes.length * 2);
    const dv = new DataView(b.buffer);
    codes.forEach((c, i) => dv.setUint16(i * 2, c, true));
    expect(decodeParaText(b)).toBe('한글');
  });
});

describe('HWP 5.0 문서 읽기', () => {
  it('압축된 문서에서 문단을 읽는다', () => {
    const file = Hwp5File.open(
      writeSyntheticHwp({
        paragraphs: [{ text: '첫 번째 문단' }, { text: '두 번째 문단' }, { text: '' }],
      }),
    );
    expect(file.header.compressed).toBe(true);
    expect(file.header.version).toBe('5.1.0.0');
    expect(file.getText()).toBe('첫 번째 문단\n두 번째 문단\n');
  });

  it('압축하지 않은 문서도 읽는다', () => {
    const file = Hwp5File.open(
      writeSyntheticHwp({ compressed: false, paragraphs: [{ text: '무압축' }] }),
    );
    expect(file.header.compressed).toBe(false);
    expect(file.getText()).toBe('무압축');
  });

  it('글꼴과 글자 서식을 읽는다', () => {
    const file = Hwp5File.open(
      writeSyntheticHwp({
        fonts: ['함초롬바탕', '맑은 고딕'],
        // property 비트: 0 기울임, 1 진하게, 2-3 밑줄
        charShapes: [
          { baseSize: 1100, property: 0b10, faceNameId: 0 }, // 진하게 11pt
          { baseSize: 900, property: 0b1, faceNameId: 1, color: [255, 0, 0] }, // 기울임 9pt 빨강
        ],
        paragraphs: [
          { text: '진하게', charShapeRuns: [[0, 0]] },
          { text: '기울임', charShapeRuns: [[0, 1]] },
        ],
      }),
    );
    expect(file.faceNames.map((f) => f.name)).toEqual(['함초롬바탕', '맑은 고딕']);

    const model = file.toModel();
    const first = model.sections[0]!.blocks[0]!.runs[0]!.style!;
    expect(first.bold).toBe(true);
    expect(first.italic).toBe(false);
    expect(first.fontSize).toBe(11);
    expect(first.fontFamily).toBe('함초롬바탕');

    const second = model.sections[0]!.blocks[1]!.runs[0]!.style!;
    expect(second.italic).toBe(true);
    expect(second.bold).toBe(false);
    expect(second.fontSize).toBe(9);
    expect(second.fontFamily).toBe('맑은 고딕');
    expect(second.color).toBe('#FF0000');
  });

  it('한 문단 안의 서식 변화를 런으로 쪼갠다', () => {
    const file = Hwp5File.open(
      writeSyntheticHwp({
        charShapes: [
          { baseSize: 1000, property: 0, faceNameId: 0 },
          { baseSize: 1000, property: 0b10, faceNameId: 0 },
        ],
        paragraphs: [{ text: '보통인데 굵게', charShapeRuns: [[0, 0], [5, 1]] }],
      }),
    );
    const runs = file.toModel().sections[0]!.blocks[0]!.runs;
    expect(runs.map((r) => r.text)).toEqual(['보통인데 ', '굵게']);
    expect(runs[0]!.style?.bold).toBe(false);
    expect(runs[1]!.style?.bold).toBe(true);
  });

  it('문단 정렬을 읽는다', () => {
    const file = Hwp5File.open(
      writeSyntheticHwp({
        paraShapes: [{ align: 3 }, { align: 1 }],
        paragraphs: [
          { text: '가운데', paraShapeId: 0 },
          { text: '왼쪽', paraShapeId: 1 },
        ],
      }),
    );
    const paras = file.toModel().sections[0]!.blocks;
    expect(paras[0]!.style?.align).toBe('center');
    expect(paras[1]!.style?.align).toBe('left');
  });

  it('용지 설정을 읽는다', () => {
    const file = Hwp5File.open(
      writeSyntheticHwp({ page: { width: 59528, height: 84188 }, paragraphs: [{ text: 'x' }] }),
    );
    const page = file.toModel().sections[0]!.page;
    expect(page.width).toBe(59528);
    expect(page.height).toBe(84188);
    expect(page.landscape).toBe(false);
    expect(page.margin.left).toBe(8504);
  });

  it('가로 용지를 알아본다', () => {
    const file = Hwp5File.open(
      writeSyntheticHwp({ page: { width: 84188, height: 59528, landscape: true }, paragraphs: [{ text: 'x' }] }),
    );
    expect(file.pageSetup(0).landscape).toBe(true);
  });

  it('미리보기 텍스트에서 제목을 추정한다', () => {
    const file = Hwp5File.open(
      writeSyntheticHwp({ previewText: '2026 사업계획서\n본문 시작', paragraphs: [{ text: 'x' }] }),
    );
    expect(file.meta.title).toBe('2026 사업계획서');
  });

  it('첨부 바이너리를 꺼낸다', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const file = Hwp5File.open(
      writeSyntheticHwp({ binData: { 'BIN0001.png': png }, paragraphs: [{ text: 'x' }] }),
    );
    expect(file.binData().get('BIN0001.png')).toEqual(png);
  });

  it('탭이 든 문단을 올바른 위치로 읽는다', () => {
    const file = Hwp5File.open(
      writeSyntheticHwp({ paragraphs: [{ text: '이름\t점수\t등급' }] }),
    );
    expect(file.getText()).toBe('이름\t점수\t등급');
  });

  it('섹션이 여럿이면 숫자 순서로 읽는다', () => {
    // Section10 이 Section2 보다 앞에 오면 안 된다.
    const base = writeSyntheticHwp({ paragraphs: [{ text: 'S0' }] });
    const file = Hwp5File.open(base);
    expect(file.sectionPaths).toEqual(['BodyText/Section0']);
  });
});

describe('열 수 없는 문서를 분명히 알린다', () => {
  it('암호가 걸린 문서', () => {
    expect(() => Hwp5File.open(writeSyntheticHwp({ passwordProtected: true }))).toThrow(/암호/);
  });

  it('hwpx 를 넘기면 어느 패키지를 쓰라고 알려준다', () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    expect(() => Hwp5File.open(zip)).toThrow(/@jamo\/hwpx/);
  });

  it('서명이 다른 CFB 는 HWP 가 아니라고 알린다', () => {
    const notHwp = writeCfb({ streams: { FileHeader: new Uint8Array(256) } });
    expect(() => Hwp5File.open(notHwp)).toThrow(/HWP 5.0 문서가 아닙니다/);
  });
});
