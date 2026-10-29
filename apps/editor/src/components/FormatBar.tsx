import type { CharStyle, ParagraphStyle } from '@jamo/core';
import type { SessionApi } from '../session.js';

/**
 * 서식 도구막대.
 *
 * 선택 영역 단위가 아니라 **문단 단위**로 적용한다. 선택 영역 단위로 하려면
 * 런을 선택 경계에서 쪼개야 하는데, 그건 글자 하나 바꿀 때마다 문서 구조를
 * 흔드는 일이라 더 조심스럽게 들어가야 한다. 지금은 손이 덜 가는 쪽을 택했다.
 */
export interface FormatBarProps {
  session: SessionApi;
  disabled: boolean;
  isDeck: boolean;
}

const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48];
const COLORS = ['#000000', '#444444', '#C00000', '#0066CC', '#007700', '#CC6600'];

export function FormatBar({ session, disabled, isDeck }: FormatBarProps): JSX.Element {
  const char: CharStyle | undefined = session.currentCharStyle();
  const para: ParagraphStyle | undefined = session.currentParagraphStyle();
  const noTarget = disabled || (!isDeck && session.focus.paragraph === undefined);

  const toggle = (key: keyof CharStyle): void => {
    session.applyCharStyle({ [key]: !char?.[key] } as Partial<CharStyle>);
  };

  const align = (value: ParagraphStyle['align']): void => {
    session.applyParagraphStyle({ align: value });
  };

  return (
    <div className="formatbar">
      <div className="toolbar-group">
        <button
          type="button"
          className={char?.bold ? 'on' : undefined}
          disabled={noTarget}
          title="진하게 (Ctrl+B)"
          onClick={() => toggle('bold')}
        >
          <strong>가</strong>
        </button>
        <button
          type="button"
          className={char?.italic ? 'on' : undefined}
          disabled={noTarget}
          title="기울임 (Ctrl+I)"
          onClick={() => toggle('italic')}
        >
          <em>가</em>
        </button>
        <button
          type="button"
          className={char?.underline ? 'on' : undefined}
          disabled={noTarget}
          title="밑줄 (Ctrl+U)"
          onClick={() => toggle('underline')}
        >
          <span style={{ textDecoration: 'underline' }}>가</span>
        </button>
        <button
          type="button"
          className={char?.strikeout ? 'on' : undefined}
          disabled={noTarget}
          title="취소선 (Ctrl+Shift+S)"
          onClick={() => toggle('strikeout')}
        >
          <span style={{ textDecoration: 'line-through' }}>가</span>
        </button>
      </div>

      <div className="toolbar-group">
        <select
          className="size-select"
          disabled={noTarget}
          title="글자 크기 (Ctrl+] / Ctrl+[)"
          value={char?.fontSize ?? 10}
          onChange={(e) => session.applyCharStyle({ fontSize: Number(e.target.value) })}
        >
          {FONT_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}pt
            </option>
          ))}
        </select>
        <div className="swatches">
          {COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className="swatch"
              disabled={noTarget}
              title={`글자색 ${color}`}
              style={{ background: color }}
              onClick={() => session.applyCharStyle({ color })}
            />
          ))}
        </div>
      </div>

      {!isDeck && (
        <div className="toolbar-group">
          {(
            [
              ['left', '왼쪽 정렬 (Ctrl+L)', '≡'],
              ['center', '가운데 정렬 (Ctrl+E)', '≡'],
              ['right', '오른쪽 정렬 (Ctrl+R)', '≡'],
              ['justify', '양쪽 정렬 (Ctrl+J)', '≡'],
            ] as const
          ).map(([value, title]) => (
            <button
              key={value}
              type="button"
              className={`align align-${value}${para?.align === value ? ' on' : ''}`}
              disabled={noTarget}
              title={title}
              onClick={() => align(value)}
            >
              <span />
              <span />
              <span />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
