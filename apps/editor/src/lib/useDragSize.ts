import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

/**
 * 경계선을 끌어 크기를 정하는 장치.
 *
 * 메모판 높이와 슬라이드 목록 폭이 같은 조작을 쓴다. 두 번 쓰게 되니
 * 한 군데로 모았다 — 끌기, 키보드, 두 번 눌러 되돌리기, 기억하기까지
 * 한쪽만 고치고 다른 쪽을 빠뜨리는 일이 없도록.
 *
 * 정한 값은 기억한다. 매번 다시 맞추게 하면 쓰다가 그만두게 된다.
 */

function readStored(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    const value = raw === null ? Number.NaN : Number.parseInt(raw, 10);
    return Number.isFinite(value) ? value : fallback;
  } catch {
    // 사생활 보호 모드 등으로 막혀 있으면 기본값으로 시작한다.
    return fallback;
  }
}

function store(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(Math.round(value)));
  } catch {
    // 저장 못 해도 이번 창에서는 동작한다.
  }
}

export interface DragSizeOptions {
  storageKey: string;
  defaultValue: number;
  min: number;
  /** 창 크기에 따라 달라지므로 매번 받는다. */
  max: number;
  /** 'x' 는 좌우로 끄는 경계선, 'y' 는 위아래로 끄는 경계선. */
  axis: 'x' | 'y';
  /** 끄는 방향과 커지는 방향이 반대인 경우. 메모판은 위로 끌면 커진다. */
  reverse?: boolean;
  /** 화살표 한 번에 움직이는 양. Shift 를 누르면 네 배. */
  step?: number;
}

export interface DragSizeResult {
  /** 지금 쓸 크기. 늘 min~max 안이다. */
  size: number;
  reset: () => void;
  /** 경계선 요소에 그대로 펼쳐 넣는다. */
  separatorProps: {
    role: 'separator';
    'aria-orientation': 'horizontal' | 'vertical';
    'aria-valuenow': number;
    tabIndex: 0;
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
    onDoubleClick: () => void;
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  };
}

export function useDragSize({
  storageKey,
  defaultValue,
  min,
  max,
  axis,
  reverse = false,
  step = 12,
}: DragSizeOptions): DragSizeResult {
  const [raw, setRaw] = useState(() => readStored(storageKey, defaultValue));

  // 창이 작아지면 기억해 둔 값이 지금 자리보다 클 수 있다. 그대로 쓰면
  // 반대쪽이 사라지므로 늘 범위 안으로 접어 넣는다.
  const clamp = useCallback(
    (value: number) => Math.min(Math.max(value, min), Math.max(min, max)),
    [min, max],
  );
  const size = clamp(raw);

  const from = useRef<{ at: number; size: number } | undefined>(undefined);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      from.current = { at: axis === 'x' ? event.clientX : event.clientY, size };
    },
    [axis, size],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const start = from.current;
      if (!start) return;
      const now = axis === 'x' ? event.clientX : event.clientY;
      const delta = (now - start.at) * (reverse ? -1 : 1);
      setRaw(clamp(start.size + delta));
    },
    [axis, reverse, clamp],
  );

  const stop = useCallback(() => {
    if (!from.current) return;
    from.current = undefined;
  }, []);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      const amount = event.shiftKey ? step * 4 : step;
      // 커지는 방향의 키가 어느 쪽인지는 축과 방향이 정한다.
      const grow = axis === 'x' ? 'ArrowRight' : reverse ? 'ArrowUp' : 'ArrowDown';
      const shrink = axis === 'x' ? 'ArrowLeft' : reverse ? 'ArrowDown' : 'ArrowUp';
      if (event.key === grow) {
        event.preventDefault();
        setRaw((value) => clamp(clamp(value) + amount));
      } else if (event.key === shrink) {
        event.preventDefault();
        setRaw((value) => clamp(clamp(value) - amount));
      }
    },
    [axis, reverse, step, clamp],
  );

  const reset = useCallback(() => setRaw(clamp(defaultValue)), [clamp, defaultValue]);

  useEffect(() => {
    store(storageKey, size);
  }, [storageKey, size]);

  return {
    size,
    reset,
    separatorProps: {
      role: 'separator',
      'aria-orientation': axis === 'x' ? 'vertical' : 'horizontal',
      'aria-valuenow': Math.round(size),
      tabIndex: 0,
      onPointerDown,
      onPointerMove,
      onPointerUp: stop,
      onPointerCancel: stop,
      onDoubleClick: reset,
      onKeyDown,
    },
  };
}
