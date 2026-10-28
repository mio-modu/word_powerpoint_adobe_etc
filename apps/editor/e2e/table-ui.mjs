/**
 * 표 UI 종단 확인 — 크기 선택기, 셀 범위 선택, 병합, 배경색, Tab 이동.
 *
 *   node apps/editor/e2e/table-ui.mjs <baseUrl> <샘플디렉터리> <출력디렉터리>
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const { chromium } = require_(process.env.PLAYWRIGHT_PATH ?? 'playwright');

const [baseUrl, samplesDir, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ args: ['--headless=new', '--no-sandbox'] });
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();

const problems = [];
page.on('pageerror', (e) => problems.push(`페이지 예외: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') problems.push(`콘솔 오류: ${m.text()}`); });

const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) problems.push(label + (detail ? ` (${detail})` : ''));
};

async function dropFile(name) {
  const bytes = Array.from(readFileSync(`${samplesDir}/${name}`));
  await page.evaluate(async ([filename, data]) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(data)], filename));
    document.querySelector('.app').dispatchEvent(
      new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }),
    );
  }, [name, bytes]);
  await page.waitForTimeout(700);
}

/** 화면에 보이는 표 격자를 "주인 셀" 모양으로 읽어낸다. */
const gridShape = () =>
  page.evaluate(() => {
    const table = document.querySelector('.doc-table');
    if (!table) return [];
    return [...table.rows].map((tr) =>
      [...tr.cells].map((td) => `${td.colSpan}x${td.rowSpan}`).join(' '),
    );
  });

await page.goto(baseUrl, { waitUntil: 'load' });

console.log('\n[표 크기 선택기]');
await dropFile('sample.hwpx');
await page.locator('.page > .para [contenteditable]').first().click();
await page.waitForTimeout(150);
await page.getByRole('button', { name: /^표 ▾$/ }).click();
await page.waitForTimeout(250);
check('격자 선택기가 나타난다', await page.locator('.grid-picker-grid').isVisible());
check('격자가 8×10 이다', (await page.locator('.grid-cell').count()) === 80);

// 3줄 4칸을 고른다 (0부터 세므로 2행 3열 칸).
const target = page.locator('.grid-cell').nth(2 * 10 + 3);
await target.hover();
await page.waitForTimeout(200);
check('고르는 크기가 표시된다', ((await page.textContent('.grid-picker-label')) ?? '').includes('3 × 4'));
await target.click();
await page.waitForTimeout(500);
check('표가 3줄 4칸으로 생긴다',
  (await page.locator('.doc-table tr').count()) === 3 &&
  (await page.locator('.doc-table tr').first().locator('td').count()) === 4);
await page.screenshot({ path: `${outDir}/20-picker.png` });

console.log('\n[표 도구막대]');
const cells = page.locator('.doc-table td [contenteditable]');
await cells.nth(0).click();
await page.waitForTimeout(300);
check('커서를 표에 두면 도구막대가 뜬다', await page.locator('.tabletoolbar').isVisible());
check('셀 합치기는 한 칸만 고르면 꺼져 있다',
  await page.getByRole('button', { name: '셀 합치기' }).isDisabled());

console.log('\n[Shift+클릭으로 셀 범위 고르기]');
await cells.nth(2).click({ modifiers: ['Shift'] });
await page.waitForTimeout(300);
check('선택한 칸에 표시가 붙는다', (await page.locator('.cell-selected').count()) === 3,
  `${await page.locator('.cell-selected').count()}칸`);
check('칸 수가 도구막대에 보인다',
  ((await page.textContent('.tabletoolbar')) ?? '').includes('3칸 선택'));
check('셀 합치기가 켜진다',
  !(await page.getByRole('button', { name: '셀 합치기' }).isDisabled()));

