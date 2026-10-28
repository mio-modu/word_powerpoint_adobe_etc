/**
 * 단일 HTML 파일이 웹서버 없이(file://) 동작하는지 확인한다.
 *
 * 이 확인이 필요한 이유: 인라인 스크립트는 번들 내용에 따라 조용히 깨진다.
 * 예전에 XML 파서가 들고 있던 "<!--" 문자열 때문에 HTML 파서가 스크립트를
 * 주석으로 먹어버린 적이 있다. 빌드할 때마다 실제로 열어 봐야 안다.
 *
 *   node apps/editor/e2e/single-file.mjs <html경로> <샘플디렉터리> [스크린샷]
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const { chromium } = require_(process.env.PLAYWRIGHT_PATH ?? 'playwright');

const [htmlPath, samplesDir, shot] = process.argv.slice(2);

const browser = await chromium.launch({ args: ['--headless=new', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });

const problems = [];
page.on('pageerror', (e) => problems.push(`페이지 예외: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`콘솔 오류: ${m.text()}`);
});

const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) problems.push(label);
};

await page.goto(`file://${htmlPath}`, { waitUntil: 'load' });
await page.waitForTimeout(600);

check('앱이 그려진다', (await page.locator('h1').count()) > 0);
check(
  '시작 화면 제목이 맞다',
  ((await page.textContent('h1').catch(() => '')) ?? '').includes('브라우저에서'),
);
check(
  '제자리 저장 API 를 쓸 수 있다',
  await page.evaluate(() => typeof window.showSaveFilePicker === 'function'),
);

const bytes = Array.from(readFileSync(`${samplesDir}/sample.hwpx`));
await page.evaluate(([data]) => {
  const dt = new DataTransfer();
  dt.items.add(new File([new Uint8Array(data)], 'sample.hwpx'));
  document
    .querySelector('.app')
    .dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
}, [bytes]);
await page.waitForTimeout(800);

const text = (await page.textContent('.pages').catch(() => '')) ?? '';
check('문서가 열린다', text.includes('한글 문서 제목'), text.slice(0, 40));

if (shot) await page.screenshot({ path: shot });
await browser.close();

console.log('');
if (problems.length > 0) {
  console.error(`실패 ${problems.length}건:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('file:// 단독 실행 확인 완료');
