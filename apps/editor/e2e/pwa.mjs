/**
 * 설치형 앱(PWA) 확인.
 *
 * 매니페스트와 서비스 워커는 "있기만 하면" 되는 게 아니다. 아이콘 경로가
 * 하나라도 404 면 설치 버튼이 안 뜨고, 미리 받아 둘 목록이 틀리면 인터넷을
 * 끊었을 때 빈 화면이 된다. 둘 다 눈으로는 안 보이므로 실제로 끊어 보고
 * 확인한다.
 *
 *   node apps/editor/e2e/pwa.mjs <baseUrl> <샘플디렉터리> <출력디렉터리>
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const { chromium } = require_(process.env.PLAYWRIGHT_PATH ?? 'playwright');

const [baseUrl, samplesDir, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ args: ['--headless=new', '--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const page = await context.newPage();

const problems = [];
page.on('pageerror', (err) => problems.push(`페이지 예외: ${err.message}`));
page.on('console', (msg) => {
  if (msg.type() === 'error') problems.push(`콘솔 오류: ${msg.text()}`);
});

const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) problems.push(label + (detail ? ` (${detail})` : ''));
};

await page.goto(baseUrl, { waitUntil: 'load' });

console.log('\n[매니페스트]');
const manifestHref = await page.getAttribute('link[rel=manifest]', 'href');
check('매니페스트를 가리킨다', manifestHref !== null, manifestHref ?? '');

const manifestUrl = new URL(manifestHref ?? 'manifest.webmanifest', page.url()).toString();
const manifestRes = await page.request.get(manifestUrl);
check('매니페스트를 받을 수 있다', manifestRes.ok(), `HTTP ${manifestRes.status()}`);

const manifest = await manifestRes.json();
check('앱 이름이 있다', typeof manifest.name === 'string' && manifest.name.length > 0, manifest.name);
check('짧은 이름이 있다', typeof manifest.short_name === 'string', manifest.short_name);
check('전용 창으로 뜬다', manifest.display === 'standalone', manifest.display);
check('시작 주소가 있다', typeof manifest.start_url === 'string', manifest.start_url);

// 설치 조건: 192 와 512 PNG 가 둘 다 있어야 한다.
const sizes = (manifest.icons ?? []).map((i) => i.sizes);
check('192 아이콘이 있다', sizes.includes('192x192'), sizes.join(' '));
check('512 아이콘이 있다', sizes.includes('512x512'));
check(
  '마스커블 아이콘이 있다',
  (manifest.icons ?? []).some((i) => (i.purpose ?? '').includes('maskable')),
);

console.log('\n[아이콘이 실제로 있는지]');
for (const icon of manifest.icons ?? []) {
  const url = new URL(icon.src, manifestUrl).toString();
  const res = await page.request.get(url);
  const type = res.headers()['content-type'] ?? '';
  check(
    `${icon.src} (${icon.sizes})`,
    res.ok() && type.startsWith('image/'),
    `HTTP ${res.status()} ${type}`,
  );
}

console.log('\n[파일 연결]');
const handler = (manifest.file_handlers ?? [])[0];
check('파일 연결이 선언돼 있다', handler !== undefined);
const extensions = Object.values(handler?.accept ?? {}).flat();
for (const want of ['.hwp', '.hwpx', '.docx', '.pptx']) {
  check(`${want} 를 이 앱으로 연다`, extensions.includes(want));
}

console.log('\n[서비스 워커]');
await page.waitForFunction(
  () => navigator.serviceWorker && navigator.serviceWorker.controller !== null,
  undefined,
  { timeout: 20000 },
).catch(() => undefined);

const swState = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  return {
    registered: reg !== undefined,
    scope: reg?.scope ?? '',
    active: reg?.active?.state ?? 'none',
  };
});
check('서비스 워커가 등록됐다', swState.registered, swState.scope);
check('활성화됐다', swState.active === 'activated', swState.active);

const cached = await page.evaluate(async () => {
  const names = await caches.keys();
  const mine = names.filter((n) => n.startsWith('jamo-office-'));
  if (mine.length === 0) return { names: mine, count: 0 };
  const cache = await caches.open(mine[0]);
  return { names: mine, count: (await cache.keys()).length };
});
check('캐시가 하나만 남아 있다', cached.names.length === 1, cached.names.join(', '));
check('미리 받아 둔 파일이 있다', cached.count >= 4, `${cached.count}개`);

console.log('\n[인터넷을 끊고 열기]');
await context.setOffline(true);
await page.reload({ waitUntil: 'load' });
// 새로고침 직후에는 React 가 아직 키 처리기를 걸기 전일 수 있다.
// 도구막대가 뜨면 준비가 끝난 것이다.
await page.waitForSelector('.toolbar', { state: 'visible', timeout: 15000 });
await page.waitForTimeout(600);
const offlineTitle = (await page.textContent('h1').catch(() => '')) ?? '';
check('오프라인에서도 앱이 뜬다', offlineTitle.includes('브라우저에서'), offlineTitle.slice(0, 40));
check('도구막대가 보인다', (await page.locator('.toolbar').count()) === 1);

console.log('\n[오프라인에서 파일 열기]');
const bytes = Array.from(readFileSync(`${samplesDir}/sample.pptx`));
await page.evaluate(
  async ([data]) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(data)], 'sample.pptx'));
    document
      .querySelector('.app')
      .dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  },
  [bytes],
);
await page.waitForTimeout(900);
check('오프라인에서 슬라이드가 열린다', (await page.locator('.deck .slide').count()) > 0);
check('메모판도 나온다', (await page.locator('.notes-input').count()) === 1);
await page.screenshot({ path: `${outDir}/offline.png` });

await context.setOffline(false);

console.log('\n[바로가기로 새 문서 만들기]');
await page.goto(`${baseUrl.replace(/\/$/, '')}/?new=pptx`, { waitUntil: 'load' });
await page.waitForTimeout(900);
check(
  '?new=pptx 로 띄우면 빈 슬라이드가 준비된다',
  (await page.locator('.deck .slide').count()) > 0,
);

await browser.close();

if (problems.length > 0) {
  console.error(`\n실패 ${problems.length}건:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('\n설치형 앱 확인 완료');
