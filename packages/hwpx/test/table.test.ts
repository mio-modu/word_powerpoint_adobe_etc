import { describe, expect, it } from 'vitest';
import { HwpxFile, readTable } from '@jamo/hwpx';
import { DocxFile } from '@jamo/docx';
import { attr, childElements, firstChild, isTable, type JamoTable } from '@jamo/core';

const reopen = (f: HwpxFile): HwpxFile => HwpxFile.open(f.save());
const firstTable = (model: ReturnType<HwpxFile['toModel']>): JamoTable => {
  const found = model.sections[0]!.blocks.find(isTable);
  if (!found) throw new Error('표가 없습니다');
  return found;
};

describe('HWPX 표 만들기', () => {
  it('표를 넣고 다시 읽는다', () => {
    const file = HwpxFile.blank({ text: '아래는 표입니다' });
    file.insertTable(0, 2, 3, {
      text: [
        ['이름', '점수', '등급'],
        ['홍길동', '95', 'A'],
      ],
    });
    const again = reopen(file);
    const table = firstTable(again.toModel());
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]!.cells).toHaveLength(3);
    expect(table.rows[0]!.cells.map((c) => c.paragraphs[0]!.runs[0]!.text)).toEqual([
      '이름',
      '점수',
      '등급',
    ]);
    expect(table.rows[1]!.cells[0]!.paragraphs[0]!.runs[0]!.text).toBe('홍길동');
  });

  it('평문에 표 내용이 탭으로 들어간다', () => {
    const file = HwpxFile.blank({ text: '제목' });
    file.insertTable(0, 2, 2, { text: [['A', 'B'], ['C', 'D']] });
    expect(reopen(file).getText()).toBe('제목\nA\tB\nC\tD');
  });

  it('표는 문단 안의 런에 들어간다 (스키마 요구사항)', () => {
    const file = HwpxFile.blank();
    file.insertTable(0, 1, 2);
    const paras = childElements(file.sectionRoot(0), 'hp:p');
    const holder = paras.find((p) =>
      childElements(p, 'hp:run').some((r) => firstChild(r, 'hp:tbl')),
    );
    expect(holder).toBeDefined();
  });

  it('칸 너비의 합이 표 폭과 정확히 맞는다', () => {
    const file = HwpxFile.blank();
    const tbl = file.insertTable(0, 1, 3, { width: 42520 });
    const sz = firstChild(tbl, 'hp:sz')!;
    const widths = childElements(childElements(tbl, 'hp:tr')[0]!, 'hp:tc').map((tc) =>
      Number.parseInt(attr(firstChild(tc, 'hp:cellSz')!, 'width')!, 10),
    );
    expect(widths.reduce((a, b) => a + b, 0)).toBe(Number.parseInt(attr(sz, 'width')!, 10));
  });

  it('cellAddr 이 줄·칸 위치와 맞는다', () => {
    const file = HwpxFile.blank();
    const tbl = file.insertTable(0, 2, 2);
    const addrs = childElements(tbl, 'hp:tr').flatMap((tr) =>
      childElements(tr, 'hp:tc').map((tc) => {
        const a = firstChild(tc, 'hp:cellAddr')!;
        return `${attr(a, 'rowAddr')},${attr(a, 'colAddr')}`;
      }),
    );
    expect(addrs).toEqual(['0,0', '0,1', '1,0', '1,1']);
  });

  it('표 테두리용 borderFill 이 만들어지고 재사용된다', () => {
    const file = HwpxFile.blank();
    file.insertTable(0, 1, 1);
    const before = childElements(
      firstChild(firstChild(file.header, 'hh:refList')!, 'hh:borderFills')!,
      'hh:borderFill',
    ).length;
    file.insertTable(0, 1, 1);
    const after = childElements(
      firstChild(firstChild(file.header, 'hh:refList')!, 'hh:borderFills')!,
      'hh:borderFill',
    ).length;
    expect(after).toBe(before);
  });
});

