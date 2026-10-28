import { hwpunit, type CharStyle, type JamoTextDocument, type ParagraphStyle } from '@jamo/core';
import type { CSSProperties } from 'react';
import { Editable } from './Editable.js';

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
  onParagraphChange: (source: unknown, text: string) => void;
  onParagraphSplit: (source: unknown) => void;
  onParagraphRemove: (source: unknown) => void;
}

const FALLBACK_FONTS = `'Noto Sans KR', 'Malgun Gothic', '맑은 고딕', 'Apple SD Gothic Neo', sans-serif`;

function charCss(style: CharStyle | undefined): CSSProperties {
  if (!style) return {};
  const css: CSSProperties = {};
  if (style.fontFamily) css.fontFamily = `'${style.fontFamily}', ${FALLBACK_FONTS}`;
  if (style.fontSize !== undefined) css.fontSize = `${style.fontSize}pt`;
  if (style.bold) css.fontWeight = 700;
  if (style.italic) css.fontStyle = 'italic';
  const decorations: string[] = [];
  if (style.underline) decorations.push('underline');
  if (style.strikeout) decorations.push('line-through');
  if (decorations.length > 0) css.textDecoration = decorations.join(' ');
  if (style.color && !style.color.startsWith('theme:')) css.color = style.color;
  if (style.highlight && !style.highlight.startsWith('theme:')) {
    css.backgroundColor = style.highlight;
  }
  if (style.superscript) {
    css.verticalAlign = 'super';
    css.fontSize = `${(style.fontSize ?? 10) * 0.7}pt`;
  }
  if (style.subscript) {
    css.verticalAlign = 'sub';
    css.fontSize = `${(style.fontSize ?? 10) * 0.7}pt`;
  }
  return css;
}

function paraCss(style: ParagraphStyle | undefined): CSSProperties {
  if (!style) return {};
  const css: CSSProperties = {};
  if (style.align) {
    css.textAlign =
      style.align === 'justify' ? 'justify' : style.align === 'distribute' ? 'justify' : style.align;
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

export function TextDocumentView({
  document: model,
  readOnly,
  zoom,
  onParagraphChange,
  onParagraphSplit,
  onParagraphRemove,
}: TextDocumentViewProps): JSX.Element {
  return (
    <div className="pages" style={{ ['--zoom' as string]: zoom }}>
      {model.sections.map((section, sectionIndex) => {
        const page = section.page;
        const width = hwpunit.toPx(page.width);
        return (
          <article
            key={sectionIndex}
            className="page"
            style={{
              width: `${width}px`,
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
            {section.paragraphs.map((para, paraIndex) => {
              const first = para.runs[0];
              const text = para.runs.map((r) => r.text).join('');
              const style = { ...paraCss(para.style), ...charCss(first?.style) };
              const headingLevel = para.style?.outlineLevel;
              return (
                <p
                  key={paraIndex}
                  className={`para${headingLevel ? ` outline-${Math.min(headingLevel, 3)}` : ''}`}
                  style={style}
                  title={para.style?.styleName}
                >
                  {readOnly ? (
                    // 여러 런의 서식을 그대로 보여 준다. 읽기 모드에서만.
                    para.runs.map((run, runIndex) => (
                      <span key={runIndex} style={charCss(run.style)}>
                        {run.text}
                      </span>
                    ))
                  ) : (
                    <Editable
                      value={text}
                      placeholder={paraIndex === 0 ? '내용을 입력하세요' : undefined}
                      onCommit={(next) => onParagraphChange(para.source, next)}
                      onSplit={() => onParagraphSplit(para.source)}
                      onRemoveEmpty={
                        section.paragraphs.length > 1
                          ? () => onParagraphRemove(para.source)
                          : undefined
                      }
                    />
                  )}
                </p>
              );
            })}
          </article>
        );
      })}
    </div>
  );
}
