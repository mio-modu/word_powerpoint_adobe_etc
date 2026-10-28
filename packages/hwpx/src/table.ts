import {
  attr,
  attrInt,
  childElements,
  element,
  emptyCell,
  firstChild,
  setAttr,
  type JamoTable,
  type JamoTableCell,
  type JamoTableRow,
  type XmlElement,
} from '@jamo/core';
import { defaultLineSegArray } from './blank.js';

/**
 * HWPX 표.
 *
 * 구조는 `hp:p > hp:run > hp:tbl > hp:tr > hp:tc > hp:subList > hp:p` 이다.
 * 즉 표는 문단 안에 들어가고, 셀 안에는 다시 문단이 들어간다. 재귀 구조라
 * 평평한 문단 목록으로는 표현할 수 없고, 그래서 중립 모델에 표 블록을 따로 뒀다.
 *
 * 셀 순서는 믿을 게 못 된다. 병합이 있으면 `hp:cellAddr` 의 colAddr/rowAddr 가
 * 진짜 위치이고, 배열 순서와 어긋난다.
 */

/** 기본 본문 폭 (A4 - 좌우 여백). */
export const DEFAULT_TEXT_WIDTH = 42520;

export function readTable(tbl: XmlElement): JamoTable {
  const rows: JamoTableRow[] = [];
  for (const tr of childElements(tbl, 'hp:tr')) {
    const cells: JamoTableCell[] = [];
    for (const tc of childElements(tr, 'hp:tc')) {
      const addr = firstChild(tc, 'hp:cellAddr');
      const span = firstChild(tc, 'hp:cellSpan');
      const size = firstChild(tc, 'hp:cellSz');
      const subList = firstChild(tc, 'hp:subList');
      cells.push({
        paragraphs: [],
        colSpan: span ? attrInt(span, 'colSpan', 1) : 1,
        rowSpan: span ? attrInt(span, 'rowSpan', 1) : 1,
        colAddr: addr ? attrInt(addr, 'colAddr', 0) : 0,
        rowAddr: addr ? attrInt(addr, 'rowAddr', 0) : 0,
        width: size ? attrInt(size, 'width', 0) : undefined,
        height: size ? attrInt(size, 'height', 0) : undefined,
        source: subList ?? tc,
      });
    }
    rows.push({ cells, source: tr });
  }

  const sz = firstChild(tbl, 'hp:sz');
  return {
    type: 'table',
    rows,
    width: sz ? attrInt(sz, 'width', 0) : undefined,
    columnWidths: columnWidthsOf(rows),
    source: tbl,
  };
}

function columnWidthsOf(rows: JamoTableRow[]): number[] {
  const first = rows[0];
  if (!first) return [];
  const widths: number[] = [];
  for (const cell of first.cells) {
    // 합쳐진 칸은 폭을 균등하게 쪼개 돌려준다. 화면에 그릴 때만 쓰는 값이다.
    const each = Math.round((cell.width ?? 0) / Math.max(cell.colSpan, 1));
    for (let i = 0; i < cell.colSpan; i += 1) widths.push(each);
  }
  return widths;
}

/** 셀 안의 문단 요소들. */
export function cellParagraphs(cell: XmlElement): XmlElement[] {
  const subList = cell.name === 'hp:subList' ? cell : firstChild(cell, 'hp:subList');
  return subList ? childElements(subList, 'hp:p') : [];
}

/** 문단 안에 들어 있는 표들. */
export function tablesIn(paragraph: XmlElement): XmlElement[] {
  const out: XmlElement[] = [];
  for (const run of childElements(paragraph, 'hp:run')) {
    for (const tbl of childElements(run, 'hp:tbl')) out.push(tbl);
  }
  return out;
}

/**
 * 테두리가 보이는 borderFill 을 확보하고 그 ID 를 돌려준다.
 *
 * 빈 문서의 borderFill 1·2 는 테두리가 NONE 이라 표에 쓰면 선이 안 보인다.
 * 표용 항목을 한 번만 만들어 두고 재사용한다.
 */