console.log('\n[셀 합치기와 나누기]');
await page.getByRole('button', { name: '셀 합치기' }).click();
await page.waitForTimeout(500);
let shape = await gridShape();
check('첫 줄 첫 칸이 3칸으로 합쳐진다', shape[0]?.startsWith('3x1'), JSON.stringify(shape));
check('둘째 줄은 그대로 4칸', shape[1] === '1x1 1x1 1x1 1x1', JSON.stringify(shape[1]));

await page.locator('.doc-table td [contenteditable]').first().click();
await page.waitForTimeout(200);
await page.getByRole('button', { name: '셀 나누기' }).click();
await page.waitForTimeout(500);
shape = await gridShape();
check('되돌리면 다시 4칸', shape[0] === '1x1 1x1 1x1 1x1', JSON.stringify(shape[0]));

console.log('\n[세로 병합]');
await page.locator('.doc-table td [contenteditable]').nth(0).click();
await page.waitForTimeout(150);
await page.locator('.doc-table td [contenteditable]').nth(4).click({ modifiers: ['Shift'] });
await page.waitForTimeout(250);
await page.getByRole('button', { name: '셀 합치기' }).click();
await page.waitForTimeout(500);
shape = await gridShape();
check('세로로 2줄 합쳐진다', shape[0]?.startsWith('1x2'), JSON.stringify(shape));

console.log('\n[칸 배경색]');
await page.locator('.doc-table td [contenteditable]').first().click();
await page.waitForTimeout(200);
await page.locator('.tabletoolbar .swatch').nth(1).click();
await page.waitForTimeout(400);
const bg = await page.evaluate(() => {
  const td = document.querySelector('.doc-table td');
  return getComputedStyle(td).backgroundColor;
});
check('칸에 색이 칠해진다', bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent', bg);
await page.screenshot({ path: `${outDir}/21-merged.png` });

console.log('\n[Tab 으로 칸 이동]');
await page.reload({ waitUntil: 'load' });
await dropFile('sample.hwpx');
await page.locator('.page > .para [contenteditable]').first().click();
await page.keyboard.press('Control+Alt+t');
await page.waitForTimeout(500);
const fresh = page.locator('.doc-table td [contenteditable]');
await fresh.nth(0).click();
await fresh.nth(0).pressSequentially('첫칸');
await page.keyboard.press('Tab');
await page.waitForTimeout(250);
await page.keyboard.type('둘째칸');
await page.waitForTimeout(250);
const afterTab = await page.evaluate(() =>
  document.activeElement?.getAttribute('data-cell') ?? '');
check('Tab 으로 다음 칸으로 간다', afterTab === '0,1', `현재 칸 ${afterTab}`);
check('옮겨간 칸에 글자가 들어간다',
  ((await page.textContent('.doc-table')) ?? '').includes('둘째칸'));

await page.keyboard.press('Shift+Tab');
await page.waitForTimeout(250);
check('Shift+Tab 으로 앞 칸으로 간다',
  (await page.evaluate(() => document.activeElement?.getAttribute('data-cell'))) === '0,0');

console.log('\n[마지막 칸에서 Tab 하면 줄이 늘어난다]');
const before = await page.locator('.doc-table tr').count();
const all = page.locator('.doc-table td [contenteditable]');
await all.nth((await all.count()) - 1).click();
await page.waitForTimeout(200);
await page.keyboard.press('Tab');
await page.waitForTimeout(600);
check('줄이 하나 늘어난다', (await page.locator('.doc-table tr').count()) === before + 1,
  `${before} → ${await page.locator('.doc-table tr').count()}`);

console.log('\n[저장하면 파일에 남는가]');
await page.evaluate(() => { delete window.showSaveFilePicker; delete window.showOpenFilePicker; });
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 20000 }),
  page.getByRole('button', { name: /^저장/ }).click(),
]);
await download.saveAs(`${outDir}/table-ui.hwpx`);
check('저장 파일을 내려받았다', true, download.suggestedFilename());

await browser.close();
console.log('');
if (problems.length > 0) {
  console.error(`실패 ${problems.length}건:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('모든 확인 통과');
