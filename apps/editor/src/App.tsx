import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { FormatBar } from './components/FormatBar.js';
import { ShortcutHelp } from './components/ShortcutHelp.js';
import { SlideDeckView } from './components/SlideDeckView.js';
import { SlideShow } from './components/SlideShow.js';
import { TextDocumentView } from './components/TextDocumentView.js';
import { TableToolbar } from './components/TableToolbar.js';
import { Toolbar } from './components/Toolbar.js';
import { supportsFileSystemAccess } from './lib/fs.js';
import { flushPendingEdit } from './lib/pendingEdit.js';
import {
  consumeLaunchFiles,
  startupNewDocument,
  useInstallPrompt,
} from './lib/pwa.js';
import { keyOf, matchBinding, yieldToBrowser, type CommandId } from './lib/keymap.js';
import { useSession } from './session.js';

const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;

export function App(): JSX.Element {
  const session = useSession();
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [slideIndex, setSlideIndex] = useState(0);
  const [notesOpen, setNotesOpen] = useState(true);
  // undefined 면 발표 중이 아니다. 숫자면 그 장부터 보여 준다.
  const [presentFrom, setPresentFrom] = useState<number | undefined>(undefined);
  const pendingKey = useRef<string | undefined>(undefined);
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fileSystemAccess = supportsFileSystemAccess();
  const installPrompt = useInstallPrompt();

  const run = useCallback(
    (command: CommandId) => {
      const char = session.currentCharStyle();
      switch (command) {
        case 'open':
          void session.open();
          break;
        case 'save':
          void session.save();
          break;
        case 'saveAsHwpx':
          void session.saveAsFormat('hwpx');
          break;
        case 'saveAsDocx':
          void session.saveAsFormat('docx');
          break;
        case 'saveAsPptx':
          void session.saveAsFormat('pptx');
          break;
        case 'newHwpx':
          session.createNew('hwpx');
          break;
        case 'newDocx':
          session.createNew('docx');
          break;
        case 'newPptx':
          session.createNew('pptx');
          break;
        case 'undo':
          session.undo();
          break;
        case 'redo':
          session.redo();
          break;
        case 'bold':
          session.applyCharStyle({ bold: !char?.bold });
          break;
        case 'italic':
          session.applyCharStyle({ italic: !char?.italic });
          break;
        case 'underline':
          session.applyCharStyle({ underline: !char?.underline });
          break;
        case 'strike':
          session.applyCharStyle({ strikeout: !char?.strikeout });
          break;
        case 'superscript':
          session.applyCharStyle({ superscript: !char?.superscript, subscript: false });
          break;
        case 'subscript':
          session.applyCharStyle({ subscript: !char?.subscript, superscript: false });
          break;
        case 'fontSizeUp':
          session.applyCharStyle({ fontSize: Math.min((char?.fontSize ?? 10) + 1, 300) });
          break;
        case 'fontSizeDown':
          session.applyCharStyle({ fontSize: Math.max((char?.fontSize ?? 10) - 1, 1) });
          break;
        case 'alignLeft':
          session.applyParagraphStyle({ align: 'left' });
          break;
        case 'alignCenter':
          session.applyParagraphStyle({ align: 'center' });
          break;
        case 'alignRight':
          session.applyParagraphStyle({ align: 'right' });
          break;
        case 'alignJustify':
          session.applyParagraphStyle({ align: 'justify' });
          break;
        case 'indent': {
          const current = session.currentParagraphStyle()?.indentLeft ?? 0;
          // 한 칸은 2글자 폭 (10pt 기준 2000 HWPUNIT).
          session.applyParagraphStyle({ indentLeft: current + 2000 });
          break;
        }
        case 'outdent': {
          const current = session.currentParagraphStyle()?.indentLeft ?? 0;
          session.applyParagraphStyle({ indentLeft: Math.max(current - 2000, 0) });
          break;
        }
        case 'insertTable':
          session.insertTable(3, 3);
          break;
        case 'rowBelow':
        case 'rowAbove':
        case 'deleteRow':
        case 'columnRight':
        case 'columnLeft':
        case 'deleteColumn':
        case 'deleteTable':
          session.tableCommand(command);
          break;
        case 'mergeCells':
          session.mergeCells();
          break;
        case 'splitCell':
          session.splitCell();
          break;
        case 'addSlide':
          session.addSlide();
          break;
        case 'present':
          if (session.state?.kind === 'pptx') setPresentFrom(0);
          break;
        case 'presentHere':
          if (session.state?.kind === 'pptx') setPresentFrom(slideIndex);
          break;
        case 'toggleNotes':
          setNotesOpen((open) => !open);
          break;
        case 'zoomIn':
          setZoom((z) => Math.min(z + ZOOM_STEP, ZOOM_MAX));
          break;
        case 'zoomOut':
          setZoom((z) => Math.max(z - ZOOM_STEP, ZOOM_MIN));
          break;
        case 'zoomReset':
          setZoom(1);
          break;
        case 'help':
          setHelpOpen((open) => !open);
          break;
      }
    },
    [session, slideIndex],
  );

  // 탐색기에서 .hwpx 를 더블클릭해 들어온 파일. 앱이 뜨자마자 걸어야
  // 브라우저가 이미 넘긴 실행 정보를 놓치지 않는다.
  const openRef = useRef(session.openFromData);
  openRef.current = session.openFromData;
  useEffect(() => {
    consumeLaunchFiles((file) => openRef.current(file.name, file.data, file.handle));
  }, []);

  // 설치한 앱의 바로가기(`?new=pptx`)로 띄웠을 때.
  const createRef = useRef(session.createNew);
  createRef.current = session.createNew;
  useEffect(() => {
    const kind = startupNewDocument();
    if (kind) createRef.current(kind);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // 발표 중에는 발표 화면이 키를 전부 가져간다.
      if (presentFrom !== undefined) return;
      if (event.key === 'Escape') {
        if (helpOpen) {
          event.preventDefault();
          setHelpOpen(false);
        }
        pendingKey.current = undefined;
        return;
      }
      // 한글 입력 조합 중에는 키를 가로채지 않는다. 가로채면 조합이 깨진다.
      if (event.isComposing) return;

      const key = keyOf(event);

      // 새로고침 키는 글을 치는 중이 아니면 브라우저에 돌려준다.
      // 이걸 막으면 새 판이 나와도 받을 방법이 없다.
      if (yieldToBrowser(key)) {
        pendingKey.current = undefined;
        return;
      }

      const { command, pending } = matchBinding(key, pendingKey.current);

      if (pending) {
        event.preventDefault();
        pendingKey.current = pending;
        clearTimeout(pendingTimer.current);
        // 연속 키의 뒷부분을 한참 안 누르면 없던 일로 한다.
        pendingTimer.current = setTimeout(() => {
          pendingKey.current = undefined;
        }, 2000);
        return;
      }
      pendingKey.current = undefined;
      if (!command) return;

      event.preventDefault();
      // 아직 엔진에 들어가지 않은 글자를 먼저 밀어 넣는다. 이게 없으면
      // 글을 치다가 Ctrl+S 를 눌렀을 때 마지막 몇 글자가 빠진 채 저장된다.
      flushPendingEdit();
      run(command);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [helpOpen, run, presentFrom]);

  // 저장하지 않은 변경이 있으면 떠날 때 물어본다.
  useEffect(() => {
    if (!session.state?.dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [session.state?.dirty]);

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragging(false);
      const file = event.dataTransfer.files[0];
      if (!file) return;
      void file.arrayBuffer().then((buffer) => {
        session.openFromData(file.name, new Uint8Array(buffer));
      });
    },
    [session],
  );

  const { state, textDocument, presentation } = session;

  return (
    <div
      className={`app${dragging ? ' app-dragging' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <Toolbar
        session={session}
        zoom={zoom}
        onZoomChange={setZoom}
        fileSystemAccess={fileSystemAccess}
        onShowHelp={() => setHelpOpen(true)}
        canInstall={installPrompt.canInstall}
        onInstall={installPrompt.install}
        onPresent={() => setPresentFrom(0)}
      />

      {state && !state.readOnly && (
        <FormatBar session={session} disabled={session.busy} isDeck={state.kind === 'pptx'} />
      )}

      {state && !state.readOnly && <TableToolbar session={session} />}

      {session.error && (
        <div className="banner banner-error">
          <pre>{session.error}</pre>
          <button type="button" onClick={session.dismissError}>
            닫기
          </button>
        </div>
      )}

      {state?.readOnly && (
        <div className="banner banner-info">
          <span>
            구형 <code>.hwp</code> 는 읽기만 지원합니다. 바이너리 구조를 다시 써넣다 한 군데라도
            어긋나면 한글이 파일을 거부하기 때문입니다.
          </span>
          <button type="button" onClick={session.convertForEditing}>
            .hwpx 로 변환해서 편집하기
          </button>
        </div>
      )}

      <main className={`stage${presentation ? ' stage-deck' : ''}`}>
        {!state && <WelcomeScreen onOpen={() => void session.open()} session={session} />}

        {state && presentation && (
          <SlideDeckView
            deck={presentation}
            readOnly={state.readOnly}
            onShapeChange={session.setShapeText}
            onShapeFocus={(shape, slideIndex) => session.setFocus({ shape, slideIndex })}
            onAddSlide={session.addSlide}
            onRemoveSlide={session.removeSlide}
            imageUrl={session.imageUrl}
            current={slideIndex}
            onCurrentChange={setSlideIndex}
            onNotesCommit={session.setNotes}
            notesOpen={notesOpen}
            onToggleNotes={() => setNotesOpen((open) => !open)}
            onPresent={setPresentFrom}
          />
        )}

        {state && textDocument && (
          <TextDocumentView
            document={textDocument}
            readOnly={state.readOnly}
            zoom={zoom}
            focus={session.focus}
            onFocus={session.setFocus}
            onParagraphChange={session.setParagraphText}
            onParagraphSplit={(source) => session.addParagraph(source, '')}
            onParagraphRemove={session.removeParagraph}
            onTableAppendRow={session.appendRowToTable}
          />
        )}
      </main>

      {presentFrom !== undefined && presentation && (
        <SlideShow
          deck={presentation}
          from={presentFrom}
          imageUrl={session.imageUrl}
          onClose={() => setPresentFrom(undefined)}
        />
      )}

      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
      {dragging && <div className="drop-overlay">여기에 놓으면 열립니다</div>}
    </div>
  );
}

function WelcomeScreen({
  onOpen,
  session,
}: {
  onOpen: () => void;
  session: ReturnType<typeof useSession>;
}): JSX.Element {
  return (
    <section className="welcome">
      <h1>한글·워드·파워포인트를 브라우저에서</h1>
      <p className="lede">
        <code>.hwp</code> <code>.hwpx</code> <code>.docx</code> <code>.pptx</code> 를 열고 고쳐
        같은 형식으로 저장합니다. 서로 다른 형식으로 바꿔 내보낼 수도 있습니다.
      </p>

      <div className="welcome-actions">
        <button type="button" className="primary" onClick={onOpen}>
          파일 열기
        </button>
        <button type="button" onClick={() => session.createNew('hwpx')}>
          새 한글 문서
        </button>
        <button type="button" onClick={() => session.createNew('docx')}>
          새 워드 문서
        </button>
        <button type="button" onClick={() => session.createNew('pptx')}>
          새 파워포인트
        </button>
      </div>

      <p className="muted">창으로 파일을 끌어다 놓아도 열립니다. 단축키는 F1.</p>

      <ul className="facts">
        <li>
          <strong>파일이 기기를 떠나지 않습니다.</strong> 모든 처리가 브라우저 안에서 끝납니다.
          서버로 올리는 과정이 없습니다.
        </li>
        <li>
          <strong>원본을 망가뜨리지 않습니다.</strong> 이미지·차트·테마처럼 아직 편집 기능이 없는
          부분은 원본 그대로 두고, 고친 곳만 다시 씁니다.
        </li>
        <li>
          <strong>워드 키와 한글 키를 둘 다 받습니다.</strong> 가운데 정렬이 워드는 Ctrl+E,
          한글은 Ctrl+Shift+C 인데 둘 다 동작합니다.
        </li>
      </ul>
    </section>
  );
}
