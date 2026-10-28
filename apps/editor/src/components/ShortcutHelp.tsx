import { BINDINGS, BROWSER_RESERVED, COMMANDS, formatKey } from '../lib/keymap.js';

/**
 * 단축키 목록.
 *
 * 브라우저가 가져가는 키를 숨기지 않고 그대로 적는다. 눌렀는데 아무 일도
 * 안 일어나는 것보다, 왜 안 되는지 알려주는 편이 낫다.
 */
export function ShortcutHelp({ onClose }: { onClose: () => void }): JSX.Element {
  const groups = [...new Set(COMMANDS.map((c) => c.group))];

  return (
    <div className="overlay" role="dialog" aria-label="단축키" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <h2>단축키</h2>
          <p className="muted">
            워드와 한글의 키를 둘 다 받습니다. 어느 쪽에서 오셨든 손에 익은 키가 그대로 먹습니다.
          </p>
          <button type="button" className="ghost" onClick={onClose}>
            닫기 (Esc)
          </button>
        </header>

        <div className="sheet-body">
          {groups.map((group) => {
            const commands = COMMANDS.filter((c) => c.group === group);
            return (
              <section key={group} className="key-group">
                <h3>{group}</h3>
                <table className="key-table">
                  <tbody>
                    {commands.map((command) => {
                      const keys = BINDINGS.filter((b) => b.command === command.id);
                      if (keys.length === 0) return null;
                      return (
                        <tr key={command.id}>
                          <th>{command.label}</th>
                          <td>
                            {keys.map((binding, i) => (
                              <span key={i} className="key-entry">
                                <kbd>{formatKey(binding.key)}</kbd>
                                <span className="key-origin">{binding.origin}</span>
                                {binding.replaces && (
                                  <span
                                    className="key-note"
                                    title={`한글의 ${formatKey(binding.replaces)} 는 브라우저가 가져가서 쓸 수 없습니다`}
                                  >
                                    원래 {formatKey(binding.replaces)}
                                  </span>
                                )}
                              </span>
                            ))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>
            );
          })}

          <section className="key-group">
            <h3>브라우저가 가져가는 키</h3>
            <p className="muted small">
              아래 조합은 브라우저가 먼저 처리해서 웹페이지가 막을 수 없습니다. 데스크톱 앱으로
              감싸면 이 제약이 사라집니다.
            </p>
            <table className="key-table">
              <tbody>
                {BROWSER_RESERVED.map((item) => (
                  <tr key={item.key}>
                    <th>
                      <kbd>{item.key}</kbd>
                    </th>
                    <td className="muted">
                      브라우저의 {item.what}
                      {item.hwp && ` — ${item.hwp}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </div>
  );
}
