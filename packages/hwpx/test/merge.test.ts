import { describe, expect, it } from 'vitest';
import { HwpxFile, cellGrid } from '@jamo/hwpx';
import { DocxFile } from '@jamo/docx';
import { attr, childElements, firstChild, isTable } from '@jamo/core';

const reopenH = (f: HwpxFile): HwpxFile => HwpxFile.open(f.save());
const reopenD = (f: DocxFile): DocxFile => DocxFile.open(f.save());

/** 격자를 "주인 셀" 식별자로 찍어 본다. 같은 글자면 같은 셀. */
const shape = (grid: Array<Array<unknown>>): string[] => {
  const ids = new Map<unknown, string>();
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return grid.map((row) =>
    row
      .map((cell) => {
        if (cell === undefined) return '.';
        if (!ids.has(cell)) ids.set(cell, letters[ids.size] ?? '?');
        return ids.get(cell)!;
      })
      .join(''),
  );
};

describe('HWPX 셀 병합', () => {
  it('가로로 합친다', () => {
    const file = HwpxFile.blank();
    const tbl = file.insertTable(0, 2, 3, { text: [['A', 'B', 'C'], ['D', 'E', 'F']] });
    expect(HwpxFile.mergeCells(tbl, 0, 0, 0, 1)).toBe(true);
    expect(shape(HwpxFile.grid(tbl))).toEqual(['AAB', 'CDE']);
    // 합쳐진 셀의 글자는 버리지 않는다.
    expect(reopenH(file).getText()).toContain('B');
  });

  it('세로로 합친다', () => {
    const file = HwpxFile.blank();
    const tbl = file.insertTable(0, 3, 2, { text: [['A', 'B'], ['C', 'D'], ['E', 'F']] });
    expect(HwpxFile.mergeCells(tbl, 0, 0, 1, 0)).toBe(true);
    expect(shape(HwpxFile.grid(tbl))).toEqual(['AB', 'AC', 'DE']);
  });

  it('직사각형으로 합친다', () => {
    const file = HwpxFile.blank();
    const tbl = file.insertTable(0, 3, 3);
    expect(HwpxFile.mergeCells(tbl, 0, 0, 1, 1)).toBe(true);
    expect(shape(HwpxFile.grid(tbl))).toEqual(['AAB', 'AAC', 'DEF']);
  });

  it('병합 후 cellAddr 이 격자와 맞는다', () => {
    const file = HwpxFile.blank();
    const tbl = file.insertTable(0, 2, 3);
    HwpxFile.mergeCells(tbl, 0, 0, 0, 1);
    // 둘째 줄 첫 칸은 colAddr 0 이어야 한다. 순서대로 매기면 1이 되어 버린다.
    const secondRow = childElements(tbl, 'hp:tr')[1]!;
    const firstCell = childElements(secondRow, 'hp:tc')[0]!;
    expect(attr(firstChild(firstCell, 'hp:cellAddr')!, 'colAddr')).toBe('0');
    expect(attr(tbl, 'colCnt')).toBe('3');
  });

  it('합친 셀을 되돌린다', () => {
    const file = HwpxFile.blank();
    const tbl = file.insertTable(0, 2, 3);
    HwpxFile.mergeCells(tbl, 0, 0, 0, 1);
    expect(HwpxFile.splitCell(tbl, 0, 0)).toBe(true);
    expect(shape(HwpxFile.grid(tbl))).toEqual(['ABC', 'DEF']);
  });

  it('합치지 않은 셀은 되돌릴 게 없다', () => {
    const file = HwpxFile.blank();
    const tbl = file.insertTable(0, 2, 2);
    expect(HwpxFile.splitCell(tbl, 0, 0)).toBe(false);
  });

  it('저장했다 열어도 병합이 유지된다', () => {
    const file = HwpxFile.blank();
    const tbl = file.insertTable(0, 2, 3, { text: [['머리', '', ''], ['a', 'b', 'c']] });
    HwpxFile.mergeCells(tbl, 0, 0, 0, 2);
    const again = reopenH(file);
    const model = again.toModel().sections[0]!.blocks.find(isTable)!;
    expect(model.rows[0]!.cells[0]!.colSpan).toBe(3);
    expect(model.rows[1]!.cells).toHaveLength(3);
  });
});