export function ensureTableBorderFill(headerRoot: XmlElement): string {
  const refList = firstChild(headerRoot, 'hh:refList');
  if (!refList) throw new Error('header.xml 에 hh:refList 가 없습니다');
  const borderFills = firstChild(refList, 'hh:borderFills');
  if (!borderFills) throw new Error('header.xml 에 hh:borderFills 가 없습니다');

  const existing = childElements(borderFills, 'hh:borderFill').find(
    (bf) => attr(bf, 'data-jamo-table') === '1',
  );
  if (existing) return attr(existing, 'id') ?? '1';

  const ids = childElements(borderFills, 'hh:borderFill').map((bf) =>
    Number.parseInt(attr(bf, 'id') ?? '0', 10),
  );
  const id = String(Math.max(0, ...ids) + 1);

  const line = (name: string): XmlElement =>
    element(name, { type: 'SOLID', width: '0.12 mm', color: '#000000' });

  borderFills.children.push(
    element(
      'hh:borderFill',
      {
        id,
        threeD: 0,
        shadow: 0,
        centerLine: 'NONE',
        breakCellSeparateLine: 0,
        // 우리가 만든 항목임을 표시해 중복 생성을 막는다. 한글은 모르는
        // 속성을 무시하므로 파일이 깨지지 않는다.
        'data-jamo-table': '1',
      },
      [
        element('hh:slash', { type: 'NONE', Crooked: 0, isCounter: 0 }),
        element('hh:backSlash', { type: 'NONE', Crooked: 0, isCounter: 0 }),
        line('hh:leftBorder'),
        line('hh:rightBorder'),
        line('hh:topBorder'),
        line('hh:bottomBorder'),
        element('hh:diagonal', { type: 'SOLID', width: '0.1 mm', color: '#000000' }),
      ],
    ),
  );
  borderFills.selfClosed = false;
  setAttr(borderFills, 'itemCnt', String(childElements(borderFills, 'hh:borderFill').length));
  return id;
}

export interface BuildTableOptions {
  rows: number;
  cols: number;
  /** 표 전체 폭 (HWPUNIT). 기본 본문 폭. */
  width?: number;
  /** 한 줄 높이 (HWPUNIT). */
  rowHeight?: number;
  borderFillIDRef: string;
  paraPrIDRef?: string;
  charPrIDRef?: string;
  /** 셀에 미리 채울 글자. `text[row][col]` */
  text?: string[][];
}

function cellParagraph(
  text: string,
  paraPrIDRef: string,
  charPrIDRef: string,
  id: number,
): XmlElement {
  return element(
    'hp:p',
    {
      id: String(id),
      paraPrIDRef,
      styleIDRef: '0',
      pageBreak: 0,
      columnBreak: 0,
      merged: 0,
    },
    [
      element('hp:run', { charPrIDRef }, [
        element('hp:t', {}, text ? [{ kind: 'text', text }] : []),
      ]),
      defaultLineSegArray(),
    ],
  );
}

