import { hwpunit, type JamoPresentation, type JamoShape, type XmlElement } from '@jamo/core';
import { useState, type CSSProperties } from 'react';
import { Editable } from './Editable.js';

/**
 * 슬라이드 화면.
 *
 * 도형의 좌표가 실제로 들어 있으므로 그대로 배치한다. 슬라이드 폭에 맞춰
 * 전체를 축소하면 파워포인트에서 보던 배치가 거의 그대로 나온다.
 */

export interface SlideDeckViewProps {
  deck: JamoPresentation;
  readOnly: boolean;
  onShapeChange: (source: unknown, lines: string[]) => void;
  onShapeFocus: (shape: XmlElement | undefined, slideIndex: number) => void;
  onAddSlide: () => void;
  onRemoveSlide: (index: number) => void;
}

const SLIDE_WIDTH_PX = 960;
const FALLBACK_FONTS = `'Noto Sans KR', 'Malgun Gothic', '맑은 고딕', 'Apple SD Gothic Neo', sans-serif`;

export function SlideDeckView({
  deck,
  readOnly,
  onShapeChange,
  onShapeFocus,
  onAddSlide,
  onRemoveSlide,
}: SlideDeckViewProps): JSX.Element {
  const [current, setCurrent] = useState(0);
  const index = Math.min(current, Math.max(deck.slides.length - 1, 0));
  const slide = deck.slides[index];

  const scale = SLIDE_WIDTH_PX / hwpunit.toPx(deck.slideSize.width);
  const height = hwpunit.toPx(deck.slideSize.height) * scale;

  return (
    <div className="deck">
      <aside className="deck-rail">
        {deck.slides.map((_slide, i) => (
          <button
            key={i}
            type="button"
            className={`thumb${i === index ? ' thumb-active' : ''}`}
            onClick={() => setCurrent(i)}
          >
            <span className="thumb-no">{i + 1}</span>
            <span className="thumb-text">{firstLine(deck.slides[i]?.shapes ?? [])}</span>
          </button>
        ))}
        {!readOnly && (
          <button type="button" className="thumb thumb-add" onClick={onAddSlide}>
            + 슬라이드 추가
          </button>
        )}
      </aside>

      <div className="deck-stage">
        {slide ? (
          <>
            <div
              className="slide"
              style={{ width: `${SLIDE_WIDTH_PX}px`, height: `${height}px` }}
            >
              {slide.shapes.map((shape, shapeIndex) => (
                <ShapeBox
                  key={shapeIndex}
                  shape={shape}
                  scale={scale}
                  readOnly={readOnly}
                  onFocus={() => onShapeFocus(shape.source as XmlElement | undefined, index)}
                  onChange={(lines) => onShapeChange(shape.source, lines)}
                />
              ))}
            </div>
            <div className="deck-actions">
              <span className="muted">
                {index + 1} / {deck.slides.length}
              </span>
              {!readOnly && deck.slides.length > 1 && (
                <button type="button" className="ghost" onClick={() => onRemoveSlide(index)}>
                  이 슬라이드 삭제
                </button>
              )}
            </div>
          </>
        ) : (
          <p className="muted">슬라이드가 없습니다.</p>
        )}
      </div>
    </div>
  );
}

function ShapeBox({
  shape,
  scale,
  readOnly,
  onFocus,
  onChange,
}: {
  shape: JamoShape;
  scale: number;
  readOnly: boolean;
  onFocus: () => void;
  onChange: (lines: string[]) => void;
}): JSX.Element {
  const frame = shape.frame;
  const style: CSSProperties = frame
    ? {
        position: 'absolute',
        left: `${hwpunit.toPx(frame.x) * scale}px`,
        top: `${hwpunit.toPx(frame.y) * scale}px`,
        width: `${hwpunit.toPx(frame.width) * scale}px`,
        height: `${hwpunit.toPx(frame.height) * scale}px`,
      }
    : { position: 'relative', margin: '8px 0' };

  const firstRun = shape.paragraphs[0]?.runs[0];
  const fontSize = (firstRun?.style?.fontSize ?? 18) * scale;
  const align = shape.paragraphs[0]?.style?.align;

  const textStyle: CSSProperties = {
    fontSize: `${fontSize}pt`,
    fontWeight: firstRun?.style?.bold ? 700 : 400,
    fontStyle: firstRun?.style?.italic ? 'italic' : 'normal',
    fontFamily: firstRun?.style?.fontFamily
      ? `'${firstRun.style.fontFamily}', ${FALLBACK_FONTS}`
      : FALLBACK_FONTS,
    color: firstRun?.style?.color?.startsWith('theme:') ? undefined : firstRun?.style?.color,
    textAlign: align === 'justify' || align === 'distribute' ? 'justify' : align,
    lineHeight: 1.3,
  };

  const lines = shape.paragraphs.map((p) => p.runs.map((r) => r.text).join(''));
  const text = lines.join('\n');

  return (
    <div className="shape" style={style} title={shape.name}>
      {readOnly ? (
        <div style={textStyle} className="shape-text">
          {text}
        </div>
      ) : (
        <Editable
          className="shape-text"
          multiline
          style={textStyle}
          value={text}
          placeholder="텍스트를 입력하세요"
          onFocus={onFocus}
          onCommit={(next) => onChange(next.split('\n'))}
        />
      )}
    </div>
  );
}

function firstLine(shapes: JamoShape[]): string {
  for (const shape of shapes) {
    for (const para of shape.paragraphs) {
      const text = para.runs.map((r) => r.text).join('').trim();
      if (text !== '') return text.slice(0, 28);
    }
  }
  return '(빈 슬라이드)';
}
