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

/**
 * 셀 주소(cellAddr)를 다시 매긴다.
 *
 * 병합이 있으면 **배열 순서와 격자 위치가 어긋난다.** 2×2 표에서 첫 줄 두
 * 칸을 합치면 첫 줄의 hp:tc 는 하나뿐이고, 둘째 줄은 두 개다. 순서대로
 * 0,1 을 매기면 둘째 줄 첫 칸이 1번이 돼 버린다.
 * 그래서 이미 찬 자리를 표시해 가며 빈 자리를 찾아 넣는다.
 */
function reindex(tbl: XmlElement): void {
  const occupied = new Set<string>();
  const trs = childElements(tbl, 'hp:tr');
  let columnCount = 0;

  trs.forEach((tr, r) => {
    let c = 0;
    for (const tc of childElements(tr, 'hp:tc')) {
      while (occupied.has(`${r},${c}`)) c += 1;
      const span = firstChild(tc, 'hp:cellSpan');
      const colSpan = span ? Math.max(attrInt(span, 'colSpan', 1), 1) : 1;
      const rowSpan = span ? Math.max(attrInt(span, 'rowSpan', 1), 1) : 1;

      const addr = firstChild(tc, 'hp:cellAddr');
      if (addr) {
        setAttr(addr, 'colAddr', String(c));
        setAttr(addr, 'rowAddr', String(r));
      }
      for (let dr = 0; dr < rowSpan; dr += 1) {
        for (let dc = 0; dc < colSpan; dc += 1) occupied.add(`${r + dr},${c + dc}`);
      }
      c += colSpan;
      if (c > columnCount) columnCount = c;
    }
  });

  setAttr(tbl, 'rowCnt', String(trs.length));
  setAttr(tbl, 'colCnt', String(Math.max(columnCount, 1)));
}

/** 격자 위치 → 그 자리를 차지하는 hp:tc. 병합된 자리는 주인 셀을 가리킨다. */
export function cellGrid(tbl: XmlElement): Array<Array<XmlElement | undefined>> {
  const grid: Array<Array<XmlElement | undefined>> = [];
  const trs = childElements(tbl, 'hp:tr');

  const put = (r: number, c: number, tc: XmlElement): void => {
    while (grid.length <= r) grid.push([]);
    const row = grid[r]!;
    while (row.length <= c) row.push(undefined);
    row[c] = tc;
  };
  const taken = (r: number, c: number): boolean => grid[r]?.[c] !== undefined;

  trs.forEach((tr, r) => {
    let c = 0;
    for (const tc of childElements(tr, 'hp:tc')) {
      while (taken(r, c)) c += 1;
      const span = firstChild(tc, 'hp:cellSpan');
      const colSpan = span ? Math.max(attrInt(span, 'colSpan', 1), 1) : 1;
      const rowSpan = span ? Math.max(attrInt(span, 'rowSpan', 1), 1) : 1;
      for (let dr = 0; dr < rowSpan; dr += 1) {
        for (let dc = 0; dc < colSpan; dc += 1) put(r + dr, c + dc, tc);
      }
      c += colSpan;
    }
  });
  return grid;
}

function spanOf(tc: XmlElement): { colSpan: number; rowSpan: number } {
  const span = firstChild(tc, 'hp:cellSpan');
  return {
    colSpan: span ? Math.max(attrInt(span, 'colSpan', 1), 1) : 1,
    rowSpan: span ? Math.max(attrInt(span, 'rowSpan', 1), 1) : 1,
  };
}

function setSpan(tc: XmlElement, colSpan: number, rowSpan: number): void {
  const span = firstChild(tc, 'hp:cellSpan');
  if (!span) return;
  setAttr(span, 'colSpan', String(colSpan));
  setAttr(span, 'rowSpan', String(rowSpan));
}

function cellText(tc: XmlElement): string {
  return cellParagraphs(tc)
    .map((p) =>
      childElements(p, 'hp:run')
        .flatMap((run) => childElements(run, 'hp:t').map((t) => t.children.map((c) => (c.kind === 'text' ? c.text : '')).join('')))
        .join(''),
    )
    .join('')
    .trim();
}

