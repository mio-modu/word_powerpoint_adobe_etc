/**
 * 아직 엔진에 반영되지 않은 편집을 강제로 밀어 넣는 장치.
 *
 * 왜 필요한가: 글자 입력은 매 타자마다 반영하지 않는다. 반영하면 문서를
 * 통째로 다시 그리게 되고 캐럿이 튄다. 그래서 포커스를 잃을 때 한 번에
 * 반영한다 — 평소에는 맞는 선택이다.
 *
 * 그런데 Ctrl+S 는 포커스를 옮기지 않는다. 글을 치던 중에 그대로 누르면
 * 방금 친 글자가 빠진 채로 저장된다. 조용히 사라지는 종류의 버그라
 * 더 나쁘다.
 *
 * 그래서 지금 편집 중인 칸이 자기 반영 함수를 여기 걸어 두고, 명령을
 * 실행하기 전에 한 번 밀어 넣는다. 포커스는 건드리지 않으므로 글을 치던
 * 자리에서 그대로 이어 쓸 수 있다.
 */

let pending: (() => void) | undefined;

/** 편집 중인 칸이 자기 반영 함수를 건다. 떠날 때는 undefined 로 푼다. */
export function registerPendingEdit(commit: (() => void) | undefined): void {
  pending = commit;
}

/** 걸려 있는 반영 함수를 푼다 — 자기 것일 때만. 늦게 온 해제가 남의 것을 지우지 않게. */
export function clearPendingEdit(commit: () => void): void {
  if (pending === commit) pending = undefined;
}

/** 걸려 있는 편집을 지금 반영한다. 없으면 아무 일도 하지 않는다. */
export function flushPendingEdit(): void {
  pending?.();
}
