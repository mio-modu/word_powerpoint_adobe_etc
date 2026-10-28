/**
 * 단축키.
 *
 * 워드와 한글의 키를 **동시에** 받는다. 두 프로그램의 관례가 다른데
 * (정렬이 워드는 Ctrl+E, 한글은 Ctrl+Shift+C) 둘 다 걸어두면 어느 쪽에서
 * 오든 손에 익은 키가 그대로 먹는다. 충돌하는 조합은 없다.
 *
 * 브라우저가 먼저 가로채는 키는 웹페이지가 막을 수 없다. Ctrl+N(새 창),
 * Ctrl+T(새 탭), Ctrl+W(탭 닫기), Ctrl+Shift+T(닫은 탭 복원)가 그렇다.
 * 한글의 표 만들기 Ctrl+N,T 가 여기 걸려서 대체 키를 뒀다. 데스크톱 앱으로
 * 감싸면 이 제약이 사라지므로 그때 원래 키를 되돌리면 된다.
 */

export type CommandId =
  | 'open'
  | 'save'
  | 'saveAsHwpx'
  | 'saveAsDocx'
  | 'saveAsPptx'
  | 'newHwpx'
  | 'newDocx'
  | 'newPptx'
  | 'undo'
  | 'redo'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'superscript'
  | 'subscript'
  | 'fontSizeUp'
  | 'fontSizeDown'
  | 'alignLeft'
  | 'alignCenter'
  | 'alignRight'
  | 'alignJustify'
  | 'indent'
  | 'outdent'
  | 'insertTable'
  | 'rowBelow'
  | 'rowAbove'
  | 'deleteRow'
  | 'columnRight'
  | 'columnLeft'
  | 'deleteColumn'
  | 'deleteTable'
  | 'addSlide'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'
  | 'help';

export interface KeyBinding {
  command: CommandId;
  /** `ctrl+shift+c`, 또는 연속 키 `ctrl+alt+n t`. */
  key: string;
  /** 어느 프로그램의 관례인지. 도움말에서 보여준다. */
  origin: '워드' | '한글' | '공통' | '자모' | '파워포인트';
  /** 브라우저가 가로채 쓸 수 없어 대체한 경우, 원래 키. */
  replaces?: string;
}

export interface CommandInfo {
  id: CommandId;
  label: string;
  group: string;
  /** 문서 종류에 따라 쓸 수 없으면 알려준다. */
  slidesOnly?: boolean;
  textOnly?: boolean;
}

export const COMMANDS: CommandInfo[] = [
  { id: 'open', label: '파일 열기', group: '파일' },
  { id: 'save', label: '저장', group: '파일' },
  { id: 'saveAsHwpx', label: '한글 .hwpx 로 내보내기', group: '파일' },
  { id: 'saveAsDocx', label: '워드 .docx 로 내보내기', group: '파일' },
  { id: 'saveAsPptx', label: '파워포인트 .pptx 로 내보내기', group: '파일' },
  { id: 'newHwpx', label: '새 한글 문서', group: '파일' },
  { id: 'newDocx', label: '새 워드 문서', group: '파일' },
  { id: 'newPptx', label: '새 파워포인트', group: '파일' },

  { id: 'undo', label: '되돌리기', group: '편집' },
  { id: 'redo', label: '다시 실행', group: '편집' },

  { id: 'bold', label: '진하게', group: '글자' },
  { id: 'italic', label: '기울임', group: '글자' },
  { id: 'underline', label: '밑줄', group: '글자' },
  { id: 'strike', label: '취소선', group: '글자' },
  { id: 'superscript', label: '위 첨자', group: '글자' },
  { id: 'subscript', label: '아래 첨자', group: '글자' },
  { id: 'fontSizeUp', label: '글자 크게', group: '글자' },
  { id: 'fontSizeDown', label: '글자 작게', group: '글자' },

  { id: 'alignLeft', label: '왼쪽 정렬', group: '문단', textOnly: true },
  { id: 'alignCenter', label: '가운데 정렬', group: '문단', textOnly: true },
  { id: 'alignRight', label: '오른쪽 정렬', group: '문단', textOnly: true },
  { id: 'alignJustify', label: '양쪽 정렬', group: '문단', textOnly: true },
  { id: 'indent', label: '들여쓰기', group: '문단', textOnly: true },
  { id: 'outdent', label: '내어쓰기', group: '문단', textOnly: true },

  { id: 'insertTable', label: '표 만들기', group: '표', textOnly: true },
  { id: 'rowBelow', label: '아래에 줄 추가', group: '표', textOnly: true },
  { id: 'rowAbove', label: '위에 줄 추가', group: '표', textOnly: true },
  { id: 'deleteRow', label: '줄 지우기', group: '표', textOnly: true },
  { id: 'columnRight', label: '오른쪽에 칸 추가', group: '표', textOnly: true },
  { id: 'columnLeft', label: '왼쪽에 칸 추가', group: '표', textOnly: true },
  { id: 'deleteColumn', label: '칸 지우기', group: '표', textOnly: true },
  { id: 'deleteTable', label: '표 지우기', group: '표', textOnly: true },

  { id: 'addSlide', label: '슬라이드 추가', group: '슬라이드', slidesOnly: true },

  { id: 'zoomIn', label: '확대', group: '보기' },
  { id: 'zoomOut', label: '축소', group: '보기' },
  { id: 'zoomReset', label: '100%', group: '보기' },
  { id: 'help', label: '단축키 보기', group: '보기' },
];

