import { describe, expect, it } from 'vitest';
import { HwpxFile } from '@jamo/hwpx';
import { DocxFile } from '@jamo/docx';
import { Hwp5File } from '@jamo/hwp5';
import { attr, childElements, firstChild } from '@jamo/core';
import { writeSyntheticHwp } from '../../hwp5/test/fixtures/hwp5-writer.js';

const reopenHwpx = (f: HwpxFile): HwpxFile => HwpxFile.open(f.save());
const reopenDocx = (f: DocxFile): DocxFile => DocxFile.open(f.save());

describe('HWP 5.0 → HWPX', () => {
  it('구형 hwp 를 hwpx 로 옮긴다', () => {
    const hwp = Hwp5File.open(
      writeSyntheticHwp({
        previewText: '옛 문서',
        paragraphs: [{ text: '첫 문단' }, { text: '둘째 문단' }, { text: '셋째 문단' }],
      }),
    );
    const hwpx = reopenHwpx(HwpxFile.fromModel(hwp.toModel()));
    expect(hwpx.getText()).toBe('첫 문단\n둘째 문단\n셋째 문단');
    expect(hwpx.meta.title).toBe('옛 문서');
  });

  it('글자 서식이 charPr 표로 옮겨간다', () => {
    const hwp = Hwp5File.open(
      writeSyntheticHwp({
        fonts: ['함초롬바탕', '맑은 고딕'],
        charShapes: [
          { baseSize: 1400, property: 0b10, faceNameId: 1, color: [0, 0, 255] }, // 진하게 14pt 파랑
        ],
        paragraphs: [{ text: '굵은 제목', charShapeRuns: [[0, 0]] }],
      }),
    );
    const hwpx = reopenHwpx(HwpxFile.fromModel(hwp.toModel()));
    const style = hwpx.toModel().sections[0]!.blocks[0]!.runs[0]!.style!;
    expect(style.bold).toBe(true);
    expect(style.fontSize).toBe(14);
    expect(style.fontFamily).toBe('맑은 고딕');
    expect(style.color).toBe('#0000FF');
  });

  it('문단 정렬이 paraPr 표로 옮겨간다', () => {
    const hwp = Hwp5File.open(
      writeSyntheticHwp({
        paraShapes: [{ align: 3 }, { align: 2 }],
        paragraphs: [
          { text: '가운데', paraShapeId: 0 },
          { text: '오른쪽', paraShapeId: 1 },
        ],
      }),
    );
    const paras = reopenHwpx(HwpxFile.fromModel(hwp.toModel())).toModel().sections[0]!.blocks;
    expect(paras[0]!.style?.align).toBe('center');
    expect(paras[1]!.style?.align).toBe('right');
  });

  it('같은 서식은 charPr 을 재사용한다', () => {
    const hwp = Hwp5File.open(
      writeSyntheticHwp({
        charShapes: [{ baseSize: 1200, property: 0b10, faceNameId: 0 }],
        paragraphs: Array.from({ length: 20 }, (_unused, i) => ({
          text: `문단 ${i}`,
          charShapeRuns: [[0, 0] as [number, number]],
        })),
      }),
    );
    const hwpx = HwpxFile.fromModel(hwp.toModel());
    const refList = firstChild(hwpx.header, 'hh:refList')!;
    const charProps = firstChild(refList, 'hh:charProperties')!;
    // 기본 1개 + 서식 1개. 문단 수(20)만큼 늘어나면 안 된다.
    expect(childElements(charProps, 'hh:charPr').length).toBeLessThanOrEqual(2);
  });

  it('용지 설정이 따라간다', () => {
    const hwp = Hwp5File.open(
      writeSyntheticHwp({
        page: { width: 84188, height: 59528, landscape: true },
        paragraphs: [{ text: 'x' }],
      }),
    );
    const page = reopenHwpx(HwpxFile.fromModel(hwp.toModel())).toModel().sections[0]!.page;
    expect(page.width).toBe(84188);
    expect(page.height).toBe(59528);
    expect(page.landscape).toBe(true);
  });

  it('섹션 설정(secPr)이 살아남는다', () => {
    const hwp = Hwp5File.open(writeSyntheticHwp({ paragraphs: [{ text: 'a' }, { text: 'b' }] }));
    const hwpx = reopenHwpx(HwpxFile.fromModel(hwp.toModel()));
    const firstPara = childElements(hwpx.sectionRoot(0), 'hp:p')[0]!;
    const firstRun = childElements(firstPara, 'hp:run')[0]!;
    expect(firstChild(firstRun, 'hp:secPr')).toBeDefined();
  });
});

