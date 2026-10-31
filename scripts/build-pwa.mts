/**
 * 서비스 워커를 만든다.
 *
 * 왜 빌드 뒤에 만드는가: 미리 받아 둘 파일 목록에 해시가 붙은 이름이
 * 들어간다(`index-C8n3sIbP.js`). 빌드를 해 봐야 알 수 있는 이름이라
 * 손으로 적어 둘 수가 없다. 하나라도 틀리면 오프라인에서 빈 화면이 된다.
 *
 * 캐시 이름에 목록 해시를 넣는다. 빌드 결과가 달라지면 이름이 달라지고,
 * 브라우저가 sw.js 의 바이트가 바뀐 걸 보고 새로 설치한다. 그래야 새 판이
 * 나왔을 때 옛날 파일이 계속 나오지 않는다.
 *
 *   npx vite-node scripts/build-pwa.mts -- apps/editor/dist
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const distDir = process.argv[2] ?? 'apps/editor/dist';

/** 단일 HTML 파일(jamo-office.html)은 서비스 워커와 상관없으니 뺀다. */
const SKIP = new Set(['sw.js', 'jamo-office.html']);
/** 판 번호가 붙은 단일 HTML 파일(jamo-office-261031-2319.html)도 뺀다. */
const SKIP_PATTERN = /^jamo-office-[\d-]+\.html$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = walk(distDir)
  .map((full) => relative(distDir, full).split(sep).join('/'))
  .filter((rel) => !SKIP.has(rel) && !SKIP_PATTERN.test(rel))
  .sort();

if (!files.includes('index.html')) {
  throw new Error(`${distDir} 에 index.html 이 없습니다. 먼저 빌드하세요.`);
}

// 목록만이 아니라 내용까지 넣어 해시한다. 이름이 같아도 내용이 바뀐
// 파일(index.html, 매니페스트)이 있으면 새 판으로 쳐야 한다.
const hash = createHash('sha256');
for (const rel of files) {
  hash.update(rel);
  hash.update(readFileSync(join(distDir, rel)));
}
const version = hash.digest('hex').slice(0, 12);

const precache = JSON.stringify(['./', ...files.map((f) => `./${f}`)], null, 2);

const sw = `/**
 * 자모 오피스 서비스 워커 — 빌드가 만든 파일입니다. 직접 고치지 마세요.
 * 만드는 곳: scripts/build-pwa.mts
 */
const VERSION = '${version}';
const CACHE = 'jamo-office-' + VERSION;
const PRECACHE = ${precache};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      // 기다리지 않고 바로 새 판으로 넘어간다. 번들이 하나라서
      // 옛 페이지가 새 조각을 요청하다 어긋날 일이 없다.
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key.startsWith('jamo-office-') && key !== CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // ignoreVary 가 꼭 필요하다. 번들 스크립트에는 crossorigin 이 붙어 있어
  // 그 요청만 Origin 헤더를 달고 나간다. 응답에 Vary 가 있으면 같은 주소인데도
  // 캐시가 "다른 요청"으로 보고 못 찾는다. 그러면 오프라인에서 자바스크립트
  // 대신 index.html 이 돌아가고, 브라우저는 "모듈인 줄 알았는데 HTML"이라며
  // 빈 화면을 띄운다.
  const lookup = (key) => caches.match(key, { cacheName: CACHE, ignoreVary: true });

  // 주소창으로 들어오는 요청은 언제나 앱 껍데기를 돌려준다.
  // 파일을 열어 둔 채 새로고침해도 오프라인에서 뜨게 하려는 것.
  if (request.mode === 'navigate') {
    event.respondWith(
      lookup('./').then((hit) => hit || lookup('./index.html').then((i) => i || fetch(request))),
    );
    return;
  }

  // 못 찾으면 그냥 네트워크로 보낸다. 없는 파일 자리에 index.html 을
  // 끼워 넣으면 원인을 못 찾는 엉뚱한 오류가 난다.
  event.respondWith(lookup(request).then((hit) => hit || fetch(request)));
});
`;

writeFileSync(join(distDir, 'sw.js'), sw);
console.log(
  `${join(distDir, 'sw.js')}  판 ${version}  파일 ${files.length}개를 미리 받아 둡니다`,
);
