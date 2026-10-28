import { useState } from 'react';

/**
 * 표 크기 고르기.
 *
 * 워드·한글이 쓰는 격자 방식이다. "3×3 / 2×2 / 5×3" 같은 고정 항목을
 * 늘어놓는 것보다, 원하는 크기를 눈으로 짚는 쪽이 훨씬 빠르다.
 */
const MAX_ROWS = 8;
const MAX_COLS = 10;

export interface TableGridPickerProps {
  onPick: (rows: number, cols: number) => void;
}

export function TableGridPicker({ onPick }: TableGridPickerProps): JSX.Element {
  const [hover, setHover] = useState<{ row: number; col: number }>({ row: 0, col: 0 });

  return (
    <div className="grid-picker" onMouseLeave={() => setHover({ row: 0, col: 0 })}>
      <div className="grid-picker-label">
        {hover.row > 0 ? `${hover.row} × ${hover.col}` : '크기를 고르세요'}
      </div>
      <div className="grid-picker-grid">
        {Array.from({ length: MAX_ROWS }, (_unused, r) =>
          Array.from({ length: MAX_COLS }, (_unused2, c) => (
            <button
              key={`${r}-${c}`}
              type="button"
              className={`grid-cell${r < hover.row && c < hover.col ? ' grid-cell-on' : ''}`}
              onMouseEnter={() => setHover({ row: r + 1, col: c + 1 })}
              onClick={() => onPick(r + 1, c + 1)}
              aria-label={`${r + 1}줄 ${c + 1}칸`}
            />
          )),
        )}
      </div>
    </div>
  );
}
