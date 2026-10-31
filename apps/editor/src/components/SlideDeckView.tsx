import {
  hwpunit,
  type JamoFill,
  type JamoPresentation,
  type JamoShape,
  type JamoTable,
  type XmlElement,
} from '@jamo/core';
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Editable } from './Editable.js';
import { NotesPane } from './NotesPane.js';
import { useElementSize } from '../lib/useElementSize.js';
import { useDragSize } from '../lib/useDragSize.js';
import { charCss } from './TextDocumentView.js';

/**
 * 슬라이드 화면.
 *
 * 글자만 뽑아 늘어놓으면 "내용은 맞는데 전혀 다른 문서"가 된다. 어두운
 * 배경에 흰 글씨인 장표가 흰 배경에 검은 글씨로 나오면 쓸 수가 없다.
 * 그래서 배경, 도형 채우기, 그림, 표, 세로 정렬까지 좌표 그대로 그린다.
 *
 * 좌표가 실제 값이므로 슬라이드 폭에 맞춰 전체를 축소하면 파워포인트에서
 * 보던 배치가 거의 그대로 나온다.
 */

export interface SlideDeckViewProps {
  deck: JamoPresentation;
  readOnly: boolean;
  onShapeChange: (source: unknown, lines: string[]) => void;
  onShapeFocus: (shape: XmlElement | undefined, slideIndex: number) => void;
  onAddSlide: () => void;
  onRemoveSlide: (index: number) => void;
  /** 그림 파트를 화면용 주소로. */
  imageUrl: (part: string) => string | undefined;
  /** 지금 보고 있는 장. 발표 모드와 같은 값을 써야 해서 바깥이 들고 있다. */
  current: number;
  onCurrentChange: (index: number) => void;
  /** 발표자 메모를 엔진에 반영한다. */
  onNotesCommit: (slideIndex: number, text: string) => void;
  notesOpen: boolean;
  onToggleNotes: () => void;
  /** 이 장부터 발표 시작. */
  onPresent: (fromIndex: number) => void;
  /** 1 이면 맞춤 크기. 그보다 크면 넘치는 만큼 굴려 본다. */
  zoom: number;
  /**
   * 'width' — 좌우 폭에 맞춘다. 메모판을 끌어도 **폭이 그대로**이고
   *   세로만 보이는 만큼 달라진다. 파워포인트의 기본 느낌이다.
   * 'screen' — 장표 전체가 한눈에 들어오게 맞춘다.
   */
  fit: 'width' | 'screen';
}

/** 남은 자리를 다 써도 이보다는 작게 그리지 않는다. */
const SLIDE_MIN_WIDTH_PX = 320;
/** 넓은 화면에서 끝없이 커지지 않게. */
const SLIDE_MAX_WIDTH_PX = 2000;

/**
 * 메모판 기본 높이.
 *
 * 장표 쪽에 넉넉히 준다. 메모를 많이 쓸 때는 경계선을 끌면 되고 그 높이는
 * 기억된다. 반대로 기본을 크게 잡으면 장표가 작은 채로 남는다.
 */
const NOTES_DEFAULT_PX = 94;
/**
 * 머리글 줄(약 37px)이 이 높이 안에 함께 들어간다. 64 로 잡았더니 글 칸에
 * 23px 밖에 안 남아 한 줄도 못 보는 쪽지가 됐다. 글 칸에 두 줄(약 50px)은
 * 남는 값으로 잡는다. 더 줄이고 싶으면 '메모판 접기'가 있다.
 */
const NOTES_MIN_PX = 88;
/** 메모판을 아무리 키워도 슬라이드에 이만큼은 남긴다. */
const SLIDE_KEEP_PX = 200;

/** 슬라이드 목록 폭. 끌어서 바꾸면 그만큼 장표 자리가 줄고 늘어난다. */
const RAIL_DEFAULT_PX = 212;
const RAIL_MIN_PX = 116;
/** 목록을 아무리 넓혀도 장표에 이만큼은 남긴다. */
const STAGE_KEEP_PX = 360;

