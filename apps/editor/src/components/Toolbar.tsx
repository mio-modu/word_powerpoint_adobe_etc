import { KIND_LABEL } from '../lib/formats.js';
import type { SessionApi } from '../session.js';

export interface ToolbarProps {
  session: SessionApi;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  fileSystemAccess: boolean;
  onShowHelp: () => void;
}

export function Toolbar({
  session,
  zoom,
  onZoomChange,
  fileSystemAccess,
  onShowHelp,
}: ToolbarProps): JSX.Element {
  const { state } = session;
  const isDeck = state?.kind === 'pptx';
  const inTable = session.focus.table !== undefined;

  return (
    <header className="toolbar">
      <div className="brand">
        <span className="brand-mark">자모</span>
        <span className="brand-sub">오피스</span>
      </div>

      <div className="toolbar-group">
        <button type="button" onClick={() => void session.open()} disabled={session.busy}>
          열기
        </button>
        <div className="menu">
          <button type="button">새 문서 ▾</button>
          <div className="menu-items">
            <button type="button" onClick={() => session.createNew('hwpx')}>
              한글 문서 (.hwpx)
            </button>
            <button type="button" onClick={() => session.createNew('docx')}>
              워드 문서 (.docx)
            </button>
            <button type="button" onClick={() => session.createNew('pptx')}>
              파워포인트 (.pptx)
            </button>
          </div>
        </div>
      </div>

      {state && (
        <>
          <div className="toolbar-group">
            <button
              type="button"
              onClick={() => void session.save()}
              disabled={session.busy || state.readOnly}
              title={
                state.canSaveInPlace
                  ? '열었던 파일에 덮어쓰기 (Ctrl+S)'
                  : '저장 위치를 고릅니다 (Ctrl+S)'
              }
            >
              저장{state.dirty ? ' •' : ''}
            </button>
            <div className="menu">
              <button type="button">변환 ▾</button>
              <div className="menu-items">
                <button type="button" onClick={() => void session.saveAsFormat('hwpx')}>
                  한글 .hwpx 로 내보내기
                </button>
                <button type="button" onClick={() => void session.saveAsFormat('docx')}>
                  워드 .docx 로 내보내기
                </button>
                <button type="button" onClick={() => void session.saveAsFormat('pptx')}>
                  파워포인트 .pptx 로 내보내기
                </button>
              </div>
            </div>
          </div>

          <div className="toolbar-group">
            <button
              type="button"
              title="되돌리기 (Ctrl+Z)"
              disabled={!state.canUndo || state.readOnly}
              onClick={session.undo}
            >
              ↶
            </button>
            <button
              type="button"
              title="다시 실행 (Ctrl+Y)"
              disabled={!state.canRedo || state.readOnly}
              onClick={session.redo}
            >
              ↷
            </button>
          </div>

          {!isDeck && !state.readOnly && (
            <div className="menu">
              <button type="button" className={inTable ? 'on' : undefined}>
                표 ▾
              </button>
              <div className="menu-items">
                <button type="button" onClick={() => session.insertTable(3, 3)}>
                  표 만들기 3×3 (Ctrl+Alt+T)
                </button>
                <button type="button" onClick={() => session.insertTable(2, 2)}>
                  표 만들기 2×2
                </button>
                <button type="button" onClick={() => session.insertTable(5, 3)}>
                  표 만들기 5×3
                </button>
                <hr />
                <button type="button" disabled={!inTable} onClick={() => session.tableCommand('rowBelow')}>
                  아래에 줄 추가 (Ctrl+Alt+↓)
                </button>
                <button type="button" disabled={!inTable} onClick={() => session.tableCommand('rowAbove')}>
                  위에 줄 추가 (Ctrl+Alt+↑)
                </button>
                <button type="button" disabled={!inTable} onClick={() => session.tableCommand('columnRight')}>
                  오른쪽에 칸 추가 (Ctrl+Alt+→)
                </button>
                <button type="button" disabled={!inTable} onClick={() => session.tableCommand('columnLeft')}>
                  왼쪽에 칸 추가 (Ctrl+Alt+←)
                </button>
                <hr />
                <button type="button" disabled={!inTable} onClick={() => session.tableCommand('deleteRow')}>
                  줄 지우기
                </button>
                <button type="button" disabled={!inTable} onClick={() => session.tableCommand('deleteColumn')}>
                  칸 지우기
                </button>
                <button type="button" disabled={!inTable} onClick={() => session.tableCommand('deleteTable')}>
                  표 지우기
                </button>
              </div>
            </div>
          )}

          {!isDeck && (
            <div className="toolbar-group zoom">
              <button type="button" onClick={() => onZoomChange(Math.max(0.5, zoom - 0.1))}>
                －
              </button>
              <span>{Math.round(zoom * 100)}%</span>
              <button type="button" onClick={() => onZoomChange(Math.min(2, zoom + 0.1))}>
                ＋
              </button>
            </div>
          )}

          <div className="toolbar-file">
            <span className="filename">{state.name}</span>
            <span className="muted">{KIND_LABEL[state.kind]}</span>
            {state.readOnly && <span className="badge">읽기 전용</span>}
          </div>

          <button type="button" className="ghost" title="단축키 (F1)" onClick={onShowHelp}>
            단축키
          </button>
          <button type="button" className="ghost" onClick={session.close}>
            닫기
          </button>
        </>
      )}

      {!state && (
        <button type="button" className="ghost" style={{ marginLeft: 'auto' }} onClick={onShowHelp}>
          단축키 (F1)
        </button>
      )}

      {!fileSystemAccess && (
        <span className="muted hint">
          이 브라우저는 제자리 저장을 지원하지 않아 저장 시 내려받기로 처리됩니다. 크롬이나
          엣지에서 쓰면 파일에 바로 덮어쓸 수 있습니다.
        </span>
      )}
    </header>
  );
}
