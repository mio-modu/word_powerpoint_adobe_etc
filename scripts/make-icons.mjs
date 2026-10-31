/**
 * 아이콘 SVG 를 PNG 로 굽는다.
 *
 * 설치형 앱 아이콘은 PNG 가 있어야 한다. 안드로이드/윈도우 런처가 SVG 를
 * 받아주지 않는 경우가 있고, 매니페스트 검사기도 PNG 를 요구한다.
 *
 * 크로미움으로 굽는 이유: 별도 래스터라이저를 의존성으로 들이지 않으려고.
 * 이미 종단 테스트용으로 깔려 있다.
 *
 *   node scripts/make-icons.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const { chromium } = require_(process.env.PLAYWRIGHT_PATH ?? 'playwright');

const PUBLIC = new URL('../apps/editor/public/', import.meta.url);
const svg = readFileSync(new URL('icon.svg', PUBLIC), 'utf8');

// 마스커블은 런처가 둥글게 깎으므로 배경이 모서리까지 꽉 차야 한다.
const maskable = svg.replace('rx="112"', 'rx="0"');

const JOBS = [
  { file: 'icon-192.png', size: 192, source: svg },
  { file: 'icon-512.png', size: 512, source: svg },
  { file: 'icon-maskable-512.png', size: 512, source: maskable },
  { file: 'apple-touch-icon.png', size: 180, source: maskable },
];

const browser = await chromium.launch({ args: ['--headless=new', '--no-sandbox'] });

for (const { file, size, source } of JOBS) {
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<!doctype html><meta charset="utf-8">` +
      `<style>html,body{margin:0;padding:0;background:transparent}` +
      `svg{display:block;width:${size}px;height:${size}px}</style>` +
      source,
    { waitUntil: 'load' },
  );
  const png = await page.screenshot({ omitBackground: true });
  writeFileSync(new URL(file, PUBLIC), png);
  console.log(`  ${file}  ${size}×${size}  ${(png.length / 1024).toFixed(1)} KB`);
  await page.close();
}

await browser.close();