/**
 * 직사각형 범위의 셀을 하나로 합친다.
 *
 * 합쳐지는 셀의 글자는 버리지 않고 왼쪽 위 셀 뒤에 문단으로 붙인다.
 * 한글·워드도 그렇게 한다. 모르고 눌렀다가 내용이 사라지면 곤란하다.
 */
export function mergeCells(
  tbl: XmlElement,
  r1: number,
  c1: number,
  r2: number,
  c2: number,
): boolean {
  const top = Math.min(r1, r2);
  const left = Math.min(c1, c2);
  const bottom = Math.max(r1, r2);
  const right = Math.max(c1, c2);
  if (top === bottom && left === right) return false;

  const grid = cellGrid(tbl);
  const anchor = grid[top]?.[left];
  if (!anchor) return false;

  const absorbed = new Set<XmlElement>();
  for (let r = top; r <= bottom; r += 1) {
    for (let c = left; c <= right; c += 1) {
      const tc = grid[r]?.[c];
      if (tc && tc !== anchor) absorbed.add(tc);
    }
  }

  // 합쳐질 셀의 글자를 모아 둔다.
  const carried = [...absorbed].map(cellText).filter((t) => t !== '');
  let width = attrInt(firstChild(anchor, 'hp:cellSz') ?? anchor, 'width', 0);
  for (const tc of absorbed) {
    width += attrInt(firstChild(tc, 'hp:cellSz') ?? tc, 'width', 0);
  }

  // 세로로도 합쳐지면 폭은 한 줄치만 더해야 한다. 줄 수로 나눈다.
  const rowSpan = bottom - top + 1;
  const colSpan = right - left + 1;
  const anchorSz = firstChild(anchor, 'hp:cellSz');
  if (anchorSz) {
    setAttr(anchorSz, 'width', String(Math.round(width / rowSpan)));
    const height = attrInt(anchorSz, 'height', 0) * rowSpan;
    setAttr(anchorSz, 'height', String(height));
  }

  for (const tc of absorbed) {
    for (const tr of childElements(tbl, 'hp:tr')) {
      const i = tr.children.indexOf(tc);
      if (i >= 0) tr.children.splice(i, 1);
    }
  }

  setSpan(anchor, colSpan, rowSpan);

  if (carried.length > 0) {
    const subList = firstChild(anchor, 'hp:subList');
    const template = cellParagraphs(anchor)[0];
    if (subList && template) {
      for (const text of carried) {
        const clone = structuredClone(template);
        const t = childElements(clone, 'hp:run').flatMap((r) => childElements(r, 'hp:t'))[0];
        if (t) {
          t.children = [{ kind: 'text', text }];
          t.selfClosed = false;
        }
        subList.children.push(clone);
      }
    }
  }

  reindex(tbl);
  return true;
}

/** 합쳐진 셀을 원래대로 되돌린다. */
export function splitCell(tbl: XmlElement, row: number, col: number): boolean {
  const grid = cellGrid(tbl);
  const tc = grid[row]?.[col];
  if (!tc) return false;
  const { colSpan, rowSpan } = spanOf(tc);
  if (colSpan === 1 && rowSpan === 1) return false;

  // 주인 셀의 실제 좌상단 위치를 찾는다.
  let top = row;
  let left = col;
  for (let r = 0; r < grid.length; r += 1) {
    for (let c = 0; c < (grid[r]?.length ?? 0); c += 1) {
      if (grid[r]![c] === tc) {
        top = Math.min(top, r);
        left = Math.min(left, c);
      }
    }
  }

  const sz = firstChild(tc, 'hp:cellSz');
  const width = sz ? attrInt(sz, 'width', 0) : 0;
  const height = sz ? attrInt(sz, 'height', 0) : 0;
  const eachWidth = Math.floor(width / colSpan);
  const eachHeight = Math.floor(height / rowSpan);

  setSpan(tc, 1, 1);
  if (sz) {
    setAttr(sz, 'width', String(eachWidth));
    setAttr(sz, 'height', String(eachHeight));
  }

  const trs = childElements(tbl, 'hp:tr');
  for (let r = top; r < top + rowSpan; r += 1) {
    const tr = trs[r];
    if (!tr) continue;
    for (let c = left; c < left + colSpan; c += 1) {
      if (r === top && c === left) continue;
      const blank = structuredClone(tc);
      // 되살린 칸은 비워 둔다. 내용은 원래 셀에 남는다.
      for (const p of cellParagraphs(blank)) {
        for (const run of childElements(p, 'hp:run')) {
          for (const t of childElements(run, 'hp:t')) {
            t.children = [];
            t.selfClosed = true;
          }
        }
      }
      const extra = cellParagraphs(blank).slice(1);
      const subList = firstChild(blank, 'hp:subList');
      for (const p of extra) {
        if (subList) subList.children.splice(subList.children.indexOf(p), 1);
      }
      setSpan(blank, 1, 1);
      const blankSz = firstChild(blank, 'hp:cellSz');
      if (blankSz) {
        setAttr(blankSz, 'width', String(eachWidth));
        setAttr(blankSz, 'height', String(eachHeight));
      }
      // 격자 순서를 지키려면 같은 줄에서 자기 자리 뒤에 넣어야 한다.
      const siblings = childElements(tr, 'hp:tc');
      const after = siblings.find((s) => {
        const addr = firstChild(s, 'hp:cellAddr');
        return addr !== undefined && attrInt(addr, 'colAddr', 0) >= c;
      });
      if (after) tr.children.splice(tr.children.indexOf(after) + 1, 0, blank);
      else tr.children.push(blank);
    }
  }

  reindex(tbl);
  return true;
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
  reindex(tbl);
  return true;
}