describe('HWP 5.0 → DOCX', () => {
  it('구형 hwp 를 Word 문서로 옮긴다', () => {
    const hwp = Hwp5File.open(
      writeSyntheticHwp({
        charShapes: [{ baseSize: 1100, property: 0b11, faceNameId: 0 }], // 진하게 + 기울임
        paragraphs: [{ text: '보고서 제목', charShapeRuns: [[0, 0]] }, { text: '본문' }],
      }),
    );
    const docx = reopenDocx(DocxFile.fromModel(hwp.toModel()));
    expect(docx.getText()).toBe('보고서 제목\n본문');
    const style = docx.toModel().sections[0]!.blocks[0]!.runs[0]!.style!;
    expect(style.bold).toBe(true);
    expect(style.italic).toBe(true);
    expect(style.fontSize).toBe(11);
  });
});

describe('DOCX → HWPX', () => {
  it('Word 문서를 한글 문서로 옮긴다', () => {
    const docx = DocxFile.blank({ text: '워드에서 쓴 제목' });
    docx.setParagraphStyle(docx.paragraphs()[0]!, 'Heading1');
    docx.appendParagraph('워드 본문 문단');
    docx.setMeta({ title: '변환', creator: '작성자' });

    const hwpx = reopenHwpx(HwpxFile.fromModel(docx.toModel()));
    expect(hwpx.getText()).toBe('워드에서 쓴 제목\n워드 본문 문단');
    expect(hwpx.meta.title).toBe('변환');
    expect(hwpx.meta.creator).toBe('작성자');
  });

  it('A4 twip 이 A4 HWPUNIT 으로 환산된다', () => {
    const docx = DocxFile.blank({ text: 'x' });
    const page = reopenHwpx(HwpxFile.fromModel(docx.toModel())).toModel().sections[0]!.page;
    // 11906 twip × 5 = 59530 — A4 59528 과 2 HWPUNIT(≈0.007mm) 차이. 반올림 오차 범위.
    expect(Math.abs(page.width - 59528)).toBeLessThanOrEqual(4);
    expect(Math.abs(page.height - 84188)).toBeLessThanOrEqual(4);
  });
});

describe('HWPX 왕복', () => {
  it('모델을 거쳐도 텍스트와 서식이 남는다', () => {
    const original = HwpxFile.blank({ text: '원본 문단' });
    original.appendParagraph(0, '둘째 문단');
    const roundTripped = reopenHwpx(HwpxFile.fromModel(original.toModel()));
    expect(roundTripped.getText()).toBe('원본 문단\n둘째 문단');
    const style = roundTripped.toModel().sections[0]!.blocks[0]!.runs[0]!.style!;
    expect(style.fontSize).toBe(10);
    expect(style.fontFamily).toBe('함초롬바탕');
  });

  it('여러 섹션을 유지한다', () => {
    const original = HwpxFile.blank({ text: '1장' });
    original.addSection({ text: '2장' });
    const model = original.toModel();
    expect(model.sections).toHaveLength(2);
    const again = reopenHwpx(HwpxFile.fromModel(model));
    expect(again.sectionCount).toBe(2);
    expect(again.getText()).toBe('1장\n2장');
  });

  it('생성한 header.xml 의 모든 참조가 실재한다', () => {
    const hwp = Hwp5File.open(
      writeSyntheticHwp({
        charShapes: [
          { baseSize: 1000, property: 0, faceNameId: 0 },
          { baseSize: 1600, property: 0b10, faceNameId: 1 },
        ],
        paraShapes: [{ align: 0 }, { align: 3 }],
        paragraphs: [
          { text: '본문', paraShapeId: 0, charShapeRuns: [[0, 0]] },
          { text: '제목', paraShapeId: 1, charShapeRuns: [[0, 1]] },
        ],
      }),
    );
    const hwpx = reopenHwpx(HwpxFile.fromModel(hwp.toModel()));
    const tables = hwpx.styles;
    for (let s = 0; s < hwpx.sectionCount; s += 1) {
      for (const p of childElements(hwpx.sectionRoot(s), 'hp:p')) {
        expect(tables.paraPr.has(attr(p, 'paraPrIDRef')!), `paraPr ${attr(p, 'paraPrIDRef')} 없음`).toBe(true);
        for (const run of childElements(p, 'hp:run')) {
          const id = attr(run, 'charPrIDRef')!;
          expect(tables.charPr.has(id), `charPr ${id} 없음`).toBe(true);
        }
      }
    }
    // 글꼴 참조도 실재해야 한다.
    const hangul = tables.fonts.get('HANGUL')!;
    for (const [, charPr] of tables.charPr) {
      const fontRef = firstChild(charPr, 'hh:fontRef')!;
      expect(hangul.has(attr(fontRef, 'hangul')!)).toBe(true);
    }
  });
});
