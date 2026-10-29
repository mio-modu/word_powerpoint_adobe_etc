/**
 * 에디터 종단 확인.
 *
 * 단위 테스트는 엔진까지만 본다. 실제로 브라우저에서 파일이 열리고, 글자를
 * 고치면 반영되고, 저장한 파일을 다시 열 수 있는지는 브라우저를 띄워 봐야
 * 알 수 있다.
 *
 * 파일 선택 대화상자는 자동화할 수 없으므로 드래그&드롭 경로를 쓰고,
 * 저장은 File System Access API 를 일부러 지운 뒤 내려받기 경로로 확인한다.
 *
 *   node apps/editor/e2e/smoke.mjs <baseUrl> <samplesDir> <outDir>
 */
import { readFileSync, mkdirSync } from 'node:fs';
// Playwright 는 이 컨테이너에 전역 설치돼 있고 CommonJS 로 노출된다.
// 프로젝트에 의존성으로 넣지 않으려고 createRequire 로 끌어온다.
import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
const { chromium } = require_(process.env.PLAYWRIGHT_PATH ?? 'playwright');

const [baseUrl, samplesDir, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ args: ['--headless=new', '--no-sandbox'] });
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 980 } });
const page = await context.newPage();

const problems = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') problems.push(`콘솔 오류: ${msg.text()}`);
});
page.on('pageerror', (err) => problems.push(`페이지 예외: ${err.message}`));

const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) problems.push(label + (detail ? ` (${detail})` : ''));
};

/** 드롭 이벤트로 파일을 연다. */
async function dropFile(name) {
  const bytes = Array.from(readFileSync(`${samplesDir}/${name}`));
  await page.evaluate(
    async ([filename, data]) => {
      const file = new File([new Uint8Array(data)], filename);
      const dt = new DataTransfer();
      dt.items.add(file);
      const target = document.querySelector('.app');
      target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    },
    [name, bytes],
  );
  await page.waitForTimeout(700);
}

await page.goto(baseUrl, { waitUntil: 'load' });
console.log('\n[시작 화면]');
check('제목이 보인다', (await page.textContent('h1'))?.includes('브라우저에서') === true);

console.log('\n[HWPX 열기]');
await dropFile('sample.hwpx');
const hwpxText = (await page.textContent('.pages')) ?? '';
check('첫 문단이 보인다', hwpxText.includes('한글 문서 제목'), hwpxText.slice(0, 60));
check('둘째 문단이 보인다', hwpxText.includes('두 번째 문단입니다.'));
check('특수문자가 제대로 보인다', hwpxText.includes('특수문자 & < > " 테스트'));
check('툴바에 형식이 표시된다', (await page.textContent('.toolbar-file'))?.includes('.hwpx') === true);
await page.screenshot({ path: `${outDir}/01-hwpx.png`, fullPage: false });

console.log('\n[HWPX 편집 후 저장]');
const paras = page.locator('.para [contenteditable]');
await paras.nth(1).click();
await paras.nth(1).fill('');
await paras.nth(1).pressSequentially('브라우저에서 고친 문장');
await page.locator('.brand').click(); // blur 로 반영
await page.waitForTimeout(300);
check('고친 내용이 화면에 남는다', ((await page.textContent('.pages')) ?? '').includes('브라우저에서 고친 문장'));
check('저장 버튼에 변경 표시(•)가 뜬다', ((await page.textContent('.toolbar')) ?? '').includes('저장 •'));

// File System Access API 를 지워 내려받기 경로로 저장하게 만든다.
await page.evaluate(() => {
  delete window.showSaveFilePicker;
  delete window.showOpenFilePicker;
});
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 15000 }),
  page.getByRole('button', { name: /^저장/ }).click(),
]);
await download.saveAs(`${outDir}/edited.hwpx`);
check('저장 파일을 내려받았다', true, download.suggestedFilename());

console.log('\n[DOCX 열기와 편집]');
await page.reload({ waitUntil: 'load' });
await dropFile('sample.docx');
const docxText = (await page.textContent('.pages')) ?? '';
check('워드 본문이 보인다', docxText.includes('한글 본문입니다.'), docxText.slice(0, 60));
check('제목 문단이 보인다', docxText.includes('자모 오피스 테스트 문서'));
await page.screenshot({ path: `${outDir}/02-docx.png` });

