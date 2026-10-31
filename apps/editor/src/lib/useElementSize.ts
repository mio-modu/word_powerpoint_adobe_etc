import { useLayoutEffect, useRef, useState } from 'react';

/**
 * 요소의 실제 크기를 재서 알려준다.
 *
 * 슬라이드를 고정 폭으로 그리면 노트북 화면에서 아래가 잘린다. 메모판처럼
 * 슬라이드 밑에 있어야 하는 것이 화면 밖으로 밀려나 "없는 것"이 된다.
 * 그래서 남은 자리를 재서 그 안에 들어가게 그린다.
 *
 * 창 크기뿐 아니라 메모판을 접고 펴는 것, 도구막대 줄이 늘어나는 것까지
 * 크기를 바꾸므로 resize 이벤트만으로는 모자라고 ResizeObserver 가 필요하다.
 */
export interface Size {
  width: number;
  height: number;
}

export function useElementSize<T extends HTMLElement>(): [
  React.RefObject<T>,
  Size,
] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = (): void => {
      const next = { width: el.clientWidth, height: el.clientHeight };
      // 같은 값으로 다시 그리면 ResizeObserver 가 또 울려 끝없이 돈다.
      setSize((prev) =>
        prev.width === next.width && prev.height === next.height ? prev : next,
      );
    };

    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, size];
}
