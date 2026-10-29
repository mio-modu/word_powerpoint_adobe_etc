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
      const shd = tcPr && firstChild(tcPr, 'w:shd');
      const fill = shd && attr(shd, 'w:fill');
      cells.push({
        shade: fill && fill !== 'auto' ? `#${fill.replace(/^#/, '').toUpperCase()}` : undefined,
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

// -------------------------------------------------------------- 셀 병합·배경

/**
 * `w:tcPr` 자식 순서. 스키마로 정해져 있어 아무 데나 끼우면 Word 가 거부한다.
 */
const TCPR_ORDER = [
  'w:cnfStyle',
  'w:tcW',
  'w:gridSpan',
  'w:hMerge',
  'w:vMerge',
  'w:tcBorders',
  'w:shd',
  'w:noWrap',
  'w:tcMar',
  'w:textDirection',
  'w:tcFitText',
  'w:vAlign',
  'w:hideMark',
];

function tcPrOf(tc: XmlElement): XmlElement {
  const existing = firstChild(tc, 'w:tcPr');
  if (existing) return existing;
  const created = element('w:tcPr');
  tc.children.unshift(created);
  tc.selfClosed = false;
  return created;
}

function setTcPrChild(tc: XmlElement, name: string, el: XmlElement | undefined): void {
  const tcPr = tcPrOf(tc);
  const existing = firstChild(tcPr, name);
  if (existing) tcPr.children.splice(tcPr.children.indexOf(existing), 1);
  if (el) tcPr.children.push(el);
  tcPr.children.sort((a, b) => {
    if (a.kind !== 'element' || b.kind !== 'element') return 0;
    const ia = TCPR_ORDER.indexOf(a.name);
    const ib = TCPR_ORDER.indexOf(b.name);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });
  tcPr.selfClosed = tcPr.children.length === 0;
}

/**
 * 격자 위치 → 그 자리를 차지하는 `w:tc`.
 *
 * DOCX 의 세로 병합은 HWPX 와 달리 **아래 셀을 지우지 않고** `w:vMerge` 로
 * "위에 이어짐"을 표시한다. 그래서 격자를 만들 때 vMerge 이어짐 칸은 위
 * 셀을 가리키게 해야 한다.
 */
export function cellGrid(tbl: XmlElement): Array<Array<XmlElement | undefined>> {
  const grid: Array<Array<XmlElement | undefined>> = [];
  const trs = childElements(tbl, 'w:tr');

  trs.forEach((tr, r) => {
    while (grid.length <= r) grid.push([]);
    let c = 0;
    for (const tc of childElements(tr, 'w:tc')) {
      const tcPr = firstChild(tc, 'w:tcPr');
      const gridSpan = tcPr && firstChild(tcPr, 'w:gridSpan');
      const span = gridSpan ? (intAttr(gridSpan, 'w:val') ?? 1) : 1;
      const vMerge = tcPr && firstChild(tcPr, 'w:vMerge');
      const continues = vMerge !== undefined && (attr(vMerge, 'w:val') ?? 'continue') !== 'restart';

      for (let dc = 0; dc < span; dc += 1) {
        const owner = continues ? (grid[r - 1]?.[c + dc] ?? tc) : tc;
        grid[r]![c + dc] = owner;
      }
      c += span;
    }
  });
  return grid;
}

function cellText(tc: XmlElement): string {
  return cellParagraphs(tc)
    .map((p) => {
      let out = '';
      const walk = (el: XmlElement): void => {
        for (const child of el.children) {
          if (child.kind === 'text') out += child.text;
          else if (child.kind === 'element' && child.name !== 'w:pPr' && child.name !== 'w:rPr') {
            walk(child);
          }
        }
      };
      walk(p);
      return out;
    })
    .join('')
    .trim();
}

function clearCell(tc: XmlElement): void {
  const tcPr = firstChild(tc, 'w:tcPr');
  tc.children = tcPr ? [tcPr, buildParagraph([{ text: '' }])] : [buildParagraph([{ text: '' }])];
  tc.selfClosed = false;
}

/** 직사각형 범위의 셀을 하나로 합친다. */
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
  const colSpan = right - left + 1;
  const rowSpan = bottom - top + 1;
  const trs = childElements(tbl, 'w:tr');

  // 합쳐질 셀의 글자를 모은다. 한글·워드처럼 버리지 않고 이어 붙인다.
  const carried: string[] = [];
  const seen = new Set<XmlElement>([anchor]);
  for (let r = top; r <= bottom; r += 1) {
    for (let c = left; c <= right; c += 1) {
      const tc = grid[r]?.[c];
      if (!tc || seen.has(tc)) continue;
      seen.add(tc);
      const text = cellText(tc);
      if (text !== '') carried.push(text);
    }
  }

  // 폭은 합친 칸 수만큼 더한다.
  let width = 0;
  for (let c = left; c <= right; c += 1) {
    const tc = grid[top]?.[c];
    const tcW = tc && firstChild(firstChild(tc, 'w:tcPr') ?? tc, 'w:tcW');
    width += intAttr(tcW, 'w:w') ?? 0;
  }

  // 가로 병합: 같은 줄의 다른 셀을 지우고 gridSpan 을 세운다.
  for (let r = top; r <= bottom; r += 1) {
    const tr = trs[r];
    if (!tr) continue;
    const rowOwner = r === top ? anchor : grid[r]?.[left];
    const toRemove = new Set<XmlElement>();
    for (let c = left + 1; c <= right; c += 1) {
      const tc = grid[r]?.[c];
      if (tc && tc !== rowOwner) toRemove.add(tc);
    }
    for (const tc of toRemove) {
      const i = tr.children.indexOf(tc);
      if (i >= 0) tr.children.splice(i, 1);
    }
    if (!rowOwner) continue;
    if (colSpan > 1) {
      setTcPrChild(rowOwner, 'w:gridSpan', element('w:gridSpan', { 'w:val': String(colSpan) }));
    }
    if (width > 0) {
      setTcPrChild(rowOwner, 'w:tcW', element('w:tcW', { 'w:w': String(width), 'w:type': 'dxa' }));
    }
    // 세로 병합: 첫 줄은 restart, 나머지는 이어짐 표시 + 내용 비움.
    if (rowSpan > 1) {
      if (r === top) {
        setTcPrChild(rowOwner, 'w:vMerge', element('w:vMerge', { 'w:val': 'restart' }));
      } else {
        setTcPrChild(rowOwner, 'w:vMerge', element('w:vMerge'));
        clearCell(rowOwner);
      }
    }
  }

  if (carried.length > 0) {
    for (const text of carried) anchor.children.push(buildParagraph([{ text }]));
    anchor.selfClosed = false;
  }
  return true;
}

/** 합쳐진 셀을 되돌린다. */
export function splitCell(tbl: XmlElement, row: number, col: number): boolean {
  const grid = cellGrid(tbl);
  const target = grid[row]?.[col];
  if (!target) return false;

  // 이 셀이 차지하는 범위를 격자에서 되짚는다.
  let top = Number.POSITIVE_INFINITY;
  let left = Number.POSITIVE_INFINITY;
  let bottom = -1;
  let right = -1;
  grid.forEach((cells, r) => {
    cells.forEach((tc, c) => {
      if (tc !== target) return;
      top = Math.min(top, r);
      left = Math.min(left, c);
      bottom = Math.max(bottom, r);
      right = Math.max(right, c);
    });
  });
  const colSpan = right - left + 1;
  const rowSpan = bottom - top + 1;
  if (colSpan <= 1 && rowSpan <= 1) return false;

  const tcPr = firstChild(target, 'w:tcPr');
  const tcW = tcPr && firstChild(tcPr, 'w:tcW');
  const width = intAttr(tcW, 'w:w') ?? 0;
  const each = colSpan > 0 ? Math.floor(width / colSpan) : width;

  setTcPrChild(target, 'w:gridSpan', undefined);
  setTcPrChild(target, 'w:vMerge', undefined);
  if (each > 0) {
    setTcPrChild(target, 'w:tcW', element('w:tcW', { 'w:w': String(each), 'w:type': 'dxa' }));
  }

  const trs = childElements(tbl, 'w:tr');
  for (let r = top; r <= bottom; r += 1) {
    const tr = trs[r];
    if (!tr) continue;
    // 세로로 합쳐져 있던 아래 줄들은 자기 셀을 되살린다.
    const owner: XmlElement | undefined = r === top ? target : grid[r]?.[left];
    if (owner && owner !== target) {
      setTcPrChild(owner, 'w:gridSpan', undefined);
      setTcPrChild(owner, 'w:vMerge', undefined);
      if (each > 0) {
        setTcPrChild(owner, 'w:tcW', element('w:tcW', { 'w:w': String(each), 'w:type': 'dxa' }));
      }
    }
    const anchorCell = owner ?? target;
    for (let c = left + 1; c <= right; c += 1) {
      const blank = structuredClone(anchorCell);
      clearCell(blank);
      setTcPrChild(blank, 'w:gridSpan', undefined);
      setTcPrChild(blank, 'w:vMerge', undefined);
      if (each > 0) {
        setTcPrChild(blank, 'w:tcW', element('w:tcW', { 'w:w': String(each), 'w:type': 'dxa' }));
      }
      const at = tr.children.indexOf(anchorCell);
      tr.children.splice(at < 0 ? tr.children.length : at + 1, 0, blank);
    }
  }
  return true;
}

/** 셀 배경색. `color` 를 비우면 색을 걷어낸다. */
export function setCellShade(tc: XmlElement, color: string | undefined): void {
  setTcPrChild(
    tc,
    'w:shd',
    color
      ? element('w:shd', {
          'w:val': 'clear',
          'w:color': 'auto',
          'w:fill': color.replace(/^#/, '').toUpperCase(),
        })
      : undefined,
  );
}

export function cellAt(tbl: XmlElement, row: number, col: number): XmlElement | undefined {
  return cellGrid(tbl)[row]?.[col];
}