describe('HWPX 셀 배경색', () => {
  it('색을 칠하고 지운다', () => {
    const file = HwpxFile.blank();
    const tbl = file.insertTable(0, 2, 2);
    expect(file.setCellShade(tbl, 0, 0, '#FFF2CC')).toBe(true);
    const plain = attr(HwpxFile.cellAt(tbl, 0, 1)!, 'borderFillIDRef');
    const shaded = attr(HwpxFile.cellAt(tbl, 0, 0)!, 'borderFillIDRef');
    expect(shaded).not.toBe(plain);

    const again = reopenH(file);
    const borderFills = firstChild(firstChild(again.header, 'hh:refList')!, 'hh:borderFills')!;
    const used = childElements(borderFills, 'hh:borderFill').find((bf) => attr(bf, 'id') === shaded)!;
    const brush = firstChild(firstChild(used, 'hc:fillBrush')!, 'hc:winBrush')!;
    expect(attr(brush, 'faceColor')).toBe('#FFF2CC');

    file.setCellShade(tbl, 0, 0, undefined);
    expect(attr(HwpxFile.cellAt(tbl, 0, 0)!, 'borderFillIDRef')).toBe(plain);
  });

  it('같은 색을 여러 셀에 써도 borderFill 이 하나만 는다', () => {
    const file = HwpxFile.blank();
    const tbl = file.insertTable(0, 2, 2);
    const count = () =>
      childElements(
        firstChild(firstChild(file.header, 'hh:refList')!, 'hh:borderFills')!,
        'hh:borderFill',
      ).length;
    file.setCellShade(tbl, 0, 0, '#FFFF00');
    const after = count();
    file.setCellShade(tbl, 0, 1, '#FFFF00');
    file.setCellShade(tbl, 1, 0, '#FFFF00');
    expect(count()).toBe(after);
  });
});

describe('DOCX 셀 병합', () => {
  it('가로로 합친다 (gridSpan)', () => {
    const file = DocxFile.blank();
    const tbl = file.insertTable(2, 3, { text: [['A', 'B', 'C'], ['D', 'E', 'F']] });
    expect(DocxFile.mergeCells(tbl, 0, 0, 0, 1)).toBe(true);
    expect(shape(DocxFile.grid(tbl))).toEqual(['AAB', 'CDE']);
    const firstCell = childElements(childElements(tbl, 'w:tr')[0]!, 'w:tc')[0]!;
    const gridSpan = firstChild(firstChild(firstCell, 'w:tcPr')!, 'w:gridSpan')!;
    expect(attr(gridSpan, 'w:val')).toBe('2');
  });

  it('세로로 합친다 (vMerge)', () => {
    const file = DocxFile.blank();
    const tbl = file.insertTable(3, 2);
    expect(DocxFile.mergeCells(tbl, 0, 0, 1, 0)).toBe(true);
    expect(shape(DocxFile.grid(tbl))).toEqual(['AB', 'AC', 'DE']);
    const top = childElements(childElements(tbl, 'w:tr')[0]!, 'w:tc')[0]!;
    expect(attr(firstChild(firstChild(top, 'w:tcPr')!, 'w:vMerge')!, 'w:val')).toBe('restart');
    const below = childElements(childElements(tbl, 'w:tr')[1]!, 'w:tc')[0]!;
    expect(firstChild(firstChild(below, 'w:tcPr')!, 'w:vMerge')).toBeDefined();
  });

  it('w:tcPr 자식 순서를 지킨다', () => {
    const file = DocxFile.blank();
    const tbl = file.insertTable(2, 3);
    DocxFile.mergeCells(tbl, 0, 0, 0, 1);
    file.setCellShade(tbl, 0, 0, '#FFFF00');
    const tcPr = firstChild(childElements(childElements(tbl, 'w:tr')[0]!, 'w:tc')[0]!, 'w:tcPr')!;
    const names = childElements(tcPr).map((e) => e.name);
    expect(names.indexOf('w:tcW')).toBeLessThan(names.indexOf('w:gridSpan'));
    expect(names.indexOf('w:gridSpan')).toBeLessThan(names.indexOf('w:shd'));
  });

  it('되돌린다', () => {
    const file = DocxFile.blank();
    const tbl = file.insertTable(2, 3);
    DocxFile.mergeCells(tbl, 0, 0, 0, 1);
    expect(DocxFile.splitCell(tbl, 0, 0)).toBe(true);
    expect(shape(DocxFile.grid(tbl))).toEqual(['ABC', 'DEF']);
    expect(reopenD(file)).toBeDefined();
  });

  it('저장했다 열어도 병합이 유지된다', () => {
    const file = DocxFile.blank();
    const tbl = file.insertTable(2, 3, { text: [['머리', '', ''], ['a', 'b', 'c']] });
    DocxFile.mergeCells(tbl, 0, 0, 0, 2);
    const again = reopenD(file);
    const model = again.blocks().find(isTable)!;
    expect(model.rows[0]!.cells[0]!.colSpan).toBe(3);
  });
});