console.log('\n[PPTX 열기]');
await page.reload({ waitUntil: 'load' });
await dropFile('sample.pptx');
await page.waitForSelector('.deck-stage .slide', { timeout: 5000 });
const thumbs = await page.locator('.deck-rail .thumb:not(.thumb-add)').count();
check('슬라이드 썸네일이 3개다', thumbs === 3, `실제 ${thumbs}개`);
const slideText = (await page.textContent('.deck-stage .slide')) ?? '';
check('첫 장 제목이 보인다', slideText.includes('2026 사업계획'), slideText.slice(0, 60));
await page.locator('.deck-rail .thumb').nth(1).click();
await page.waitForTimeout(300);
check('둘째 장으로 넘어간다', ((await page.textContent('.deck-stage .slide')) ?? '').includes('시장 분석'));
await page.screenshot({ path: `${outDir}/03-pptx.png` });

console.log('\n[슬라이드를 보이는 대로 그린다]');
await page.reload({ waitUntil: 'load' });
await dropFile('themed.pptx');
await page.waitForSelector('.deck-stage .slide', { timeout: 8000 });
await page.waitForTimeout(500);
const bg = await page.evaluate(() =>
  getComputedStyle(document.querySelector('.deck-stage .slide')).backgroundColor);
check('마스터의 어두운 배경이 적용된다', bg === 'rgb(26, 34, 54)', bg);

const titleStyle = await page.evaluate(() => {
  const spans = [...document.querySelectorAll('.deck-stage .slide-shape span')];
  const el = spans.find((s) => s.textContent?.includes('영광을'));
  if (!el) return null;
  const cs = getComputedStyle(el);
  return { color: cs.color, weight: cs.fontWeight, size: cs.fontSize };
});
check('제목 색을 테마에서 물려받는다', titleStyle?.color === 'rgb(201, 162, 39)', JSON.stringify(titleStyle));
check('제목 굵기를 마스터에서 물려받는다', titleStyle?.weight === '700');
check('그림이 그려진다', (await page.locator('.deck-stage .slide img').count()) >= 1);
check('슬라이드 안 표가 그려진다', (await page.locator('.deck-stage .slide-table').count()) === 1);
check('미리보기도 같은 모습으로 그려진다',
  (await page.evaluate(() =>
    getComputedStyle(document.querySelector('.thumb-canvas .slide')).backgroundColor)) === 'rgb(26, 34, 54)');
await page.screenshot({ path: `${outDir}/06-themed.png` });

console.log('\n[새 문서 만들기]');
await page.reload({ waitUntil: 'load' });
await page.getByRole('button', { name: '새 한글 문서' }).click();
await page.waitForSelector('.page', { timeout: 5000 });
check('빈 한글 문서가 열린다', (await page.locator('.page').count()) === 1);

console.log('\n[구형 .hwp 는 읽기 전용임을 알린다]');
await page.reload({ waitUntil: 'load' });
await dropFile('sample-old.hwp');
await page.waitForTimeout(500);
const banner = (await page.textContent('.banner-info').catch(() => '')) ?? '';
check('읽기 전용 안내가 뜬다', banner.includes('읽기만 지원'), banner.slice(0, 80));
check('변환 버튼이 있다', await page.getByRole('button', { name: /hwpx 로 변환/ }).isVisible());
await page.getByRole('button', { name: /hwpx 로 변환/ }).click();
await page.waitForTimeout(500);
const convertedText = (await page.textContent('.pages')) ?? '';
check('변환 후 본문이 보인다', convertedText.includes('구형 한글 문서'), convertedText.slice(0, 60));
check('변환 후 편집 가능해진다', (await page.locator('.para [contenteditable]').count()) > 0);
await page.screenshot({ path: `${outDir}/04-converted.png` });

await browser.close();

console.log('');
if (problems.length > 0) {
  console.error(`실패 ${problems.length}건:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('모든 확인 통과');
