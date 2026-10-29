import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/**
 * 눌러서 여는 메뉴.
 *
 * 처음에는 CSS :hover 로 열었는데, 마우스가 버튼에서 메뉴로 넘어가는 사이
 * 잠깐 벗어나면 닫혀 버린다. 손이 조금만 흔들려도 메뉴가 사라지고, 터치
 * 화면에서는 아예 열 수가 없다. 눌러서 여는 쪽이 모든 입력 방식에서 맞다.
 */
export interface MenuProps {
  label: ReactNode;
  title?: string;
  /** 버튼을 눌린 상태로 보이게 한다 (예: 커서가 표 안에 있을 때). */
  active?: boolean;
  wide?: boolean;
  children: (close: () => void) => ReactNode;
}

export function Menu({ label, title, active, wide, children }: MenuProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        title={title}
        className={active ? 'on' : undefined}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>
      {open && (
        <div className={`menu-items${wide ? ' menu-items-wide' : ''}`} id={id} role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