const NOTES_HEIGHT_KEY = 'jamo.notesHeight';
const RAIL_WIDTH_KEY = 'jamo.railWidth';

/** 번호 칸과 안팎 여백이 차지하는 몫. 목록 폭에서 이만큼 뺀 게 미리보기다. */
const THUMB_CHROME_PX = 44;
const FALLBACK_FONTS = `'Noto Sans KR', 'Malgun Gothic', '맑은 고딕', 'Apple SD Gothic Neo', sans-serif`;

function fillCss(fill: JamoFill | undefined): CSSProperties {
  if (!fill || fill.type === 'none') return {};
  if (fill.type === 'gradient' && fill.gradient) {
    // PPTX 의 각도는 3시 방향 0도 시계방향, CSS 는 12시 0도 시계방향이다.
    const deg = (fill.gradient.angle + 90) % 360;
    return { background: `linear-gradient(${deg}deg, ${fill.gradient.from}, ${fill.gradient.to})` };
  }
  if (!fill.color) return {};
  if (fill.alpha !== undefined && fill.alpha < 1) {
    return { backgroundColor: withAlpha(fill.color, fill.alpha) };
  }
  return { backgroundColor: fill.color };
}

function withAlpha(hex: string, alpha: number): string {
  const v = hex.replace(/^#/, '');
  const r = Number.parseInt(v.slice(0, 2), 16);
  const g = Number.parseInt(v.slice(2, 4), 16);
  const b = Number.parseInt(v.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

interface ShapeProps {
  shape: JamoShape;
  scale: number;
  readOnly: boolean;
  interactive: boolean;
  imageUrl: (part: string) => string | undefined;
  onFocus: () => void;
  onChange: (lines: string[]) => void;
}

function ShapeBox({
  shape,
  scale,
  readOnly,
  interactive,
  imageUrl,
  onFocus,
  onChange,
}: ShapeProps): JSX.Element | null {
  const [editing, setEditing] = useState(false);
  const frame = shape.frame;
  if (!frame) return null;

  const px = (v: number): number => hwpunit.toPx(v) * scale;
  const style: CSSProperties = {
    position: 'absolute',
    left: `${px(frame.x)}px`,
    top: `${px(frame.y)}px`,
    width: `${px(frame.width)}px`,
    height: `${px(frame.height)}px`,
    zIndex: shape.zIndex,
    ...fillCss(shape.fill),
  };
  if (shape.rotation) style.transform = `rotate(${shape.rotation}deg)`;
  if (shape.line?.color) {
    style.border = `${Math.max((shape.line.width ?? 1) * scale, 0.5)}px solid ${shape.line.color}`;
  }
  if (shape.flipH || shape.flipV) {
    style.transform = `${style.transform ?? ''} scale(${shape.flipH ? -1 : 1}, ${shape.flipV ? -1 : 1})`.trim();
  }
  if (shape.geometry === 'ellipse') style.borderRadius = '50%';
  else if (shape.geometry === 'roundRect') {
    // 반경은 짧은 변 기준 비율이다.
    const shortSide = Math.min(px(frame.width), px(frame.height));
    style.borderRadius = `${shortSide * (shape.cornerRadius ?? 0.16667)}px`;
  }

  if (shape.image && shape.paragraphs.length === 0) {
    const url = imageUrl(shape.image.part);
    return (
      <div className="slide-shape" style={style} title={shape.name}>
        {url ? (
          <img
            src={url}
            alt={shape.image.alt ?? ''}
            style={{
              width: '100%',
              height: '100%',
              // PPTX 의 기본은 "틀에 맞춰 늘리기"다. 비율을 지키면 배경 사진이
              // 틀을 못 채워 흰 띠가 생긴다.
              objectFit: shape.image.fit === 'contain' ? 'contain' : shape.image.fit === 'cover' ? 'cover' : 'fill',
              display: 'block',
            }}
          />
        ) : (
          // emf/wmf 처럼 브라우저가 못 읽는 그림. 빈칸보다 자리라도 보여 준다.
          <div className="slide-image-missing">그림</div>
        )}
      </div>
    );
  }

  if (shape.table) {
    return (
      <div className="slide-shape" style={style} title={shape.name}>
        <SlideTable table={shape.table} scale={scale} />
      </div>
    );
  }

  const inset = shape.inset;
  const body: CSSProperties = {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    justifyContent:
      shape.anchor === 'middle' ? 'center' : shape.anchor === 'bottom' ? 'flex-end' : 'flex-start',
    paddingLeft: inset ? `${px(inset.left)}px` : undefined,
    paddingRight: inset ? `${px(inset.right)}px` : undefined,
    paddingTop: inset ? `${px(inset.top)}px` : undefined,
    paddingBottom: inset ? `${px(inset.bottom)}px` : undefined,
    overflow: 'hidden',
  };

  // 도형을 그림으로 채운 경우. 글자가 그 위에 얹힌다.
  const backdrop = shape.image ? imageUrl(shape.image.part) : undefined;
  if (backdrop) {
    style.backgroundImage = `url(${backdrop})`;
    style.backgroundSize = shape.image?.fit === 'contain' ? 'contain' : shape.image?.fit === 'fill' ? '100% 100%' : 'cover';
    style.backgroundPosition = 'center';
  }

  const hasText = shape.paragraphs.some((p) => p.runs.some((r) => r.text !== ''));
  const lines = shape.paragraphs.map((p) => p.runs.map((r) => r.text).join(''));
  const first = shape.paragraphs[0]?.runs[0];
  const canEdit = interactive && !readOnly && shape.paragraphs.length > 0;

  return (
    <div
      className={`slide-shape${canEdit ? ' slide-shape-text' : ''}`}
      style={style}
      title={shape.name}
      // 평소에는 서식 그대로 보여 주고, 눌렀을 때만 편집으로 바꾼다.
      // 편집 상태로 계속 두면 런별 서식이 첫 런 하나로 뭉개져, 한 줄 안에
      // 색과 크기가 섞인 장표가 전혀 다르게 보인다.
      onDoubleClick={canEdit ? () => setEditing(true) : undefined}
    >
      <div style={body}>
        {editing && canEdit ? (
          <Editable
            className="shape-text"
            multiline
            autoFocus
            style={{ ...runCss(first?.style, scale), ...paragraphCss(shape.paragraphs[0]?.style, scale) }}
            value={lines.join('\n')}
            placeholder={hasText ? undefined : '텍스트'}
            onFocus={onFocus}
            onBlurCapture={() => setEditing(false)}
            onCommit={(next) => onChange(next.split('\n'))}
          />
        ) : (
          shape.paragraphs.map((para, i) => (
            <p key={i} style={paragraphCss(para.style, scale)}>
              {para.runs.map((run, j) => (
                <span key={j} style={runCss(run.style, scale)}>
                  {run.text}
                </span>
              ))}
            </p>
          ))
        )}
      </div>
      {canEdit && !editing && hasText && (
        <button
          type="button"
          className="shape-edit-hint"
          title="글자 고치기 (두 번 눌러도 됩니다)"
          onClick={() => {
            onFocus();
            setEditing(true);
          }}
        >
          고치기
        </button>
      )}
    </div>
  );
}

function runCss(style: JamoShape['paragraphs'][number]['runs'][number]['style'], scale: number): CSSProperties {
  const css = charCss(style);
  // 글자 크기는 슬라이드 축소 비율을 함께 먹여야 배치가 맞는다.
  if (style?.fontSize !== undefined) css.fontSize = `${style.fontSize * scale}pt`;
  if (!style?.fontFamily) css.fontFamily = FALLBACK_FONTS;
  else css.fontFamily = `'${style.fontFamily}', ${FALLBACK_FONTS}`;
  return css;
}

function paragraphCss(
  style: JamoShape['paragraphs'][number]['style'],
  scale: number,
): CSSProperties {
  const css: CSSProperties = { margin: 0, lineHeight: 1.25 };
  if (style?.align) {
    css.textAlign = style.align === 'distribute' ? 'justify' : style.align;
  }
  if (style?.indentLeft) css.marginLeft = `${hwpunit.toPx(style.indentLeft) * scale}px`;
  if (style?.spaceBefore) css.marginTop = `${hwpunit.toPx(style.spaceBefore) * scale}px`;
  if (style?.spaceAfter) css.marginBottom = `${hwpunit.toPx(style.spaceAfter) * scale}px`;
  if (style?.lineHeight?.type === 'percent') css.lineHeight = style.lineHeight.value / 100;
  return css;
}

function SlideTable({ table, scale }: { table: JamoTable; scale: number }): JSX.Element {
  return (
    <table className="slide-table" style={{ width: '100%', height: '100%' }}>
      <tbody>
        {table.rows.map((row, r) => (
          <tr key={r}>
            {row.cells.map((cell, c) => (
              <td
                key={c}
                colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
                rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
                style={cell.shade ? { backgroundColor: cell.shade } : undefined}
              >
                {cell.paragraphs.map((para, i) => (
                  <p key={i} style={paragraphCss(para.style, scale)}>
                    {para.runs.map((run, j) => (
                      <span key={j} style={runCss(run.style, scale)}>
                        {run.text}
                      </span>
                    ))}
                  </p>
                ))}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function SlideCanvas({
  slide,
  deck,
  width,
  readOnly,
  interactive,
  imageUrl,
  onShapeFocus,
  onShapeChange,
  slideIndex,
}: {
  slide: JamoPresentation['slides'][number];
  deck: JamoPresentation;
  width: number;
  readOnly: boolean;
  interactive: boolean;
  imageUrl: (part: string) => string | undefined;
  onShapeFocus?: (shape: XmlElement | undefined, slideIndex: number) => void;
  onShapeChange?: (source: unknown, lines: string[]) => void;
  slideIndex: number;
}): JSX.Element {
  const scale = width / hwpunit.toPx(deck.slideSize.width);
  const height = hwpunit.toPx(deck.slideSize.height) * scale;

  return (
    <div
      className="slide"
      style={{
        width: `${width}px`,
        height: `${height}px`,
        // 배경을 못 찾으면 흰색. 파워포인트의 기본값과 같다.
        backgroundColor: '#FFFFFF',
        ...fillCss(slide.background),
      }}
    >
      {slide.shapes.map((shape, i) => (
        <ShapeBox
          key={i}
          shape={shape}
          scale={scale}
          readOnly={readOnly}
          interactive={interactive}
          imageUrl={imageUrl}
          onFocus={() => onShapeFocus?.(shape.source as XmlElement | undefined, slideIndex)}
          onChange={(lines) => onShapeChange?.(shape.source, lines)}
        />
      ))}
    </div>
  );
}

export function SlideDeckView({
  deck,
  readOnly,
  onShapeChange,
  onShapeFocus,
  onAddSlide,
  onRemoveSlide,
  imageUrl,
  current,
  onCurrentChange,
  onNotesCommit,
  notesOpen,
  onToggleNotes,
  onPresent,
  zoom,
  fit,
}: SlideDeckViewProps): JSX.Element {
  const index = Math.min(current, Math.max(deck.slides.length - 1, 0));
  const slide = deck.slides[index];

  // 자리를 재서 그 안에 맞춘다. 고정 폭으로 그리면 노트북 화면에서
  // 메모판이 화면 밖으로 밀려 "없는 것"이 된다.
  const [canvasRef, canvasBox] = useElementSize<HTMLDivElement>();
  const [stageRef, stageBox] = useElementSize<HTMLDivElement>();
  const [deckRef, deckBox] = useElementSize<HTMLDivElement>();

  // 메모판 높이 — 위로 끌면 커진다.
  const notes = useDragSize({
    storageKey: NOTES_HEIGHT_KEY,
    defaultValue: NOTES_DEFAULT_PX,
    min: NOTES_MIN_PX,
    max: (stageBox.height > 0 ? stageBox.height : 600) - SLIDE_KEEP_PX,
    axis: 'y',
    reverse: true,
  });

  // 슬라이드 목록 폭 — 오른쪽으로 끌면 넓어지고 그만큼 장표 자리가 줄어든다.
  const rail = useDragSize({
    storageKey: RAIL_WIDTH_KEY,
    defaultValue: RAIL_DEFAULT_PX,
    min: RAIL_MIN_PX,
    max: (deckBox.width > 0 ? deckBox.width : 1200) - STAGE_KEEP_PX,
    axis: 'x',
    step: 16,
  });

  const thumbWidth = Math.max(72, rail.size - THUMB_CHROME_PX);

  // 미리보기 단추들. 선택이 바뀌면 그 자리로 목록을 굴려야 해서 들고 있는다.
  const thumbRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // 선택된 장이 늘 보이게 한다. 목록을 손으로 굴려 둔 뒤 장을 바꾸면
  // 고른 장이 화면 밖에 있어 어디로 갔는지 알 수 없게 된다.
  // 'nearest' 라서 이미 보이면 아무것도 하지 않는다 — 공연히 들썩이지 않는다.
  useEffect(() => {
    thumbRefs.current[index]?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  /**
   * 목록에서 화살표로 장을 넘긴다.
   *
   * 예전에는 브라우저 기본 동작만 남아 목록이 40px 씩 밀릴 뿐 고른 장은
   * 그대로였다. 파워포인트는 화살표로 장이 넘어가고 목록이 따라 움직인다.
   */
  const onRailKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      const last = deck.slides.length - 1;
      if (last < 0) return;
      const step = 5; // PageUp/PageDown 한 번에 넘길 장 수
      let next: number;
      switch (event.key) {
        case 'ArrowDown':
        case 'ArrowRight':
          next = Math.min(index + 1, last);
          break;
        case 'ArrowUp':
        case 'ArrowLeft':
          next = Math.max(index - 1, 0);
          break;
        case 'PageDown':
          next = Math.min(index + step, last);
          break;
        case 'PageUp':
          next = Math.max(index - step, 0);
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = last;
          break;
        default:
          return;
      }
      event.preventDefault();
      if (next !== index) onCurrentChange(next);
      // 다음 화살표도 이어서 먹게 포커스를 옮긴다. 굴리는 건 위 효과가
      // 'nearest' 로 하므로 여기서는 막는다 — 둘 다 굴리면 한 장 넘겼는데
      // 목록이 400px 씩 튄다.
      thumbRefs.current[next]?.focus({ preventScroll: true });
    },
    [deck.slides.length, index, onCurrentChange],
  );

  const aspect = hwpunit.toPx(deck.slideSize.width) / hwpunit.toPx(deck.slideSize.height);

  // 폭 맞춤에서는 **세로를 보지 않는다**. 그래야 메모판을 끌어 높이가
  // 달라져도 장표 폭이 그대로다. 높이까지 함께 보면 메모판을 조금 끌 때마다
  // 장표가 가로세로로 같이 줄었다 늘었다 해서 화면이 출렁인다.
  //
  // 대신 장표가 세로로 넘칠 수 있으므로 그 자리를 굴려 볼 수 있게 한다.
  // 전체를 한눈에 보고 싶으면 '화면 맞춤' 으로 바꾸면 된다.
  const available = canvasBox.width > 0 ? canvasBox.width : 960;
  const base =
    fit === 'width'
      ? available
      : Math.min(available, (canvasBox.height > 0 ? canvasBox.height : 540) * aspect);

  const fittedWidth = Math.max(SLIDE_MIN_WIDTH_PX, Math.min(SLIDE_MAX_WIDTH_PX, base));
  const slideWidth = Math.round(fittedWidth * zoom);
  const slideHeight = slideWidth / aspect;

  // 넘칠 때만 굴림막대를 쓴다. 딱 맞을 때 켜 두면 반올림 때문에
  // 막대가 생겼다 사라졌다 하며 폭이 떨린다.
  const overflows = slideHeight > canvasBox.height + 1 || slideWidth > canvasBox.width + 1;

  return (
    <div className="deck" ref={deckRef}>
      <aside
        className="deck-rail"
        style={{ width: `${Math.round(rail.size)}px` }}
        aria-label="슬라이드 목록 — 화살표로 장을 넘깁니다"
        onKeyDown={onRailKeyDown}
      >
        {deck.slides.map((item, i) => (
          <button
            key={i}
            type="button"
            ref={(el) => {
              thumbRefs.current[i] = el;
            }}
            className={`thumb${i === index ? ' thumb-active' : ''}`}
            aria-current={i === index ? 'true' : undefined}
            // 고른 장만 Tab 으로 들어온다. 42장짜리에서 Tab 을 42번 누르게
            // 하지 않으려는 것 — 들어온 다음은 화살표로 옮긴다.
            tabIndex={i === index ? 0 : -1}
            onClick={() => onCurrentChange(i)}
          >
            <span className="thumb-no">
              {i + 1}
              {item.notes && <span className="thumb-note-dot" title="메모 있음" />}
            </span>
            {/* 작은 미리보기도 같은 그리기 경로를 쓴다. 본 화면과 다르게 보이면
                어느 장인지 찾기 어렵다. */}
            <span className="thumb-canvas">
              <SlideCanvas
                slide={item}
                deck={deck}
                width={thumbWidth}
                readOnly
                interactive={false}
                imageUrl={imageUrl}
                slideIndex={i}
              />
            </span>
          </button>
        ))}
        {!readOnly && (
          <button type="button" className="thumb thumb-add" onClick={onAddSlide}>
            + 슬라이드 추가
          </button>
        )}
      </aside>

      {/* 목록과 장표 사이. 끌면 목록이 넓어지고 그만큼 장표 자리가 줄어든다. */}
      <div
        className="rail-splitter"
        aria-label="슬라이드 목록 폭 조절 — 끌거나 좌우 화살표를 누르세요"
        title="끌어서 목록 폭을 바꿉니다. 두 번 누르면 기본 폭으로."
        {...rail.separatorProps}
      >
        <span className="rail-splitter-grip" />
      </div>

      <div className="deck-stage" ref={stageRef}>
        {slide ? (
          <>
            <div
              className="deck-canvas"
              ref={canvasRef}
              style={{ overflow: overflows ? 'auto' : 'hidden' }}
            >
              <SlideCanvas
                slide={slide}
                deck={deck}
                width={slideWidth}
                readOnly={readOnly}
                interactive
                imageUrl={imageUrl}
                onShapeFocus={onShapeFocus}
                onShapeChange={onShapeChange}
                slideIndex={index}
              />
            </div>
            {notesOpen && (
              <div
                className="notes-splitter"
                aria-label="메모판 높이 조절 — 끌거나 위아래 화살표를 누르세요"
                title="끌어서 메모판 높이를 바꿉니다. 두 번 누르면 기본 높이로."
                style={{ width: `${Math.round(fittedWidth)}px` }}
                {...notes.separatorProps}
              >
                <span className="notes-splitter-grip" />
              </div>
            )}
            <NotesPane
              width={Math.round(fittedWidth)}
              height={notes.size}
              slideIndex={index}
              value={slide.notes}
              readOnly={readOnly}
              open={notesOpen}
              onToggle={onToggleNotes}
              onCommit={onNotesCommit}
            />
          </>
        ) : (
          <p className="muted">슬라이드가 없습니다.</p>
        )}
      </div>
    </div>
  );
}