/** `hp:tbl` 요소를 만든다. */
export function buildTable(opts: BuildTableOptions): XmlElement {
  const width = opts.width ?? DEFAULT_TEXT_WIDTH;
  const rowHeight = opts.rowHeight ?? 2500;
  const paraPrIDRef = opts.paraPrIDRef ?? '0';
  const charPrIDRef = opts.charPrIDRef ?? '0';
  const colWidth = Math.floor(width / opts.cols);
  // 나눗셈 나머지는 마지막 칸이 흡수한다. 그래야 합이 표 폭과 정확히 맞는다.
  const lastColWidth = width - colWidth * (opts.cols - 1);

  const trs: XmlElement[] = [];
  let paraId = 0;
  for (let r = 0; r < opts.rows; r += 1) {
    const tcs: XmlElement[] = [];
    for (let c = 0; c < opts.cols; c += 1) {
      const cellWidth = c === opts.cols - 1 ? lastColWidth : colWidth;
      paraId += 1;
      tcs.push(
        element(
          'hp:tc',
          {
            name: '',
            header: 0,
            hasMargin: 0,
            protect: 0,
            editable: 0,
            dirty: 0,
            borderFillIDRef: opts.borderFillIDRef,
          },
          [
            element(
              'hp:subList',
              {
                id: '',
                textDirection: 'HORIZONTAL',
                lineWrap: 'BREAK',
                vertAlign: 'CENTER',
                linkListIDRef: '0',
                linkListNextIDRef: '0',
                textWidth: 0,
                textHeight: 0,
                hasTextRef: 0,
                hasNumRef: 0,
              },
              [
                cellParagraph(
                  opts.text?.[r]?.[c] ?? '',
                  paraPrIDRef,
                  charPrIDRef,
                  paraId,
                ),
              ],
            ),
            element('hp:cellAddr', { colAddr: c, rowAddr: r }),
            element('hp:cellSpan', { colSpan: 1, rowSpan: 1 }),
            element('hp:cellSz', { width: cellWidth, height: rowHeight }),
            element('hp:cellMargin', { left: 510, right: 510, top: 141, bottom: 141 }),
          ],
        ),
      );
    }
    trs.push(element('hp:tr', {}, tcs));
  }

  return element(
    'hp:tbl',
    {
      id: String(Math.floor(Math.random() * 2_000_000_000)),
      zOrder: 0,
      numberingType: 'TABLE',
      textWrap: 'TOP_AND_BOTTOM',
      textFlow: 'BOTH_SIDES',
      lock: 0,
      dropcapstyle: 'None',
      pageBreak: 'CELL',
      repeatHeader: 1,
      rowCnt: opts.rows,
      colCnt: opts.cols,
      cellSpacing: 0,
      borderFillIDRef: opts.borderFillIDRef,
      noAdjust: 0,
    },
    [
      // 자식 순서는 스키마가 정한다: sz, pos, outMargin, …, inMargin, tr*
      element('hp:sz', {
        width,
        widthRelTo: 'ABSOLUTE',
        height: rowHeight * opts.rows,
        heightRelTo: 'ABSOLUTE',
        protect: 0,
      }),
      element('hp:pos', {
        treatAsChar: 1,
        affectLSpacing: 0,
        flowWithText: 1,
        allowOverlap: 0,
        holdAnchorAndSO: 0,
        vertRelTo: 'PARA',
        horzRelTo: 'COLUMN',
        vertAlign: 'TOP',
        horzAlign: 'LEFT',
        vertOffset: 0,
        horzOffset: 0,
      }),
      element('hp:outMargin', { left: 0, right: 0, top: 0, bottom: 0 }),
      element('hp:inMargin', { left: 510, right: 510, top: 141, bottom: 141 }),
      ...trs,
    ],
  );
}

/** 표를 담은 문단을 만든다. 표는 반드시 문단 안의 런에 들어간다. */
export function wrapTableInParagraph(
  tbl: XmlElement,
  paraPrIDRef = '0',
  charPrIDRef = '0',
  id = 0,
): XmlElement {
  return element(
    'hp:p',
    { id: String(id), paraPrIDRef, styleIDRef: '0', pageBreak: 0, columnBreak: 0, merged: 0 },
    [
      element('hp:run', { charPrIDRef }, [tbl]),
      defaultLineSegArray(),
    ],
  );
}

// ------------------------------------------------------------------ 행/열 편집

function renumber(tbl: XmlElement): void {
  const trs = childElements(tbl, 'hp:tr');
  trs.forEach((tr, r) => {
    childElements(tr, 'hp:tc').forEach((tc, c) => {
      const addr = firstChild(tc, 'hp:cellAddr');
      if (addr) {
        setAttr(addr, 'colAddr', String(c));
        setAttr(addr, 'rowAddr', String(r));
      }
    });
  });
  setAttr(tbl, 'rowCnt', String(trs.length));
  const firstRow = trs[0];
  if (firstRow) setAttr(tbl, 'colCnt', String(childElements(firstRow, 'hp:tc').length));
}

