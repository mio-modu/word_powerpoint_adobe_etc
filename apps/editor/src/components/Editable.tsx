import { useEffect, useRef, type CSSProperties, type KeyboardEvent } from 'react';

/**
 * contentEditable 한 줄/여러 줄 편집기.
 *
 * React 와 contentEditable 을 같이 쓸 때의 고전적인 문제가 있다: 매 입력마다
 * state 를 갱신해 다시 그리면 캐럿이 맨 앞으로 튄다. 그래서 입력 중에는
 * DOM 을 React 가 건드리지 않게 두고, 바깥 값이 실제로 달라졌을 때만
 * textContent 를 맞춘다. 반영은 blur 와 Enter 에서 한다.
 */

export interface EditableProps {
  value: string;
  onCommit: (value: string) => void;
  /** Enter 로 다음 문단을 만들 때. 지정하지 않으면 Enter 가 줄바꿈이 된다. */
  onSplit?: (before: string) => void;
  /** 빈 문단에서 Backspace 로 삭제할 때. */
  onRemoveEmpty?: () => void;
  multiline?: boolean;
  style?: CSSProperties;
  className?: string;
  placeholder?: string;
  /** 커서가 들어왔을 때. 서식 명령이 어디에 적용될지 정하는 데 쓴다. */
  onFocus?: () => void;
}

export function Editable({
  value,
  onCommit,
  onSplit,
  onRemoveEmpty,
  multiline = false,
  style,
  className,
  placeholder,
  onFocus,
}: EditableProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 편집 중(포커스 상태)에는 절대 덮어쓰지 않는다.
    if (document.activeElement === el) return;
    if (el.textContent !== value) el.textContent = value;
  }, [value]);

  const commit = (): void => {
    const el = ref.current;
    if (!el) return;
    const text = el.textContent ?? '';
    if (text !== value) onCommit(text);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && onSplit) {
      event.preventDefault();
      const el = ref.current;
      const text = el?.textContent ?? '';
      if (text !== value) onCommit(text);
      onSplit(text);
      return;
    }
    if (
      event.key === 'Backspace' &&
      onRemoveEmpty &&
      (ref.current?.textContent ?? '') === ''
    ) {
      event.preventDefault();
      onRemoveEmpty();
    }
  };

  return (
    <div
      ref={ref}
      className={className}
      style={{ whiteSpace: multiline ? 'pre-wrap' : 'pre-wrap', outline: 'none', ...style }}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      data-placeholder={placeholder}
      onFocus={onFocus}
      onBlur={commit}
      onKeyDown={handleKeyDown}
    />
  );
}
