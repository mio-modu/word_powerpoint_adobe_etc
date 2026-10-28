import { useCallback, useEffect, useState, type DragEvent } from 'react';
import { SlideDeckView } from './components/SlideDeckView.js';
import { TextDocumentView } from './components/TextDocumentView.js';
import { Toolbar } from './components/Toolbar.js';
import { supportsFileSystemAccess } from './lib/fs.js';
import { useSession } from './session.js';

export function App(): JSX.Element {
  const session = useSession();
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const fileSystemAccess = supportsFileSystemAccess();

  // Ctrl+S 로 저장. 브라우저의 "페이지 저장"을 가로챈다.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void session.save();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        void session.open();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [session]);

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
      />

      {session.error && (
        <div className="banner banner-error">
          <pre>{session.error}</pre>
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

      <main className="stage">
        {!state && <WelcomeScreen onOpen={() => void session.open()} session={session} />}

        {state && presentation && (
          <SlideDeckView
            deck={presentation}
            readOnly={state.readOnly}
            onShapeChange={session.setShapeText}
            onAddSlide={session.addSlide}
            onRemoveSlide={session.removeSlide}
          />
        )}

        {state && textDocument && (
          <TextDocumentView
            document={textDocument}
            readOnly={state.readOnly}
            zoom={zoom}
            onParagraphChange={session.setParagraphText}
            onParagraphSplit={(source) => session.addParagraph(source, '')}
            onParagraphRemove={session.removeParagraph}
          />
        )}
      </main>

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

      <p className="muted">창으로 파일을 끌어다 놓아도 열립니다.</p>

      <ul className="facts">
        <li>
          <strong>파일이 기기를 떠나지 않습니다.</strong> 모든 처리가 브라우저 안에서 끝납니다.
          서버로 올리는 과정이 없습니다.
        </li>
        <li>
          <strong>원본을 망가뜨리지 않습니다.</strong> 표·이미지·테마처럼 아직 편집 기능이 없는
          부분은 원본 그대로 두고, 고친 곳만 다시 씁니다.
        </li>
        <li>
          <strong>구형 <code>.hwp</code> 는 읽기 전용입니다.</strong> 열어서 <code>.hwpx</code> 나{' '}
          <code>.docx</code> 로 바꾼 뒤 편집하세요.
        </li>
      </ul>
    </section>
  );
}