/** `atRow` 바로 다음에 줄을 넣는다. -1 이면 맨 앞. */
export function insertRow(tbl: XmlElement, atRow: number): boolean {
  const trs = childElements(tbl, 'hp:tr');
  const template = trs[Math.max(0, Math.min(atRow, trs.length - 1))];
  if (!template) return false;

  const clone = structuredClone(template);
  // 복제한 줄의 글자는 비운다. 서식과 폭은 그대로 물려받는다.
  for (const tc of childElements(clone, 'hp:tc')) {
    for (const p of cellParagraphs(tc)) {
      for (const run of childElements(p, 'hp:run')) {
        for (const t of childElements(run, 'hp:t')) {
          t.children = [];
          t.selfClosed = true;
        }
      }
    }
  }
  const index = tbl.children.indexOf(template);
  tbl.children.splice(index + 1, 0, clone);
  renumber(tbl);
  return true;
}

export function removeRow(tbl: XmlElement, row: number): boolean {
  const trs = childElements(tbl, 'hp:tr');
  if (trs.length <= 1) return false; // 마지막 줄은 남긴다
  const tr = trs[row];
  if (!tr) return false;
  tbl.children.splice(tbl.children.indexOf(tr), 1);
  renumber(tbl);
  return true;
}

/** `atCol` 바로 다음에 칸을 넣는다. 전체 폭은 유지하고 기존 칸을 좁힌다. */
export function insertColumn(tbl: XmlElement, atCol: number): boolean {
  const trs = childElements(tbl, 'hp:tr');
  if (trs.length === 0) return false;
  const colCount = childElements(trs[0]!, 'hp:tc').length;
  const totalWidth = attrInt(firstChild(tbl, 'hp:sz') ?? tbl, 'width', DEFAULT_TEXT_WIDTH);
  const newColWidth = Math.floor(totalWidth / (colCount + 1));

  for (const tr of trs) {
    const tcs = childElements(tr, 'hp:tc');
    const template = tcs[Math.max(0, Math.min(atCol, tcs.length - 1))];
    if (!template) continue;
    const clone = structuredClone(template);
    for (const p of cellParagraphs(clone)) {
      for (const run of childElements(p, 'hp:run')) {
        for (const t of childElements(run, 'hp:t')) {
          t.children = [];
          t.selfClosed = true;
        }
      }
    }
    tr.children.splice(tr.children.indexOf(template) + 1, 0, clone);
  }

  // 폭 재분배. 마지막 칸이 나머지를 흡수한다.
  for (const tr of childElements(tbl, 'hp:tr')) {
    const tcs = childElements(tr, 'hp:tc');
    tcs.forEach((tc, i) => {
      const sz = firstChild(tc, 'hp:cellSz');
      if (!sz) return;
      const width = i === tcs.length - 1 ? totalWidth - newColWidth * (tcs.length - 1) : newColWidth;
      setAttr(sz, 'width', String(width));
    });
  }
  renumber(tbl);
  return true;
}

export function removeColumn(tbl: XmlElement, col: number): boolean {
  const trs = childElements(tbl, 'hp:tr');
  if (trs.length === 0) return false;
  const colCount = childElements(trs[0]!, 'hp:tc').length;
  if (colCount <= 1) return false;

  const totalWidth = attrInt(firstChild(tbl, 'hp:sz') ?? tbl, 'width', DEFAULT_TEXT_WIDTH);
  for (const tr of trs) {
    const tcs = childElements(tr, 'hp:tc');
    const tc = tcs[col];
    if (tc) tr.children.splice(tr.children.indexOf(tc), 1);
  }
  const newColWidth = Math.floor(totalWidth / (colCount - 1));
  for (const tr of childElements(tbl, 'hp:tr')) {
    const tcs = childElements(tr, 'hp:tc');
    tcs.forEach((tc, i) => {
      const sz = firstChild(tc, 'hp:cellSz');
      if (!sz) return;
      const width = i === tcs.length - 1 ? totalWidth - newColWidth * (tcs.length - 1) : newColWidth;
      setAttr(sz, 'width', String(width));
    });
  }
  renumber(tbl);
  return true;
}

export { emptyCell };
