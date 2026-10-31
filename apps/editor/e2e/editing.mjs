/**
 * 편집 기능 종단 확인 — 단축키, 서식, 표, 되돌리기.
 *
 * 단위 테스트는 엔진까지만 본다. 키를 눌렀을 때 실제로 그 명령이 도는지,
 * 화면에 반영되는지, 저장한 파일에 남는지는 브라우저를 띄워야 알 수 있다.
 *
 *   node apps/editor/e2e/editing.mjs <baseUrl> <샘플디렉터리> <출력디렉터리>
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const { chromium } = require_(process.env.PLAYWRIGHT_PATH ?? 'playwright');

const [baseUrl, samplesDir, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ args: ['--headless=new', '--no-sandbox'] });
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 980 } });
const page = await context.newPage();

const problems = [];
page.on('pageerror', (e) => problems.push(`페이지 예외: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`콘솔 오류: ${m.text()}`);
});

const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) problems.push(label + (detail ? ` (${detail})` : ''));
};

async function dropFile(name) {
  const bytes = Array.from(readFileSync(`${samplesDir}/${name}`));
  await page.evaluate(
    async ([filename, data]) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(data)], filename));
      document
        .querySelector('.app')
        .dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    },
    [name, bytes],
  );
  await page.waitForTimeout(700);
}

const paras = () => page.locator('.page > .para [contenteditable]');
const focusPara = async (i) => {
  await paras().nth(i).click();
  await page.waitForTimeout(150);
};

await page.goto(baseUrl, { waitUntil: 'load' });

// ---------------------------------------------------------------- 단축키
console.log('\n[단축키 — 글자 서식]');
await dropFile('sample.hwpx');
await focusPara(0);

await page.keyboard.press('Control+b');
await page.waitForTimeout(250);
check(
  'Ctrl+B 로 진하게 (워드/한글 공통)',
  (await paras().nth(0).evaluate((el) => getComputedStyle(el.parentElement).fontWeight)) === '700',
);

await page.keyboard.press('Control+i');
await page.waitForTimeout(250);
check(
  'Ctrl+I 로 기울임',
  (await paras().nth(0).evaluate((el) => getComputedStyle(el.parentElement).fontStyle)) === 'italic',
);

await page.keyboard.press('Control+u');
await page.waitForTimeout(250);
check(
  'Ctrl+U 로 밑줄',
  (await paras().nth(0).evaluate((el) =>
    getComputedStyle(el.parentElement).textDecorationLine,
  )).includes('underline'),
);

const sizeOf = () =>
  paras().nth(0).evaluate((el) => getComputedStyle(el.parentElement).fontSize);
const before = await sizeOf();
await page.keyboard.press('Control+]');
await page.waitForTimeout(250);
check('Ctrl+] 로 글자 크게 (한글 키)', (await sizeOf()) !== before, `${before} → ${await sizeOf()}`);

console.log('\n[단축키 — 문단 정렬: 워드 키와 한글 키 둘 다]');
const alignOf = () =>
  paras().nth(0).evaluate((el) => getComputedStyle(el.parentElement).textAlign);

await page.keyboard.press('Control+e'); // 워드: 가운데
await page.waitForTimeout(250);
check('Ctrl+E 로 가운데 정렬 (워드 키)', (await alignOf()) === 'center', await alignOf());

await page.keyboard.press('Control+Shift+r'); // 한글: 오른쪽
await page.waitForTimeout(250);
check('Ctrl+Shift+R 로 오른쪽 정렬 (한글 키)', (await alignOf()) === 'right', await alignOf());

await page.keyboard.press('Control+l'); // 워드: 왼쪽
await page.waitForTimeout(250);
check('Ctrl+L 로 왼쪽 정렬 (워드 키)', (await alignOf()) === 'left', await alignOf());

// ---------------------------------------------------------------- 되돌리기
console.log('\n[되돌리기]');
await page.keyboard.press('Control+z');
await page.waitForTimeout(350);
check('Ctrl+Z 로 정렬이 되돌아간다', (await alignOf()) === 'right', await alignOf());
await page.keyboard.press('Control+y');
await page.waitForTimeout(350);
check('Ctrl+Y 로 다시 실행된다', (await alignOf()) === 'left', await alignOf());

// ------------------------------------------------------------------- 표
console.log('\n[표]');
await focusPara(0);
await page.keyboard.press('Control+Alt+t');
await page.waitForTimeout(400);
check('Ctrl+Alt+T 로 표가 생긴다', (await page.locator('.doc-table').count()) === 1);
const cellCount = await page.locator('.doc-table td').count();
check('기본 3×3 으로 만들어진다', cellCount === 9, `셀 ${cellCount}개`);

const cells = page.locator('.doc-table td [contenteditable]');
await cells.nth(0).click();
await cells.nth(0).pressSequentially('항목');
await cells.nth(1).click();
await cells.nth(1).pressSequentially('값');
await page.waitForTimeout(300);
check(
  '셀에 글자를 넣는다',
  ((await page.textContent('.doc-table')) ?? '').includes('항목'),
  (await page.textContent('.doc-table')) ?? '',
);

await cells.nth(0).click();
await page.waitForTimeout(150);
await page.keyboard.press('Control+Alt+ArrowDown');
await page.waitForTimeout(350);
check(
  'Ctrl+Alt+↓ 로 줄이 늘어난다',
  (await page.locator('.doc-table tr').count()) === 4,
  `${await page.locator('.doc-table tr').count()}줄`,
);

await page.locator('.doc-table td [contenteditable]').nth(0).click();
await page.waitForTimeout(150);
await page.keyboard.press('Control+Alt+ArrowRight');
await page.waitForTimeout(350);
check(
  'Ctrl+Alt+→ 로 칸이 늘어난다',
  (await page.locator('.doc-table tr').first().locator('td').count()) === 4,
);

// ------------------------------------------------------- 저장해서 남는지 확인
console.log('\n[저장하면 실제로 파일에 남는가]');
await page.evaluate(() => {
  delete window.showSaveFilePicker;
  delete window.showOpenFilePicker;
});
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 20000 }),
  page.getByRole('button', { name: /^저장/ }).click(),
]);
await download.saveAs(`${outDir}/edited-table.hwpx`);
check('저장 파일을 내려받았다', true, download.suggestedFilename());
await page.screenshot({ path: `${outDir}/10-table.png` });

// ---------------------------------------------------------------- 도움말
console.log('\n[단축키 도움말]');
await page.reload({ waitUntil: 'load' });
// 새로고침 직후에는 React 가 아직 키 처리기를 걸기 전일 수 있다.
// 도구막대가 뜨면 준비가 끝난 것이다.
await page.waitForSelector('.toolbar', { state: 'visible', timeout: 15000 });
await page.keyboard.press('F1');
await page.waitForTimeout(400);
check('F1 로 단축키 목록이 열린다', await page.locator('.sheet').isVisible());
const helpText = (await page.textContent('.sheet')) ?? '';
check('브라우저가 가져가는 키를 솔직히 적는다', helpText.includes('브라우저가 가져가는 키'));
check('한글 대체 키를 밝힌다', helpText.includes('원래'));
await page.screenshot({ path: `${outDir}/11-help.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
check('Esc 로 닫힌다', (await page.locator('.sheet').count()) === 0);

// -------------------------------------------------------- DOCX 에서도 같은 키
console.log('\n[DOCX 에서도 같은 키가 먹는다]');
await dropFile('sample.docx');
await focusPara(1);
await page.keyboard.press('Control+b');
await page.waitForTimeout(300);
check(
  'DOCX 에서 Ctrl+B',
  (await paras().nth(1).evaluate((el) => getComputedStyle(el.parentElement).fontWeight)) === '700',
);
await page.keyboard.press('Control+Alt+t');
await page.waitForTimeout(400);
check('DOCX 에서 표 만들기', (await page.locator('.doc-table').count()) === 1);
await page.screenshot({ path: `${outDir}/12-docx-table.png` });

await browser.close();

console.log('');
if (problems.length > 0) {
  console.error(`실패 ${problems.length}건:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('모든 확인 통과');