describe('HWPX 표 편집', () => {
  it('셀 글자를 바꾼다', () => {
    const file = HwpxFile.blank();
    const tbl = file.insertTable(0, 2, 2, { text: [['A', 'B'], ['C', 'D']] });
    const cells = HwpxFile.cells(tbl);
    file.setParagraphText(cells[1]![1]!, '바뀜');
    expect(reopen(file).getText()).toContain('C\t바뀜');
  });

  it('줄을 넣고 뺀다', () => {
    const file = HwpxFile.blank();
    const tbl = file.insertTable(0, 2, 2, { text: [['A', 'B'], ['C', 'D']] });
    HwpxFile.insertRow(tbl, 0);
    expect(attr(tbl, 'rowCnt')).toBe('3');
    expect(childElements(tbl, 'hp:tr')).toHaveLength(3);
    // 새 줄은 비어 있어야 한다.
    const model = firstTable(file.toModel());
    expect(model.rows[1]!.cells[0]!.paragraphs[0]!.runs[0]!.text).toBe('');

    HwpxFile.removeRow(tbl, 1);
    expect(attr(tbl, 'rowCnt')).toBe('2');
    expect(reopen(file).getText()).toContain('A\tB\nC\tD');
  });

  it('마지막 줄은 지워지지 않는다', () => {
    const file = HwpxFile.blank();
    const tbl = file.insertTable(0, 1, 2);
    expect(HwpxFile.removeRow(tbl, 0)).toBe(false);
  });

  it('칸을 넣으면 폭을 다시 나눈다', () => {
    const file = HwpxFile.blank();
    const tbl = file.insertTable(0, 2, 2, { width: 40000 });
    HwpxFile.insertColumn(tbl, 0);
    expect(attr(tbl, 'colCnt')).toBe('3');
    const widths = childElements(childElements(tbl, 'hp:tr')[0]!, 'hp:tc').map((tc) =>
      Number.parseInt(attr(firstChild(tc, 'hp:cellSz')!, 'width')!, 10),
    );
    expect(widths).toHaveLength(3);
    expect(widths.reduce((a, b) => a + b, 0)).toBe(40000);
  });

  it('칸을 빼면 폭을 다시 나눈다', () => {
    const file = HwpxFile.blank();
    const tbl = file.insertTable(0, 1, 3, { width: 30000 });
    HwpxFile.removeColumn(tbl, 1);
    const widths = childElements(childElements(tbl, 'hp:tr')[0]!, 'hp:tc').map((tc) =>
      Number.parseInt(attr(firstChild(tc, 'hp:cellSz')!, 'width')!, 10),
    );
    expect(widths).toHaveLength(2);
    expect(widths.reduce((a, b) => a + b, 0)).toBe(30000);
  });

  it('표를 지운다', () => {
    const file = HwpxFile.blank({ text: '본문' });
    const tbl = file.insertTable(0, 2, 2, { text: [['A', 'B'], ['C', 'D']] });
    expect(file.removeTable(0, tbl)).toBe(true);
    expect(reopen(file).getText()).toBe('본문');
  });

  it('표만 있는 문단은 빈 줄로 나오지 않는다', () => {
    const file = HwpxFile.blank({ text: '제목' });
    file.insertTable(0, 1, 1, { text: [['셀']] });
    const blocks = file.toModel().sections[0]!.blocks;
    expect(blocks.filter(isTable)).toHaveLength(1);
    // 제목 문단 1개 + 표 1개. 표를 감싼 빈 문단이 더 나오면 안 된다.
    expect(blocks).toHaveLength(2);
  });
});

describe('표가 있는 문서의 변환', () => {
  it('HWPX 표가 DOCX 표로 넘어간다', () => {
    const hwpx = HwpxFile.blank({ text: '보고서' });
    hwpx.insertTable(0, 2, 2, { text: [['항목', '값'], ['매출', '30억']] });

    const docx = DocxFile.open(DocxFile.fromModel(hwpx.toModel()).save());
    const tables = docx.tables();
    expect(tables).toHaveLength(1);
    const model = docx.blocks().find(isTable)!;
    expect(model.rows).toHaveLength(2);
    expect(model.rows[0]!.cells.map((c) => c.paragraphs[0]!.runs[0]!.text)).toEqual([
      '항목',
      '값',
    ]);
    expect(docx.getText()).toContain('매출');
  });

  it('DOCX 표가 HWPX 표로 넘어간다', () => {
    const docx = DocxFile.blank({ text: '제목' });
    docx.insertTable(2, 3, { text: [['A', 'B', 'C'], ['1', '2', '3']] });

    const hwpx = reopen(HwpxFile.fromModel(docx.toModel()));
    const table = firstTable(hwpx.toModel());
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]!.cells).toHaveLength(3);
    expect(hwpx.getText()).toContain('A\tB\tC');
  });

  it('왕복해도 표가 남는다', () => {
    const original = HwpxFile.blank({ text: '시작' });
    original.insertTable(0, 2, 2, { text: [['가', '나'], ['다', '라']] });
    const roundTripped = reopen(HwpxFile.fromModel(original.toModel()));
    expect(roundTripped.getText()).toContain('가\t나');
    expect(roundTripped.getText()).toContain('다\t라');
  });
});
