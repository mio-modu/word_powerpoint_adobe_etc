import { describe, expect, it } from 'vitest';
import { BINDINGS, COMMANDS } from '../src/lib/keymap.js';

describe('단축키 표', () => {
  it('같은 키에 두 명령을 걸지 않는다', () => {
    // 겹치면 둘 중 하나는 영영 안 먹는데, 쓰는 쪽에서는 "가끔 안 된다" 로만
    // 보인다. 실제로 Ctrl+Shift+S 를 취소선과 다른 이름으로 저장이 함께
    // 쓰다가 여기서 걸렸다.
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const binding of BINDINGS) {
      const already = seen.get(binding.key);
      if (already !== undefined && already !== binding.command) {
        clashes.push(`${binding.key}: ${already} ↔ ${binding.command}`);
      }
      seen.set(binding.key, binding.command);
    }
    expect(clashes).toEqual([]);
  });

  it('모든 바인딩이 아는 명령을 가리킨다', () => {
    const known = new Set<string>(COMMANDS.map((c) => c.id));
    const unknown = BINDINGS.filter((b) => !known.has(b.command)).map((b) => `${b.command} (${b.key})`);
    expect(unknown).toEqual([]);
  });

  it('키 없는 명령은 메뉴로만 쓰기로 한 것들뿐이다', () => {
    // 일부러 키를 두지 않은 것들이다. 새 문서 종류와 내보낼 형식은 메뉴에서
    // 고르는 편이 낫고, 표 지우기는 실수로 눌리면 곤란하다.
    // 목록을 여기 적어 두는 이유: 다른 명령이 키를 잃으면 바로 걸리게 하려고.
    const MENU_ONLY = [
      'saveAsHwpx',
      'saveAsDocx',
      'saveAsPptx',
      'newHwpx',
      'newDocx',
      'newPptx',
      'deleteTable',
    ];
    const bound = new Set<string>(BINDINGS.map((b) => b.command));
    const unbound = COMMANDS.filter((c) => !bound.has(c.id)).map((c) => c.id);
    expect(unbound.sort()).toEqual([...MENU_ONLY].sort());
  });

  it('저장과 다른 이름으로 저장에 익숙한 키가 걸려 있다', () => {
    const keysOf = (command: string): string[] =>
      BINDINGS.filter((b) => b.command === command).map((b) => b.key);
    expect(keysOf('save')).toContain('ctrl+s');
    expect(keysOf('saveCopyAs')).toContain('ctrl+shift+s');
  });
});
