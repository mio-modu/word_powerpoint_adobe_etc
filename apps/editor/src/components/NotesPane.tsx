import { useCallback, useEffect, useRef, useState } from 'react';
import { clearPendingEdit, registerPendingEdit } from '../lib/pendingEdit.js';

/**
 * 강의용 메모판.
 *
 * 슬라이드 아래 칸에 발표자 메모를 적는다. 청중 화면에는 안 나오고,
 * 발표자 보기와 파워포인트의 "슬라이드 노트"에 그대로 들어간다.
 *
 * 글은 이 칸이 들고 있다가 가끔씩만 엔진에 밀어 넣는다. 매 타자마다
 * 넣으면 48장짜리 덱을 통째로 다시 그리느라 입력이 밀린다. 대신 밀어
 * 넣어야 할 순간을 빠짐없이 잡는다 — 칸을 떠날 때, 다른 장으로 옮길 때,
 * 잠깐 멈췄을 때, 그리고 Ctrl+S 같은 명령이 실행되기 직전.
 */

/** 타자를 멈추고 이만큼 지나면 반영한다. */
const IDLE_MS = 1200;

export interface NotesPaneProps {
  slideIndex: number;
  /** 엔진이 들고 있는 현재 메모. */
  value: string | undefined;
  readOnly: boolean;
  open: boolean;
  onToggle: () => void;
  onCommit: (slideIndex: number, text: string) => void;
}

export function NotesPane({
  slideIndex,
  value,
  readOnly,
  open,
  onToggle,
  onCommit,
}: NotesPaneProps): JSX.Element {
  const [draft, setDraft] = useState(value ?? '');

  // 지금 화면이 어느 장의 글을 들고 있는지. 장을 옮길 때 이전 장에
  // 밀어 넣어야 하므로 draft 와 짝지어 기억한다.
  const held = useRef({ index: slideIndex, text: value ?? '' });

  // 엔진 값을 마지막으로 맞춰 본 시점. 내가 밀어 넣어서 바뀐 것인지,
  // 바깥(되돌리기·새 파일)에서 바뀐 것인지 가리는 기준이다.
  //
  // 이게 없으면 이런 일이 생긴다: 1.2초가 지나 밀어 넣는 사이에도 타자는
  // 계속되는데, 반영이 끝나 내려온 (조금 뒤처진) 값을 바깥 변경으로 보고
  // 덮어써서 그 사이에 친 글자가 사라진다.
  const lastSeen = useRef(value ?? '');

  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  const flush = useCallback(() => {
    const { index, text } = held.current;
    lastSeen.current = text;
    commitRef.current(index, text);
  }, []);

  // 장이 바뀌면 들고 있던 글을 먼저 밀어 넣고 새 장의 글을 받는다.
  useEffect(() => {
    if (held.current.index !== slideIndex) {
      flush();
      held.current = { index: slideIndex, text: value ?? '' };
      lastSeen.current = value ?? '';
      setDraft(value ?? '');
      return;
    }
    // 같은 장인데 엔진 쪽 값이 내가 아는 것과 다르다면 바깥에서 바뀐 것이다.
    if ((value ?? '') !== lastSeen.current) {
      held.current = { index: slideIndex, text: value ?? '' };
      lastSeen.current = value ?? '';
      setDraft(value ?? '');
    }
  }, [slideIndex, value, flush]);

  // 타자가 멎으면 반영한다.
  useEffect(() => {
    if (readOnly) return;
    if (draft === lastSeen.current) return;
    const timer = setTimeout(flush, IDLE_MS);
    return () => clearTimeout(timer);
  }, [draft, readOnly, flush]);

  // 화면에서 사라질 때(파일을 닫거나 메모판을 접을 때) 빠뜨리지 않는다.
  useEffect(
    () => () => {
      flush();
      clearPendingEdit(flush);
    },
    [flush],
  );

  const change = (text: string): void => {
    held.current = { index: slideIndex, text };
    setDraft(text);
  };

  const lineCount = draft === '' ? 0 : draft.split('\n').length;

  if (!open) {
    return (
      <div className="notes-pane notes-pane-closed">
        <button type="button" className="notes-toggle" onClick={onToggle}>
          메모판 펼치기
          {draft.trim() !== '' && <span className="notes-dot" title="이 장에 메모가 있습니다" />}
        </button>
      </div>
    );
  }

  return (
    <div className="notes-pane">
      <div className="notes-head">
        <button type="button" className="notes-toggle" onClick={onToggle}>
          메모판 접기
        </button>
        <span className="notes-title">{slideIndex + 1}장 발표자 메모</span>
        <span className="muted notes-count">{lineCount > 0 ? `${lineCount}줄` : '비어 있음'}</span>
      </div>
      <textarea
        className="notes-input"
        value={draft}
        readOnly={readOnly}
        spellCheck={false}
        placeholder={
          readOnly
            ? '읽기 전용 문서입니다.'
            : '강의할 때 볼 메모를 적으세요. 청중 화면에는 나오지 않습니다.\n발표 중 S 를 누르면 이 메모가 보입니다.'
        }
        onFocus={() => registerPendingEdit(flush)}
        onChange={(event) => change(event.target.value)}
        onBlur={() => {
          flush();
          clearPendingEdit(flush);
        }}
        // Esc 로 메모판을 빠져나간다. 발표 모드 단축키와 겹치지 않게
        // 여기서 멈춘다.
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            event.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}
