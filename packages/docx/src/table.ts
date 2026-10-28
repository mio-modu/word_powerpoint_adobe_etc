import {
  attr,
  childElements,
  element,
  firstChild,
  hwpunit,
  setAttr,
  type JamoTable,
  type JamoTableCell,
  type JamoTableRow,
  type XmlElement,
} from '@jamo/core';
import { buildParagraph } from './wordml.js';

/**
 * DOCX 표.
 *
 * 구조는 `w:tbl > w:tr > w:tc > w:p` 로 HWPX 보다 단순하다. 다만 규칙이 둘 있다:
 *  - **셀에는 문단이 최소 하나 있어야 한다.** 빈 `w:tc` 는 Word 가 거부한다.
 *  - `w:tblGrid` 의 칸 수가 실제 칸 수와 맞아야 한다.
 */

/** A4 세로, 좌우 여백 2.5cm 일 때 본문 폭 (twip). */
export const DEFAULT_TEXT_WIDTH_TWIP = 9072;

function intAttr(el: XmlElement | undefined, name: string): number | undefined {
  if (!el) return undefined;
  const raw = attr(el, name);
  if (raw === undefined) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

export function readTable(tbl: XmlElement): JamoTable {
  const rows: JamoTableRow[] = [];
  childElements(tbl, 'w:tr').forEach((tr, rowAddr) => {
    const cells: JamoTableCell[] = [];
    let colAddr = 0;
    for (const tc of childElements(tr, 'w:tc')) {
      const tcPr = firstChild(tc, 'w:tcPr');
      const gridSpan = tcPr && firstChild(tcPr, 'w:gridSpan');
      const colSpan = gridSpan ? (intAttr(gridSpan, 'w:val') ?? 1) : 1;
      const tcW = tcPr && firstChild(tcPr, 'w:tcW');
      const widthTwip = intAttr(tcW, 'w:w');
      cells.push({
        paragraphs: [],
        colSpan,
        rowSpan: 1,
        colAddr,
        rowAddr,
        width: widthTwip !== undefined ? hwpunit.fromTwip(widthTwip) : undefined,
        source: tc,
      });
      colAddr += colSpan;
    }
    rows.push({ cells, source: tr });
  });

  const grid = firstChild(tbl, 'w:tblGrid');
  const columnWidths = grid
    ? childElements(grid, 'w:gridCol')
        .map((gc) => intAttr(gc, 'w:w') ?? 0)
        .map((twip) => hwpunit.fromTwip(twip))
    : [];

  return {
    type: 'table',
    rows,
    columnWidths,
    width: columnWidths.reduce((a, b) => a + b, 0) || undefined,
    source: tbl,
  };
}

/** 셀 안의 문단들. */
export function cellParagraphs(tc: XmlElement): XmlElement[] {
  return childElements(tc, 'w:p');
}

export interface BuildTableOptions {
  rows: number;
  cols: number;
  /** twip. 기본 본문 폭. */
  width?: number;
  /** `text[row][col]` */
  text?: string[][];
}

function border(name: string): XmlElement {
  return element(name, {
    'w:val': 'single',
    'w:sz': '4',
    'w:space': '0',
    'w:color': 'auto',
  });
}

export function buildTable(opts: BuildTableOptions): XmlElement {
  const width = opts.width ?? DEFAULT_TEXT_WIDTH_TWIP;
  const colWidth = Math.floor(width / opts.cols);
  const lastColWidth = width - colWidth * (opts.cols - 1);
  const widthOf = (c: number): number => (c === opts.cols - 1 ? lastColWidth : colWidth);

  const tblPr = element('w:tblPr', {}, [
    element('w:tblW', { 'w:w': String(width), 'w:type': 'dxa' }),
    element('w:tblBorders', {}, [
      border('w:top'),
      border('w:left'),
      border('w:bottom'),
      border('w:right'),
      border('w:insideH'),
      border('w:insideV'),
    ]),
    element('w:tblLook', {
      'w:val': '04A0',
      'w:firstRow': '1',
      'w:lastRow': '0',
      'w:firstColumn': '1',
      'w:lastColumn': '0',
      'w:noHBand': '0',
      'w:noVBand': '1',
    }),
  ]);

  const tblGrid = element(
    'w:tblGrid',
    {},
    Array.from({ length: opts.cols }, (_unused, c) =>
      element('w:gridCol', { 'w:w': String(widthOf(c)) }),
    ),
  );

  const trs = Array.from({ length: opts.rows }, (_unused, r) =>
    element(
      'w:tr',
      {},
      Array.from({ length: opts.cols }, (_unused2, c) =>
        element('w:tc', {}, [
          element('w:tcPr', {}, [
            element('w:tcW', { 'w:w': String(widthOf(c)), 'w:type': 'dxa' }),
          ]),
          // 셀에는 문단이 반드시 하나 있어야 한다.
          buildParagraph([{ text: opts.text?.[r]?.[c] ?? '' }]),
        ]),
      ),
    ),
  );

  return element('w:tbl', {}, [tblPr, tblGrid, ...trs]);
}

// ------------------------------------------------------------------ 행/열 편집

function clearCellText(tc: XmlElement): void {
  const kept = cellParagraphs(tc).slice(0, 1);
  const tcPr = firstChild(tc, 'w:tcPr');
  const blank = kept[0] ? blankCopy(kept[0]) : buildParagraph([{ text: '' }]);
  tc.children = tcPr ? [tcPr, blank] : [blank];
  tc.selfClosed = false;
}

/** 문단의 서식(w:pPr)만 남기고 글자를 비운 복사본. */
function blankCopy(p: XmlElement): XmlElement {
  const clone = structuredClone(p);
  const pPr = firstChild(clone, 'w:pPr');
  clone.children = pPr ? [pPr] : [];
  clone.selfClosed = false;
  return clone;
}

export function insertRow(tbl: XmlElement, afterRow: number): boolean {
  const trs = childElements(tbl, 'w:tr');
  const template = trs[Math.max(0, Math.min(afterRow, trs.length - 1))];
  if (!template) return false;
  const clone = structuredClone(template);
  for (const tc of childElements(clone, 'w:tc')) clearCellText(tc);
  tbl.children.splice(tbl.children.indexOf(template) + 1, 0, clone);
  return true;
}

export function removeRow(tbl: XmlElement, row: number): boolean {
  const trs = childElements(tbl, 'w:tr');
  if (trs.length <= 1) return false;
  const tr = trs[row];
  if (!tr) return false;
  tbl.children.splice(tbl.children.indexOf(tr), 1);
  return true;
}

export function insertColumn(tbl: XmlElement, afterCol: number): boolean {
  const trs = childElements(tbl, 'w:tr');
  if (trs.length === 0) return false;
  const grid = firstChild(tbl, 'w:tblGrid');
  const gridCols = grid ? childElements(grid, 'w:gridCol') : [];
  const total =
    gridCols.reduce((sum, gc) => sum + (intAttr(gc, 'w:w') ?? 0), 0) || DEFAULT_TEXT_WIDTH_TWIP;
  const colCount = Math.max(gridCols.length, childElements(trs[0]!, 'w:tc').length);

  for (const tr of trs) {
    const tcs = childElements(tr, 'w:tc');
    const template = tcs[Math.max(0, Math.min(afterCol, tcs.length - 1))];
    if (!template) continue;
    const clone = structuredClone(template);
    clearCellText(clone);
    tr.children.splice(tr.children.indexOf(template) + 1, 0, clone);
  }

  if (grid) {
    const template = gridCols[Math.max(0, Math.min(afterCol, gridCols.length - 1))];
    const clone = template
      ? structuredClone(template)
      : element('w:gridCol', { 'w:w': '0' });
    if (template) grid.children.splice(grid.children.indexOf(template) + 1, 0, clone);
    else grid.children.push(clone);
  }
  redistributeWidths(tbl, total, colCount + 1);
  return true;
}

export function removeColumn(tbl: XmlElement, col: number): boolean {
  const trs = childElements(tbl, 'w:tr');
  if (trs.length === 0) return false;
  const grid = firstChild(tbl, 'w:tblGrid');
  const gridCols = grid ? childElements(grid, 'w:gridCol') : [];
  const colCount = Math.max(gridCols.length, childElements(trs[0]!, 'w:tc').length);
  if (colCount <= 1) return false;
  const total =
    gridCols.reduce((sum, gc) => sum + (intAttr(gc, 'w:w') ?? 0), 0) || DEFAULT_TEXT_WIDTH_TWIP;

  for (const tr of trs) {
    const tc = childElements(tr, 'w:tc')[col];
    if (tc) tr.children.splice(tr.children.indexOf(tc), 1);
  }
  if (grid) {
    const gc = childElements(grid, 'w:gridCol')[col];
    if (gc) grid.children.splice(grid.children.indexOf(gc), 1);
  }
  redistributeWidths(tbl, total, colCount - 1);
  return true;
}

function redistributeWidths(tbl: XmlElement, total: number, colCount: number): void {
  if (colCount < 1) return;
  const each = Math.floor(total / colCount);
  const last = total - each * (colCount - 1);
  const widthOf = (i: number): string => String(i === colCount - 1 ? last : each);

  const grid = firstChild(tbl, 'w:tblGrid');
  if (grid) childElements(grid, 'w:gridCol').forEach((gc, i) => setAttr(gc, 'w:w', widthOf(i)));

  for (const tr of childElements(tbl, 'w:tr')) {
    childElements(tr, 'w:tc').forEach((tc, i) => {
      const tcPr = firstChild(tc, 'w:tcPr');
      const tcW = tcPr && firstChild(tcPr, 'w:tcW');
      if (tcW) setAttr(tcW, 'w:w', widthOf(i));
    });
  }
}

export function tableCells(tbl: XmlElement): XmlElement[][] {
  return childElements(tbl, 'w:tr').map((tr) =>
    childElements(tr, 'w:tc')
      .map((tc) => cellParagraphs(tc)[0])
      .filter((p): p is XmlElement => p !== undefined),
  );
}
