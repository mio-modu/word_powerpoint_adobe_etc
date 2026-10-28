import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync, zipSync } from 'fflate';
import { HwpxFile } from '@jamo/hwpx';
import { parseXml, serializeXml, childElements, attr } from '@jamo/core';

function reopen(file: HwpxFile): HwpxFile {
  return HwpxFile.open(file.save());
}

describe('빈 HWPX 만들기', () => {
  it('저장했다가 다시 열 수 있다', () => {
    const file = HwpxFile.blank({ text: '첫 문단입니다' });
    const again = reopen(file);
    expect(again.getText()).toBe('첫 문단입니다');
    expect(again.sectionCount).toBe(1);
  });

  it('mimetype 이 맨 앞 + 무압축이다 (OCF 규칙)', () => {
    const bytes = HwpxFile.blank().save();
    // 로컬 파일 헤더: 0..3 시그니처, 8..9 압축방식, 30.. 파일명
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const method = bytes[8]! | (bytes[9]! << 8);
    expect(method).toBe(0); // 0 = stored
    const nameLen = bytes[26]! | (bytes[27]! << 8);
    expect(strFromU8(bytes.slice(30, 30 + nameLen))).toBe('mimetype');
  });

  it('필수 파트를 모두 담는다', () => {
    const entries = Object.keys(unzipSync(HwpxFile.blank().save()));
    expect(entries).toContain('mimetype');
    expect(entries).toContain('version.xml');
    expect(entries).toContain('META-INF/container.xml');
    expect(entries).toContain('META-INF/manifest.xml');
    expect(entries).toContain('Contents/content.hpf');
    expect(entries).toContain('Contents/header.xml');
    expect(entries).toContain('Contents/section0.xml');
    expect(entries).toContain('settings.xml');
  });

  it('version.xml 은 스펙 오타(tagetApplication)를 그대로 쓴다', () => {
    const raw = strFromU8(unzipSync(HwpxFile.blank().save())['version.xml']!);
    expect(raw).toContain('tagetApplication="WORDPROCESSOR"');
  });

  it('header.xml 의 참조가 서로 맞물린다', () => {
    const file = HwpxFile.blank();
    const tables = file.styles;
    expect(tables.charPr.has('0')).toBe(true);
    expect(tables.paraPr.has('0')).toBe(true);
    const style = tables.styles.get('0')!;
    expect(tables.paraPr.has(attr(style, 'paraPrIDRef')!)).toBe(true);
    expect(tables.charPr.has(attr(style, 'charPrIDRef')!)).toBe(true);
    // 본문 문단도 존재하는 ID 만 가리켜야 한다.
    const p = childElements(file.sectionRoot(0), 'hp:p')[0]!;
    expect(tables.paraPr.has(attr(p, 'paraPrIDRef')!)).toBe(true);
  });
});

describe('문단 편집', () => {
  it('문단을 추가하고 텍스트를 읽는다', () => {
    const file = HwpxFile.blank({ text: '제목' });
    file.appendParagraph(0, '둘째 줄');
    file.appendParagraph(0, '셋째 줄');
    expect(reopen(file).getText()).toBe('제목\n둘째 줄\n셋째 줄');
  });

  it('문단 텍스트를 바꾼다', () => {
    const file = HwpxFile.blank({ text: '바꾸기 전' });
    const [p] = file.paragraphs(0);
    file.setParagraphText(p!.element, '바꾼 뒤');
    expect(reopen(file).getText()).toBe('바꾼 뒤');
  });

  it('중간에 문단을 끼워 넣는다', () => {
    const file = HwpxFile.blank({ text: 'A' });
    file.appendParagraph(0, 'C');
    const [first] = file.paragraphs(0);
    file.insertParagraphAfter(0, first!.element, 'B');
    expect(file.getText()).toBe('A\nB\nC');
  });

  it('첫 문단을 지워도 섹션 설정(secPr)은 살아남는다', () => {
    const file = HwpxFile.blank({ text: '지울 내용' });
    const [first] = file.paragraphs(0);
    file.removeParagraph(0, first!.element);
    const again = reopen(file);
    expect(again.getText()).toBe('');
    expect(again.toModel().sections[0]!.page.width).toBe(59528);
  });

  it('두 번째 문단은 완전히 지워진다', () => {
    const file = HwpxFile.blank({ text: 'A' });
    const added = file.appendParagraph(0, 'B');
    file.removeParagraph(0, added);
    expect(file.getText()).toBe('A');
  });
});