export const BINDINGS: KeyBinding[] = [
  { command: 'open', key: 'ctrl+o', origin: '공통' },
  { command: 'save', key: 'ctrl+s', origin: '공통' },
  { command: 'save', key: 'alt+s', origin: '한글' },

  { command: 'undo', key: 'ctrl+z', origin: '공통' },
  { command: 'redo', key: 'ctrl+y', origin: '워드' },
  { command: 'redo', key: 'ctrl+shift+z', origin: '한글' },

  { command: 'bold', key: 'ctrl+b', origin: '공통' },
  { command: 'italic', key: 'ctrl+i', origin: '공통' },
  { command: 'underline', key: 'ctrl+u', origin: '공통' },
  { command: 'strike', key: 'ctrl+shift+s', origin: '자모' },
  { command: 'superscript', key: 'alt+shift+=', origin: '한글' },
  { command: 'subscript', key: 'alt+shift+-', origin: '한글' },
  { command: 'fontSizeUp', key: 'ctrl+]', origin: '한글' },
  { command: 'fontSizeUp', key: 'ctrl+shift+.', origin: '워드' },
  { command: 'fontSizeDown', key: 'ctrl+[', origin: '한글' },
  { command: 'fontSizeDown', key: 'ctrl+shift+,', origin: '워드' },

  { command: 'alignLeft', key: 'ctrl+l', origin: '워드' },
  { command: 'alignLeft', key: 'ctrl+shift+l', origin: '한글' },
  { command: 'alignCenter', key: 'ctrl+e', origin: '워드' },
  { command: 'alignCenter', key: 'ctrl+shift+c', origin: '한글' },
  { command: 'alignRight', key: 'ctrl+r', origin: '워드' },
  { command: 'alignRight', key: 'ctrl+shift+r', origin: '한글' },
  { command: 'alignJustify', key: 'ctrl+j', origin: '워드' },
  { command: 'alignJustify', key: 'ctrl+shift+m', origin: '한글' },
  { command: 'indent', key: 'ctrl+alt+]', origin: '자모' },
  { command: 'outdent', key: 'ctrl+alt+[', origin: '자모' },

  // 한글의 Ctrl+N,T 는 Ctrl+N 을 브라우저가 먼저 가져가 쓸 수 없다.
  { command: 'insertTable', key: 'ctrl+alt+t', origin: '한글', replaces: 'ctrl+n t' },
  { command: 'rowBelow', key: 'ctrl+alt+down', origin: '자모' },
  { command: 'rowAbove', key: 'ctrl+alt+up', origin: '자모' },
  { command: 'columnRight', key: 'ctrl+alt+right', origin: '자모' },
  { command: 'columnLeft', key: 'ctrl+alt+left', origin: '자모' },
  { command: 'deleteRow', key: 'ctrl+alt+shift+down', origin: '자모' },
  { command: 'deleteColumn', key: 'ctrl+alt+shift+right', origin: '자모' },

  { command: 'addSlide', key: 'ctrl+m', origin: '파워포인트' },

  { command: 'zoomIn', key: 'ctrl+=', origin: '공통' },
  { command: 'zoomOut', key: 'ctrl+-', origin: '공통' },
  { command: 'zoomReset', key: 'ctrl+0', origin: '공통' },
  { command: 'help', key: 'f1', origin: '공통' },
  { command: 'help', key: 'ctrl+/', origin: '자모' },
];

