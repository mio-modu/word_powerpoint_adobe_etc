import {
  useCallback,
  useEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { clearPendingEdit, registerPendingEdit } from '../lib/pendingEdit.js';

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
  /** Shift+클릭으로 셀 범위를 고를 때 쓴다. focus 만으로는 Shift 를 알 수 없다. */
  onMouseDown?: (event: ReactMouseEvent<HTMLDivElement>) => void;
  /** Tab 처리처럼 기본 동작보다 먼저 가로채야 하는 키. */
  onKeyDownCapture?: (event: KeyboardEvent<HTMLDivElement>) => void;
  'data-cell'?: string;
  /** 나타나자마자 커서를 넣는다. 눌러서 편집으로 바꿀 때 쓴다. */
  autoFocus?: boolean;
  /** 편집을 마쳤을 때. 반영이 끝난 뒤 불린다. */
  onBlurCapture?: () => void;
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
  onMouseDown,
  onKeyDownCapture,
  'data-cell': dataCell,
  autoFocus,
  onBlurCapture,
}: EditableProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 편집 중(포커스 상태)에는 절대 덮어쓰지 않는다.
    if (document.activeElement === el) return;
    if (el.textContent !== value) el.textContent = value;
  }, [value]);

  useEffect(() => {
    if (!autoFocus) return;
    const el = ref.current;
    if (!el) return;
    el.focus();
    // 커서를 글 끝에 둔다. 맨 앞에 두면 이어 쓰기가 어색하다.
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [autoFocus]);

  // 글만 반영한다. 편집 상태는 그대로 둔다 — Ctrl+S 로 밀어 넣을 때
  // 편집이 풀려 버리면 이어 쓸 수가 없다.
  const commitText = (): void => {
    const el = ref.current;
    if (!el) return;
    const text = el.textContent ?? '';
    if (text !== value) onCommit(text);
  };

  // 최신 commitText 를 가리키는 고정 함수. 등록/해제가 엇갈리지 않게.
  const latest = useRef(commitText);
  latest.current = commitText;
  const flush = useCallback(() => latest.current(), []);

  useEffect(() => () => clearPendingEdit(flush), [flush]);

  const commit = (): void => {
    commitText();
    clearPendingEdit(flush);
    onBlurCapture?.();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && onSplit) {
      event.preventDefault();
      const el = ref.current;
      const text = el?.textContent ?? '';
      if (text !== value) onCommit(text);
      clearPendingEdit(flush);
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
      data-cell={dataCell}
      onFocus={() => {
        registerPendingEdit(flush);
        onFocus?.();
      }}
      onMouseDown={onMouseDown}
      onBlur={commit}
      onKeyDownCapture={onKeyDownCapture}
      onKeyDown={handleKeyDown}
    />
  );
}
