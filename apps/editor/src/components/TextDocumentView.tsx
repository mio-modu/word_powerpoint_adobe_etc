import {
  hwpunit,
  isTable,
  type CharStyle,
  type JamoBlock,
  type JamoParagraph,
  type JamoTable,
  type JamoTextDocument,
  type ParagraphStyle,
  type XmlElement,
} from '@jamo/core';
import { useEffect, useRef, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react';
import { Editable } from './Editable.js';
import { selectionRect, type Focus } from '../session.js';

/**
 * 워드프로세서 문서 화면.
 *
 * 쪽 나눔은 하지 않는다. 실제 페이지 분할은 글꼴 메트릭과 줄바꿈 규칙까지
 * 계산해야 해서, 어설프게 하면 오히려 실제 출력과 달라져 혼란만 준다.
 * 대신 용지 폭과 여백은 문서 설정 그대로 맞춰 "어디서 줄이 바뀌는지"는
 * 실제와 가깝게 보이도록 했다.
 */

export interface TextDocumentViewProps {
  document: JamoTextDocument;
  readOnly: boolean;
  zoom: number;
  focus: Focus;
  onFocus: (focus: Focus) => void;
  onParagraphChange: (source: unknown, text: string) => void;
  onParagraphSplit: (source: unknown) => void;
  onParagraphRemove: (source: unknown) => void;
  onTableAppendRow: (table: unknown) => void;
}

const FALLBACK_FONTS = `'Noto Sans KR', 'Malgun Gothic', '맑은 고딕', 'Apple SD Gothic Neo', sans-serif`;

export function charCss(style: CharStyle | undefined): CSSProperties {
  if (!style) return {};
  const css: CSSProperties = {};
  if (style.fontFamily) css.fontFamily = `'${style.fontFamily}', ${FALLBACK_FONTS}`;
  if (style.fontSize !== undefined) css.fontSize = `${style.fontSize}pt`;
  css.fontWeight = style.bold ? 700 : 400;
  css.fontStyle = style.italic ? 'italic' : 'normal';
  const decorations: string[] = [];
  if (style.underline) decorations.push('underline');
  if (style.strikeout) decorations.push('line-through');
  if (decorations.length > 0) css.textDecoration = decorations.join(' ');
  if (style.color && !style.color.startsWith('theme:')) css.color = style.color;
  if (style.highlight && !style.highlight.startsWith('theme:')) {
    css.backgroundColor = style.highlight;
  }
  if (style.superscript || style.subscript) {
    css.verticalAlign = style.superscript ? 'super' : 'sub';
    css.fontSize = `${(style.fontSize ?? 10) * 0.7}pt`;
  }
  return css;
}

function paraCss(style: ParagraphStyle | undefined): CSSProperties {
  if (!style) return {};
  const css: CSSProperties = {};
  if (style.align) {
    css.textAlign = style.align === 'distribute' ? 'justify' : style.align;
  }
  if (style.indentLeft) css.marginLeft = `${hwpunit.toPx(style.indentLeft)}px`;
  if (style.indentRight) css.marginRight = `${hwpunit.toPx(style.indentRight)}px`;
  if (style.indentFirstLine) css.textIndent = `${hwpunit.toPx(style.indentFirstLine)}px`;
  if (style.spaceBefore) css.marginTop = `${hwpunit.toPx(style.spaceBefore)}px`;
  if (style.spaceAfter) css.marginBottom = `${hwpunit.toPx(style.spaceAfter)}px`;
  if (style.lineHeight) {
    css.lineHeight =
      style.lineHeight.type === 'percent'
        ? style.lineHeight.value / 100
        : `${hwpunit.toPx(style.lineHeight.value)}px`;
  }
  return css;
}

interface ParagraphProps {
  para: JamoParagraph;
  readOnly: boolean;
  focused: boolean;
  placeholder?: string;
  canRemove: boolean;
  onFocus: (event?: MouseEvent) => void;
  onChange: (text: string) => void;
  onSplit: () => void;
  onRemove: () => void;
  /** 표 셀 안에서 Tab 으로 칸을 옮길 때. */
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  cellAddress?: string;
}

function Paragraph({
  para,
  readOnly,
  focused,
  placeholder,
  canRemove,
  onFocus,
  onChange,
  onSplit,
  onRemove,
  onKeyDown,
  cellAddress,
}: ParagraphProps): JSX.Element {
  const first = para.runs[0];
  const text = para.runs.map((r) => r.text).join('');
  const style = { ...paraCss(para.style), ...charCss(first?.style) };
  const level = para.style?.outlineLevel;

  return (
    <p
      className={`para${level ? ` outline-${Math.min(level, 3)}` : ''}${focused ? ' para-focused' : ''}`}
      style={style}
      title={para.style?.styleName}
    >
      {readOnly ? (
        // 여러 런의 서식을 그대로 보여 준다. 읽기 모드에서만.
        para.runs.map((run, i) => (
          <span key={i} style={charCss(run.style)}>
            {run.text}
          </span>
        ))
      ) : (
        <Editable
          value={text}
          placeholder={placeholder}
          onFocus={() => onFocus()}
          onMouseDown={onFocus}
          onCommit={onChange}
          onSplit={onSplit}
          onRemoveEmpty={canRemove ? onRemove : undefined}
          onKeyDownCapture={onKeyDown}
          data-cell={cellAddress}
        />
      )}
    </p>
  );
}

interface TableProps {
  table: JamoTable;
  readOnly: boolean;
  focus: Focus;
  onFocus: (focus: Focus) => void;
  onChange: (source: unknown, text: string) => void;
  /** 마지막 칸에서 Tab 을 누르면 줄을 하나 늘린다. 워드·한글과 같은 동작. */
  onAppendRow: () => void;
}

function TableBlock({
  table,
  readOnly,
  focus,
  onFocus,
  onChange,
  onAppendRow,
}: TableProps): JSX.Element {
  const ref = useRef<HTMLTableElement>(null);
  const pendingFocus = useRef<number | undefined>(undefined);
  const isActive = focus.table !== undefined && focus.table === table.source;
  const rect = isActive ? selectionRect(focus) : undefined;

  // 줄을 늘린 직후에는 새로 생긴 칸으로 커서를 옮긴다. 다시 그려진 뒤라야
  // 그 칸이 DOM 에 있으므로 effect 에서 처리한다.
  useEffect(() => {
    const index = pendingFocus.current;
    if (index === undefined) return;
    pendingFocus.current = undefined;
    const cells = ref.current?.querySelectorAll<HTMLElement>('[contenteditable]');
    cells?.[Math.min(index, cells.length - 1)]?.focus();
  });

  const moveTo = (from: HTMLElement, delta: number): boolean => {
    const cells = [...(ref.current?.querySelectorAll<HTMLElement>('[contenteditable]') ?? [])];
    const at = cells.indexOf(from);
    if (at < 0) return false;
    const next = cells[at + delta];
    if (next) {
      next.focus();
      return true;
    }
    if (delta > 0) {
      // 마지막 칸에서 Tab → 줄 추가 후 첫 칸으로.
      pendingFocus.current = cells.length;
      onAppendRow();
      return true;
    }
    return false;
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    event.stopPropagation();
    moveTo(event.currentTarget, event.shiftKey ? -1 : 1);
  };

  const selected = (r: number, c: number): boolean =>
    rect !== undefined && r >= rect.top && r <= rect.bottom && c >= rect.left && c <= rect.right;

  return (
    <table
      ref={ref}
      className={`doc-table${isActive ? ' doc-table-active' : ''}`}
      style={table.width ? { width: `${hwpunit.toPx(table.width)}px` } : undefined}
    >
      <tbody>
        {table.rows.map((row, r) => (
          <tr key={r}>
            {row.cells.map((cell, cellIndex) => {
              // 화면 좌표는 배열 순서가 아니라 셀 주소를 따른다.
              // 병합이 있으면 둘이 어긋난다.
              const c = cell.colAddr;
              return (
                <td
                  key={cellIndex}
                  className={selected(r, c) ? 'cell-selected' : undefined}
                  colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
                  rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
                  style={{
                    ...(cell.width ? { width: `${hwpunit.toPx(cell.width)}px` } : {}),
                    ...(cell.shade ? { backgroundColor: cell.shade } : {}),
                  }}
                >
                  {cell.paragraphs.map((para, i) => (
                    <Paragraph
                      key={i}
                      para={para}
                      readOnly={readOnly}
                      focused={false}
                      canRemove={false}
                      cellAddress={`${r},${c}`}
                      onKeyDown={handleKeyDown}
                      onFocus={(event) => {
                        // 클릭하면 mousedown 이 먼저, focus 가 나중에 온다.
                        // mousedown 이 이미 이 칸을 잡아 뒀으면 focus 는 넘긴다.
                        // 그러지 않으면 Shift+클릭으로 잡은 범위가 바로 지워진다.
                        if (!event && isActive && focus.row === r && focus.column === c) return;
                        onFocus({
                          paragraph: para.source as XmlElement,
                          table: table.source as XmlElement,
                          row: r,
                          column: c,
                          // Shift+클릭이면 시작점을 남겨 범위를 늘린다.
                          anchor:
                            event?.shiftKey && isActive && focus.row !== undefined
                              ? (focus.anchor ?? { row: focus.row, column: focus.column ?? 0 })
                              : undefined,
                        });
                      }}
                      onChange={(text) => onChange(para.source, text)}
                      onSplit={() => undefined}
                      onRemove={() => undefined}
                    />
                  ))}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function TextDocumentView({
  document: model,
  readOnly,
  zoom,
  focus,
  onFocus,
  onParagraphChange,
  onParagraphSplit,
  onParagraphRemove,
  onTableAppendRow,
}: TextDocumentViewProps): JSX.Element {
  return (
    <div className="pages" style={{ ['--zoom' as string]: zoom }}>
      {model.sections.map((section, sectionIndex) => {
        const page = section.page;
        return (
          <article
            key={sectionIndex}
            className="page"
            style={{
              width: `${hwpunit.toPx(page.width)}px`,
              paddingLeft: `${hwpunit.toPx(page.margin.left)}px`,
              paddingRight: `${hwpunit.toPx(page.margin.right)}px`,
              paddingTop: `${hwpunit.toPx(page.margin.top)}px`,
              paddingBottom: `${hwpunit.toPx(page.margin.bottom)}px`,
              minHeight: `${hwpunit.toPx(page.height)}px`,
            }}
          >
            {model.sections.length > 1 && (
              <div className="section-badge">{sectionIndex + 1}번째 구역</div>
            )}
            {section.blocks.map((block: JamoBlock, index) =>
              isTable(block) ? (
                <TableBlock
                  key={index}
                  table={block}
                  readOnly={readOnly}
                  focus={focus}
                  onFocus={onFocus}
                  onChange={onParagraphChange}
                  onAppendRow={() => onTableAppendRow(block.source)}
                />
              ) : (
                <Paragraph
                  key={index}
                  para={block}
                  readOnly={readOnly}
                  focused={focus.paragraph === block.source}
                  placeholder={index === 0 ? '내용을 입력하세요' : undefined}
                  canRemove={section.blocks.length > 1}
                  onFocus={() => onFocus({ paragraph: block.source as XmlElement })}
                  onChange={(text) => onParagraphChange(block.source, text)}
                  onSplit={() => onParagraphSplit(block.source)}
                  onRemove={() => onParagraphRemove(block.source)}
                />
              ),
            )}
          </article>
        );
      })}
    </div>
  );
}