describe('빈 함수 보호', () => {
  it('같은 셀 하나만 고르면 병합하지 않는다', () => {
    const file = HwpxFile.blank();
    const tbl = file.insertTable(0, 2, 2);
    expect(HwpxFile.mergeCells(tbl, 1, 1, 1, 1)).toBe(false);
  });

  it('cellGrid 는 범위를 벗어난 좌표에 undefined', () => {
    const file = HwpxFile.blank();
    const tbl = file.insertTable(0, 2, 2);
    expect(cellGrid(tbl)[9]?.[9]).toBeUndefined();
  });
});

describe('셀 배경색이 모델에 나온다', () => {
  it('HWPX 에서 칠한 색을 다시 읽는다', () => {
    const file = HwpxFile.blank();
    const tbl = file.insertTable(0, 2, 2);
    file.setCellShade(tbl, 0, 0, '#FFF2CC');
    const model = reopenH(file).toModel().sections[0]!.blocks.find(isTable)!;
    expect(model.rows[0]!.cells[0]!.shade).toBe('#FFF2CC');
    expect(model.rows[0]!.cells[1]!.shade).toBeUndefined();
  });

  it('DOCX 에서 칠한 색을 다시 읽는다', () => {
    const file = DocxFile.blank();
    const tbl = file.insertTable(2, 2);
    file.setCellShade(tbl, 0, 0, '#DDEBF7');
    const model = reopenD(file).blocks().find(isTable)!;
    expect(model.rows[0]!.cells[0]!.shade).toBe('#DDEBF7');
    expect(model.rows[0]!.cells[1]!.shade).toBeUndefined();
  });

  it('색이 HWPX → DOCX 변환을 넘어간다', () => {
    const hwpx = HwpxFile.blank();
    const tbl = hwpx.insertTable(0, 2, 2);
    hwpx.setCellShade(tbl, 0, 0, '#E2EFDA');
    const docx = reopenD(DocxFile.fromModel(hwpx.toModel()));
    const model = docx.blocks().find(isTable)!;
    expect(model.rows[0]!.cells[0]!.shade).toBe('#E2EFDA');
    expect(model.rows[0]!.cells[1]!.shade).toBeUndefined();
  });

  it('색이 DOCX → HWPX 변환을 넘어간다', () => {
    const docx = DocxFile.blank();
    const tbl = docx.insertTable(2, 2);
    docx.setCellShade(tbl, 1, 1, '#FCE4D6');
    const hwpx = reopenH(HwpxFile.fromModel(docx.toModel()));
    const model = hwpx.toModel().sections[0]!.blocks.find(isTable)!;
    expect(model.rows[1]!.cells[1]!.shade).toBe('#FCE4D6');
    expect(model.rows[0]!.cells[0]!.shade).toBeUndefined();
  });
});