describe('무손실 보존', () => {
  it('해석하지 않는 바이너리 항목을 그대로 보존한다', () => {
    const file = HwpxFile.blank({ text: 'x' });
    const saved = file.save();
    // 이미지가 붙어 있는 문서를 흉내 낸다.
    const entries = unzipSync(saved);
    const withImage = new Map<string, Uint8Array>(
      Object.entries(entries).map(([k, v]) => [k, v] as [string, Uint8Array]),
    );
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    withImage.set('BinData/image1.png', png);

    // 다시 패키징해서 열고, 글자만 고쳐 저장한다.
    const input: Record<string, Uint8Array> = {};
    for (const [k, v] of withImage) input[k] = v;
    const repacked = HwpxFile.open(zipSync(input));
    const [p] = repacked.paragraphs(0);
    repacked.setParagraphText(p!.element, 'y');
    const out = unzipSync(repacked.save());
    expect(out['BinData/image1.png']).toEqual(png);
    expect(HwpxFile.open(repacked.save()).getText()).toBe('y');
  });

  it('모르는 요소가 섞인 섹션도 손실 없이 왕복한다', () => {
    const file = HwpxFile.blank({ text: '표가 있는 문서' });
    const sec = file.sectionRoot(0);
    // 우리가 아직 모델링하지 않은 요소를 심어둔다.
    sec.children.push(
      parseXml('<?xml version="1.0"?><hp:p id="99"><hp:run charPrIDRef="0"><hp:tbl rowCnt="2" colCnt="2"><hp:tr/><hp:tr/></hp:tbl></hp:run></hp:p>').root,
    );
    const again = reopen(file);
    const tbl = serializeXml({ ...parseXml('<?xml version="1.0"?><x/>'), root: again.sectionRoot(0) });
    expect(tbl).toContain('<hp:tbl rowCnt="2" colCnt="2">');
  });
});

describe('메타데이터', () => {
  it('제목과 작성자를 쓰고 읽는다', () => {
    const file = HwpxFile.blank();
    file.setMeta({ title: '사업계획서', creator: '홍길동' });
    const meta = reopen(file).meta;
    expect(meta.title).toBe('사업계획서');
    expect(meta.creator).toBe('홍길동');
    expect(meta.language).toBe('ko');
  });
});

describe('섹션 추가', () => {
  it('섹션을 더하면 매니페스트와 spine 이 함께 늘어난다', () => {
    const file = HwpxFile.blank({ text: '1장' });
    const idx = file.addSection({ text: '2장' });
    expect(idx).toBe(1);
    const again = reopen(file);
    expect(again.sectionCount).toBe(2);
    expect(again.getText()).toBe('1장\n2장');
  });
});

describe('모델 변환', () => {
  it('서식이 모델에 반영된다', () => {
    const file = HwpxFile.blank({ text: '본문' });
    const model = file.toModel();
    const para = model.sections[0]!.paragraphs[0]!;
    expect(para.runs[0]!.text).toBe('본문');
    expect(para.runs[0]!.style?.fontSize).toBe(10);
    expect(para.runs[0]!.style?.fontFamily).toBe('함초롬바탕');
    expect(para.style?.styleName).toBe('바탕글');
    expect(model.sections[0]!.page.height).toBe(84188);
  });
});

describe('형식 판별', () => {
  it('DOCX 를 HWPX 로 열면 거부한다', async () => {
    const { DocxFile } = await import('@jamo/docx');
    expect(() => HwpxFile.open(DocxFile.blank().save())).toThrow(/HWPX 파일이 아닙니다/);
  });

  it('PPTX 를 HWPX 로 열면 거부한다', async () => {
    const { PptxFile } = await import('@jamo/pptx');
    expect(() => HwpxFile.open(PptxFile.blank().save())).toThrow(/OOXML/);
  });

  it('ZIP 이 아니면 거부한다', () => {
    expect(() => HwpxFile.open(new Uint8Array([1, 2, 3, 4]))).toThrow(/HWPX 파일이 아닙니다/);
  });
});
