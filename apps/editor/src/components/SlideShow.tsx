import { hwpunit, type JamoPresentation } from '@jamo/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SlideCanvas } from './SlideDeckView.js';

/**
 * 발표 모드 — 전체화면 슬라이드 쇼.
 *
 * 편집 화면과 **같은 그리기 경로**(SlideCanvas)를 쓴다. 발표용으로 따로
 * 그리면 "편집할 때는 맞았는데 발표하니 다르게 나오는" 일이 생기는데,
 * 그건 발표 도중에야 알게 되므로 가장 나쁜 종류의 차이다.
 *
 * 화면을 꽉 채우되 비율은 지킨다. 남는 자리는 검게 둔다 — 늘려서 채우면
 * 글자가 찌그러진다.
 */

export interface SlideShowProps {
  deck: JamoPresentation;
  from: number;
  imageUrl: (part: string) => string | undefined;
  onClose: () => void;
}

/** 화면 크기에 맞춰 슬라이드 폭(px)을 구한다. 비율을 지키며 꽉 채운다. */
function fitWidth(
  deck: JamoPresentation,
  boxWidth: number,
  boxHeight: number,
): number {
  const slideWidth = hwpunit.toPx(deck.slideSize.width);
  const slideHeight = hwpunit.toPx(deck.slideSize.height);
  const aspect = slideWidth / slideHeight;
  return Math.min(boxWidth, boxHeight * aspect);
}