export function removeRow(tbl: XmlElement, row: number): boolean {
  const trs = childElements(tbl, 'hp:tr');
  if (trs.length <= 1) return false; // 마지막 줄은 남긴다
  const tr = trs[row];
  if (!tr) return false;
  tbl.children.splice(tbl.children.indexOf(tr), 1);
  reindex(tbl);
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
  reindex(tbl);
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
  reindex(tbl);
  return true;
}

export { emptyCell };

/**
 * 셀 배경색을 칠할 borderFill 을 확보한다.
 *
 * HWPX 는 셀에 색을 직접 쓰지 않고 borderFill 번호를 가리킨다. 색마다 항목을
 * 하나씩 만들되, 같은 색이면 재사용한다. 표식 속성을 달아 두어 우리가 만든
 * 것인지 구분한다 — 한글은 모르는 속성을 무시하므로 파일이 깨지지 않는다.
 */
export function ensureShadedBorderFill(headerRoot: XmlElement, color: string): string {
  const refList = firstChild(headerRoot, 'hh:refList');
  if (!refList) throw new Error('header.xml 에 hh:refList 가 없습니다');
  const borderFills = firstChild(refList, 'hh:borderFills');
  if (!borderFills) throw new Error('header.xml 에 hh:borderFills 가 없습니다');

  const normalized = color.toUpperCase();
  const existing = childElements(borderFills, 'hh:borderFill').find(
    (bf) => attr(bf, 'data-jamo-shade') === normalized,
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
        'data-jamo-shade': normalized,
      },
      [
        element('hh:slash', { type: 'NONE', Crooked: 0, isCounter: 0 }),
        element('hh:backSlash', { type: 'NONE', Crooked: 0, isCounter: 0 }),
        line('hh:leftBorder'),
        line('hh:rightBorder'),
        line('hh:topBorder'),
        line('hh:bottomBorder'),
        element('hh:diagonal', { type: 'SOLID', width: '0.1 mm', color: '#000000' }),
        element('hc:fillBrush', {}, [
          element('hc:winBrush', {
            faceColor: normalized,
            hatchColor: '#FF000000',
            alpha: 0,
          }),
        ]),
      ],
    ),
  );
  borderFills.selfClosed = false;
  setAttr(borderFills, 'itemCnt', String(childElements(borderFills, 'hh:borderFill').length));
  return id;
}

/** 셀에 배경색을 입힌다. `color` 가 없으면 색을 걷어낸다. */
export function setCellShade(
  headerRoot: XmlElement,
  tc: XmlElement,
  color: string | undefined,
  plainBorderFillIDRef: string,
): void {
  const id = color ? ensureShadedBorderFill(headerRoot, color) : plainBorderFillIDRef;
  setAttr(tc, 'borderFillIDRef', id);
}

/** 격자 좌표의 셀 요소. 병합된 자리는 주인 셀을 돌려준다. */
export function cellAt(tbl: XmlElement, row: number, col: number): XmlElement | undefined {
  return cellGrid(tbl)[row]?.[col];
}
