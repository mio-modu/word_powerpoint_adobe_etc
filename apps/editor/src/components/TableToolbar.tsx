import { selectionRect, type SessionApi } from '../session.js';

/**
 * 표 도구막대.
 *
 * 커서가 표 안에 있을 때만 나타난다. 표를 쓰지 않을 때 화면을 차지하지 않고,
 * 쓸 때는 메뉴를 뒤질 필요가 없다. 한글·워드의 "표 레이아웃" 탭과 같은 자리다.
 */
const CELL_COLORS: Array<{ value: string | undefined; label: string }> = [
  { value: undefined, label: '없음' },
  { value: '#FFF2CC', label: '연노랑' },
  { value: '#DDEBF7', label: '연파랑' },
  { value: '#E2EFDA', label: '연초록' },
  { value: '#FCE4D6', label: '연주황' },
  { value: '#EDEDED', label: '회색' },
];

export function TableToolbar({ session }: { session: SessionApi }): JSX.Element | null {
  const { focus } = session;
  if (!focus.table) return null;

  const rect = selectionRect(focus);
  const multiple = rect !== undefined && (rect.top !== rect.bottom || rect.left !== rect.right);
  const cellCount = rect ? (rect.bottom - rect.top + 1) * (rect.right - rect.left + 1) : 0;

  return (
    <div className="tabletoolbar" role="toolbar" aria-label="표">
      <span className="tabletoolbar-title">
        표
        {multiple && <span className="muted"> · {cellCount}칸 선택</span>}
      </span>

      <div className="toolbar-group">
        <button type="button" title="위에 줄 추가 (Ctrl+Alt+↑)" onClick={() => session.tableCommand('rowAbove')}>
          줄↑
        </button>
        <button type="button" title="아래에 줄 추가 (Ctrl+Alt+↓)" onClick={() => session.tableCommand('rowBelow')}>
          줄↓
        </button>
        <button type="button" title="왼쪽에 칸 추가 (Ctrl+Alt+←)" onClick={() => session.tableCommand('columnLeft')}>
          칸←
        </button>
        <button type="button" title="오른쪽에 칸 추가 (Ctrl+Alt+→)" onClick={() => session.tableCommand('columnRight')}>
          칸→
        </button>
      </div>

      <div className="toolbar-group">
        <button type="button" title="이 줄 지우기" onClick={() => session.tableCommand('deleteRow')}>
          줄 삭제
        </button>
        <button type="button" title="이 칸 지우기" onClick={() => session.tableCommand('deleteColumn')}>
          칸 삭제
        </button>
      </div>

      <div className="toolbar-group">
        <button
          type="button"
          disabled={!multiple}
          title={multiple ? '선택한 칸을 하나로 합칩니다' : '두 칸 이상 고르면 합칠 수 있습니다 (Shift+클릭)'}
          onClick={session.mergeCells}
        >
          셀 합치기
        </button>
        <button type="button" title="합친 셀을 되돌립니다" onClick={session.splitCell}>
          셀 나누기
        </button>
      </div>

      <div className="toolbar-group">
        <span className="muted small">칸 색</span>
        {CELL_COLORS.map((color) => (
          <button
            key={color.label}
            type="button"
            className={`swatch${color.value ? '' : ' swatch-none'}`}
            title={`칸 배경 ${color.label}`}
            style={color.value ? { background: color.value } : undefined}
            onClick={() => session.setCellShade(color.value)}
          />
        ))}
      </div>

      <button
        type="button"
        className="ghost"
        title="표 전체를 지웁니다"
        onClick={() => session.tableCommand('deleteTable')}
      >
        표 삭제
      </button>
    </div>
  );
}
