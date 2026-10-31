/**
 * 빌드 결과를 HTML 파일 하나로 합친다.
 *
 * 이유: 웹서버 없이 쓰고 싶을 때가 많다. 보통의 Vite 빌드는 스크립트를 별도
 * 파일로 내보내는데, 브라우저는 file:// 에서 외부 모듈 스크립트를 CORS 로
 * 막는다. 전부 인라인으로 넣으면 더블클릭만으로 열린다.
 *
 * 그런데 자바스크립트를 그대로 <script> 안에 넣으면 깨진다. 우리 XML 파서가
 * "<!--" 와 "-->" 를 문자열로 들고 있는데, 고전 스크립트 안에서 "<!--" 는
 * HTML 주석 시작으로 해석돼 그 뒤가 통째로 주석 처리된다. 코드 내용에 따라
 * 되기도 하고 안 되기도 하는 건 쓸 수 없으므로, base64 로 감싸 HTML 파서가
 * 해석할 여지를 아예 없앤다.
 *
 *   npx vite-node scripts/bundle-single-file.mts -- apps/editor/dist
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const distDir = process.argv[2] ?? 'apps/editor/dist';
const assetsDir = join(distDir, 'assets');

const files = readdirSync(assetsDir);
const jsName = files.find((f) => f.endsWith('.js'));
const cssName = files.find((f) => f.endsWith('.css'));
if (!jsName) throw new Error(`${assetsDir} 에서 .js 를 찾지 못했습니다`);

const js = readFileSync(join(assetsDir, jsName));
const css = cssName ? readFileSync(join(assetsDir, cssName), 'utf8') : '';

let html = readFileSync(join(distDir, 'index.html'), 'utf8');

// 외부 참조를 걷어낸다.
html = html
  .replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, '')
  .replace(/<link[^>]*rel="stylesheet"[^>]*>/g, '')
  .replace(/<link[^>]*rel="modulepreload"[^>]*>/g, '')
  // 설치형 앱용 참조는 파일 하나짜리에서는 가리킬 곳이 없다. 남겨 두면
  // 브라우저가 매번 없는 파일을 찾아 콘솔에 오류를 남긴다.
  .replace(/<link[^>]*rel="manifest"[^>]*>/g, '')
  .replace(/<link[^>]*rel="icon"[^>]*>/g, '')
  .replace(/<link[^>]*rel="apple-touch-icon"[^>]*>/g, '');

const base64 = js.toString('base64');

// base64 에는 '<' 가 없으므로 HTML 파서가 스크립트를 끊거나 주석으로 볼 일이 없다.
const loader = `
(function () {
  var b64 = "${base64}";
  var raw = atob(b64);
  var bytes = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  var code = new TextDecoder('utf-8').decode(bytes);
  // 간접 호출이라 전역 범위에서 실행된다.
  (0, eval)(code);
})();
`;

html = html
  .replace('</head>', `<style>\n${css}\n</style>\n</head>`)
  .replace('</body>', `<script>${loader}</script>\n</body>`);

// 판 번호를 파일 이름에 박는다.
//
// 같은 이름으로 계속 보내면 받는 쪽에 "jamo-office (1).html, (2).html" 이
// 쌓이고, 결국 예전 파일을 더블클릭하게 된다. 실제로 그 일이 있었다.
// 이름만 봐도 어느 게 최신인지 알 수 있어야 한다.
const stampPath = join(distDir, 'build-stamp.txt');
const stamp = existsSync(stampPath)
  ? readFileSync(stampPath, 'utf8').trim().replace(/[.:]/g, '').replace(/^(\d{6})(\d+)$/, '$1-$2')
  : '';

const size = `${(Buffer.byteLength(html) / 1024).toFixed(0)} KB`;

// 이름 없는 쪽도 함께 남긴다. 테스트와 문서가 이 경로를 가리킨다.
const plain = join(distDir, 'jamo-office.html');
writeFileSync(plain, html);
console.log(`${plain}  ${size} — 웹서버 없이 더블클릭으로 열립니다`);

if (stamp !== '') {
  const stamped = join(distDir, `jamo-office-${stamp}.html`);
  writeFileSync(stamped, html);
  console.log(`${stamped}  ${size} — 받는 쪽에 보낼 파일 (이름에 판 번호)`);
}