/**
 * 브라우저가 가로채 쓸 수 없는 조합. 도움말에서 솔직히 알린다.
 * 데스크톱 앱으로 감싸면 전부 쓸 수 있게 된다.
 */
export const BROWSER_RESERVED: Array<{ key: string; what: string; hwp?: string }> = [
  { key: 'Ctrl+N', what: '새 창', hwp: '한글의 새 문서 / 표 만들기(Ctrl+N,T) 앞자리' },
  { key: 'Ctrl+T', what: '새 탭' },
  { key: 'Ctrl+W', what: '탭 닫기', hwp: '한글의 문서 닫기' },
  { key: 'Ctrl+Shift+T', what: '닫은 탭 복원' },
  { key: 'Ctrl+Shift+N', what: '시크릿 창' },
];

const SPECIAL_KEYS: Record<string, string> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Escape: 'esc',
  Enter: 'enter',
  ' ': 'space',
  Tab: 'tab',
  Delete: 'delete',
  Backspace: 'backspace',
};

/** 키 이벤트를 `ctrl+shift+b` 같은 문자열로 정규화한다. */
export function keyOf(event: KeyboardEvent): string {
  const parts: string[] = [];
  // 맥의 Cmd 는 Ctrl 과 같은 자리로 본다.
  if (event.ctrlKey || event.metaKey) parts.push('ctrl');
  if (event.altKey) parts.push('alt');
  if (event.shiftKey) parts.push('shift');

  const raw = event.key;
  let name = SPECIAL_KEYS[raw];
  if (!name) {
    if (/^F\d{1,2}$/.test(raw)) name = raw.toLowerCase();
    // 한글 입력 상태에서는 event.key 가 한글 자모로 온다. 그래도 물리 키
    // 위치는 event.code 에 남아 있어서, 영문 자판 기준으로 되돌릴 수 있다.
    else if (raw.length === 1) name = raw.toLowerCase();
    else if (event.code.startsWith('Key')) name = event.code.slice(3).toLowerCase();
    else return '';
  }
  if (name.length === 1 && /[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(name) && event.code.startsWith('Key')) {
    name = event.code.slice(3).toLowerCase();
  }
  parts.push(name);
  return parts.join('+');
}

export interface MatchResult {
  command?: CommandId;
  /** 연속 키의 앞부분을 눌렀을 때. 다음 키를 기다린다. */
  pending?: string;
}

/** 눌린 키(와 대기 중인 앞 키)로 명령을 찾는다. */
export function matchBinding(key: string, pending: string | undefined): MatchResult {
  if (key === '') return {};
  const full = pending ? `${pending} ${key}` : key;

  const exact = BINDINGS.find((b) => b.key === full);
  if (exact) return { command: exact.command };

  // 연속 키의 앞부분인가?
  if (!pending && BINDINGS.some((b) => b.key.startsWith(`${key} `))) {
    return { pending: key };
  }
  return {};
}

/** 사람이 읽는 표기. `ctrl+shift+c` → `Ctrl+Shift+C` */
export function formatKey(key: string): string {
  return key
    .split(' ')
    .map((chord) =>
      chord
        .split('+')
        .map((part) => {
          if (part === 'ctrl') return 'Ctrl';
          if (part === 'alt') return 'Alt';
          if (part === 'shift') return 'Shift';
          if (part === 'up') return '↑';
          if (part === 'down') return '↓';
          if (part === 'left') return '←';
          if (part === 'right') return '→';
          if (/^f\d{1,2}$/.test(part)) return part.toUpperCase();
          return part.length === 1 ? part.toUpperCase() : part;
        })
        .join('+'),
    )
    .join(' , ');
}

/** 명령별 단축키 목록 (도움말용). */
export function keysFor(command: CommandId): KeyBinding[] {
  return BINDINGS.filter((b) => b.command === command);
}
