import { KIND_LABEL } from '../lib/formats.js';
import type { SessionApi } from '../session.js';
import { Menu } from './Menu.js';
import { TableGridPicker } from './TableGridPicker.js';

export interface ToolbarProps {
  session: SessionApi;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  fileSystemAccess: boolean;
  onShowHelp: () => void;
  /** 브라우저가 설치 가능하다고 알려 왔을 때만 참. 사파리는 늘 거짓이다. */
  canInstall: boolean;
  onInstall: () => void;
  /** 슬라이드일 때만 쓰인다. 처음부터 발표. */
  onPresent: () => void;
  /** 슬라이드 쪽 상태. 장표 아래 줄을 없애고 이리로 올렸다 —
   *  그 줄이 세로를 먹어 장표가 그만큼 작아졌다. */
  slideIndex: number;
  slideCount: number;
  onRemoveSlide: (index: number) => void;
}

export function Toolbar({
  session,
  zoom,
  onZoomChange,
  fileSystemAccess,
  onShowHelp,
  canInstall,
  onInstall,
  onPresent,
  slideIndex,
  slideCount,
  onRemoveSlide,
}: ToolbarProps): JSX.Element {
  const { state } = session;
  const isDeck = state?.kind === 'pptx';
  const inTable = session.focus.table !== undefined;

  return (
    <header className="toolbar">
      <div className="brand">
        <span className="brand-mark">자모</span>
        <span className="brand-sub">오피스</span>
        <span className="brand-build" title="이 판을 만든 시각입니다. 고친 내용이 안 보이면 이 숫자부터 확인하세요.">
          {__BUILD__}
        </span>
      </div>

      <div className="toolbar-group">
        <button type="button" onClick={() => void session.open()} disabled={session.busy}>
          열기
        </button>
        <Menu label="새 문서 ▾">
          {(close) => (
            <>
              <button type="button" onClick={() => { session.createNew('hwpx'); close(); }}>
                한글 문서 (.hwpx)
              </button>
              <button type="button" onClick={() => { session.createNew('docx'); close(); }}>
                워드 문서 (.docx)
              </button>
              <button type="button" onClick={() => { session.createNew('pptx'); close(); }}>
                파워포인트 (.pptx)
              </button>
            </>
          )}
        </Menu>
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
            <Menu label="변환 ▾">
              {(close) => (
                <>
                  <button type="button" onClick={() => { void session.saveAsFormat('hwpx'); close(); }}>
                    한글 .hwpx 로 내보내기
                  </button>
                  <button type="button" onClick={() => { void session.saveAsFormat('docx'); close(); }}>
                    워드 .docx 로 내보내기
                  </button>
                  <button type="button" onClick={() => { void session.saveAsFormat('pptx'); close(); }}>
                    파워포인트 .pptx 로 내보내기
                  </button>
                </>
              )}
            </Menu>
          </div>

          {isDeck && (
            <div className="toolbar-group">
              <button
                type="button"
                className="primary present-button"
                title="처음부터 발표합니다 (F5). 발표 중 S 를 누르면 메모가 보입니다."
                onClick={onPresent}
              >
                ▶ 발표
              </button>
              <span className="slide-counter muted">
                {slideIndex + 1} / {slideCount}
              </span>
              {!state.readOnly && slideCount > 1 && (
                <button
                  type="button"
                  className="ghost"
                  title="지금 보고 있는 슬라이드를 지웁니다"
                  onClick={() => onRemoveSlide(slideIndex)}
                >
                  슬라이드 삭제
                </button>
              )}
            </div>
          )}

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
            <Menu label="표 ▾" title="표 만들기 (Ctrl+Alt+T)" active={inTable} wide>
              {(close) => (
                <>
                  <TableGridPicker
                    onPick={(rows, cols) => {
                      session.insertTable(rows, cols);
                      close();
                    }}
                  />
                  <p className="muted small picker-note">
                    표 안에 커서를 두면 줄·칸 추가와 셀 합치기 도구가 위에 나타납니다.
                  </p>
                </>
              )}
            </Menu>
          )}

          <div className="toolbar-group zoom">
            <button
              type="button"
              title={isDeck ? '슬라이드 줄이기 (Ctrl+-)' : '축소 (Ctrl+-)'}
              onClick={() => onZoomChange(Math.max(0.5, zoom - 0.1))}
            >
              －
            </button>
            {/* 슬라이드에서 100% 는 "화면에 꽉 맞춘 크기"다. 눌러서 되돌릴 수
                있어야 확대해 놓고 길을 잃지 않는다. */}
            <button
              type="button"
              className="zoom-value"
              title={isDeck ? '화면에 맞추기 (Ctrl+0)' : '100% 로 (Ctrl+0)'}
              onClick={() => onZoomChange(1)}
            >
              {isDeck && zoom === 1 ? '맞춤' : `${Math.round(zoom * 100)}%`}
            </button>
            <button
              type="button"
              title={isDeck ? '슬라이드 키우기 (Ctrl+=)' : '확대 (Ctrl+=)'}
              onClick={() => onZoomChange(Math.min(2, zoom + 0.1))}
            >
              ＋
            </button>
          </div>

          <div className="toolbar-file">
            <span className="filename">{state.name}</span>
            <span className="muted">{KIND_LABEL[state.kind]}</span>
            {state.readOnly && <span className="badge">읽기 전용</span>}
          </div>

          <button type="button" className="ghost" title="단축키 (F1)" onClick={onShowHelp}>
            단축키
          </button>
          {canInstall && (
            <button
              type="button"
              className="ghost install-button"
              title="바탕화면에 설치해 전용 창으로 띄웁니다. 인터넷 없이도 열립니다."
              onClick={onInstall}
            >
              앱 설치
            </button>
          )}
          <button type="button" className="ghost" onClick={session.close}>
            닫기
          </button>
        </>
      )}

      {!state && (
        <div className="toolbar-tail">
          {canInstall && (
            <button
              type="button"
              className="ghost install-button"
              title="바탕화면에 설치해 전용 창으로 띄웁니다. 인터넷 없이도 열립니다."
              onClick={onInstall}
            >
              앱 설치
            </button>
          )}
          <button type="button" className="ghost" onClick={onShowHelp}>
            단축키 (F1)
          </button>
        </div>
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