function useViewport(): { width: number; height: number } {
  const [size, setSize] = useState(() => ({
    width: typeof window === 'undefined' ? 1280 : window.innerWidth,
    height: typeof window === 'undefined' ? 720 : window.innerHeight,
  }));
  useEffect(() => {
    const onResize = (): void =>
      setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
}

function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function SlideShow({ deck, from, imageUrl, onClose }: SlideShowProps): JSX.Element {
  const count = deck.slides.length;
  const [index, setIndex] = useState(() => Math.min(Math.max(from, 0), Math.max(count - 1, 0)));
  const [blank, setBlank] = useState<'none' | 'black' | 'white'>('none');
  const [presenter, setPresenter] = useState(false);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [hint, setHint] = useState(true);
  const viewport = useViewport();
  const closedRef = useRef(false);

  const go = useCallback(
    (delta: number) => {
      setBlank('none');
      setIndex((i) => Math.min(Math.max(i + delta, 0), Math.max(count - 1, 0)));
    },
    [count],
  );

  const close = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    onClose();
  }, [onClose]);

  // 전체화면으로 들어간다. F5 키 입력이 사용자 제스처라 허용된다.
  // 거부당해도(권한·브라우저 설정) 발표 자체는 되게 둔다 — 창 안에서
  // 꽉 찬 화면으로 보인다.
  useEffect(() => {
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
    return () => {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);

  // 사용자가 브라우저 쪽에서 전체화면을 빠져나가면 발표도 끝낸다.
  // 전체화면이 아닌 채로 발표 화면만 덮여 있으면 빠져나갈 길이 헷갈린다.
  useEffect(() => {
    const onChange = (): void => {
      if (!document.fullscreenElement) close();
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [close]);

  // 경과 시간. 발표자 보기에서만 쓰지만, 중간에 켜도 시작 시각이 맞아야
  // 하므로 계속 센다.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);

  // 안내는 잠깐만 보여 준다.
  useEffect(() => {
    const timer = setTimeout(() => setHint(false), 4000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.isComposing) return;
      const key = event.key;
      const handled = (): void => {
        event.preventDefault();
        event.stopPropagation();
      };

      switch (key) {
        case 'Escape':
          handled();
          close();
          return;
        case 'ArrowRight':
        case 'ArrowDown':
        case 'PageDown':
        case ' ':
        case 'Enter':
          handled();
          go(1);
          return;
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'PageUp':
        case 'Backspace':
          handled();
          go(-1);
          return;
        case 'Home':
          handled();
          setIndex(0);
          return;
        case 'End':
          handled();
          setIndex(Math.max(count - 1, 0));
          return;
      }

      // 글쇠 하나짜리 명령. 한글 자판에서도 듣도록 event.code 를 본다.
      const code = event.code;
      if (code === 'KeyB') {
        handled();
        setBlank((b) => (b === 'black' ? 'none' : 'black'));
      } else if (code === 'KeyW') {
        handled();
        setBlank((b) => (b === 'white' ? 'none' : 'white'));
      } else if (code === 'KeyS') {
        handled();
        setPresenter((p) => !p);
      } else if (code === 'KeyR') {
        handled();
        setStartedAt(Date.now());
      }
    };

    // 캡처 단계에서 받는다. 편집 화면의 단축키가 끼어들지 못하게.
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [close, go, count]);

  const slide = deck.slides[index];
  const next = deck.slides[index + 1];
  const notes = slide?.notes;

  if (!slide) {
    return (
      <div className="show show-empty" role="dialog" aria-label="발표 모드">
        <p>슬라이드가 없습니다.</p>
        <button type="button" onClick={close}>
          나가기 (Esc)
        </button>
      </div>
    );
  }

  if (blank !== 'none') {
    return (
      <div
        className="show"
        style={{ background: blank === 'black' ? '#000' : '#fff' }}
        onClick={() => setBlank('none')}
        role="dialog"
        aria-label="화면 가림"
      />
    );
  }

  if (presenter) {
    // 왼쪽에 지금 장, 오른쪽에 다음 장과 메모.
    const mainWidth = fitWidth(deck, viewport.width * 0.62 - 48, viewport.height - 110);
    const nextWidth = fitWidth(deck, viewport.width * 0.34 - 48, viewport.height * 0.3);
    return (
      <div className="show show-presenter" role="dialog" aria-label="발표자 보기">
        <header className="presenter-bar">
          <span className="presenter-clock">{clock(now - startedAt)}</span>
          <span className="presenter-count">
            {index + 1} / {count}
          </span>
          <span className="presenter-keys muted">
            S 발표자 보기 끄기 · R 시간 초기화 · Esc 끝내기
          </span>
        </header>
        <div className="presenter-body">
          <section className="presenter-main">
            <div onClick={() => go(1)}>
              <SlideCanvas
                slide={slide}
                deck={deck}
                width={mainWidth}
                readOnly
                interactive={false}
                imageUrl={imageUrl}
                slideIndex={index}
              />
            </div>
          </section>
          <aside className="presenter-side">
            <div className="presenter-next">
              <h2>다음 장</h2>
              {next ? (
                <SlideCanvas
                  slide={next}
                  deck={deck}
                  width={nextWidth}
                  readOnly
                  interactive={false}
                  imageUrl={imageUrl}
                  slideIndex={index + 1}
                />
              ) : (
                <p className="muted">마지막 장입니다.</p>
              )}
            </div>
            <div className="presenter-notes">
              <h2>메모</h2>
              {notes ? <pre>{notes}</pre> : <p className="muted">이 장에는 메모가 없습니다.</p>}
            </div>
          </aside>
        </div>
      </div>
    );
  }

  const width = fitWidth(deck, viewport.width, viewport.height);

  return (
    <div
      className="show"
      role="dialog"
      aria-label="발표 모드"
      onClick={(event) => {
        // 가운데를 누르면 다음, 왼쪽 끝을 누르면 이전.
        const x = event.clientX / window.innerWidth;
        go(x < 0.12 ? -1 : 1);
      }}
    >
      <SlideCanvas
        slide={slide}
        deck={deck}
        width={width}
        readOnly
        interactive={false}
        imageUrl={imageUrl}
        slideIndex={index}
      />
      <div className="show-counter">
        {index + 1} / {count}
      </div>
      {hint && (
        <div className="show-hint">
          방향키·클릭 넘기기 · <b>S</b> 발표자 보기 · <b>B</b> 검은 화면 · <b>Esc</b> 끝내기
        </div>
      )}
    </div>
  );
}
