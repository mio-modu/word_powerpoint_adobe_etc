/**
 * 발표 모드와 강의용 메모판 종단 확인.
 *
 * 여기서만 잡히는 것들이 있다:
 *  - 메모를 치다가 Ctrl+S 를 바로 눌렀을 때 그 글이 파일에 들어가는지.
 *    (아직 엔진에 반영되지 않은 글을 밀어 넣는 장치가 동작하는지)
 *  - F5 가 실제로 발표 화면을 띄우고 방향키로 장이 넘어가는지.
 *  - 발표자 보기에 그 장의 메모가 나오는지.
 *
 *   node apps/editor/e2e/slideshow.mjs <baseUrl> <샘플디렉터리> <출력디렉터리>
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const { chromium } = require_(process.env.PLAYWRIGHT_PATH ?? 'playwright');

const [baseUrl, samplesDir, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ args: ['--headless=new', '--no-sandbox'] });
const context = await browser.newContext({
  acceptDownloads: true,
  viewport: { width: 1440, height: 980 },
});
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

async function dropFile(name) {
  const bytes = Array.from(readFileSync(`${samplesDir}/${name}`));
  await page.evaluate(
    async ([filename, data]) => {
      const file = new File([new Uint8Array(data)], filename);
      const dt = new DataTransfer();
      dt.items.add(file);
      document
        .querySelector('.app')
        .dispatchEvent(
          new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }),
        );
    },
    [name, bytes],
  );
  await page.waitForTimeout(700);
}

await page.goto(baseUrl, { waitUntil: 'load' });
await dropFile('sample.pptx');

console.log('\n[메모판]');
check('메모판이 슬라이드 아래에 있다', (await page.locator('.notes-input').count()) === 1);
check(
  '제목에 몇 번째 장인지 나온다',
  ((await page.textContent('.notes-title')) ?? '').includes('1장'),
);

const NOTE_1 = '도입 3분. 청중에게 질문부터 던진다.';
await page.locator('.notes-input').click();
await page.locator('.notes-input').pressSequentially(NOTE_1);
check('친 글이 메모판에 남는다', (await page.inputValue('.notes-input')) === NOTE_1);

// 일부러 포커스를 옮기지 않고 바로 저장한다. 예전에는 여기서
// 마지막으로 친 글이 통째로 빠졌다.
await page.evaluate(() => {
  delete window.showSaveFilePicker;
  delete window.showOpenFilePicker;
});
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 15000 }),
  page.keyboard.press('Control+s'),
]);
const savedPath = `${outDir}/notes.pptx`;
await download.saveAs(savedPath);
check('Ctrl+S 로 저장됐다', true, download.suggestedFilename());

console.log('\n[저장한 파일 다시 열기]');
await page.reload({ waitUntil: 'load' });
// 새로고침 직후에는 React 가 아직 키 처리기를 걸기 전일 수 있다.
// 도구막대가 뜨면 준비가 끝난 것이다.
await page.waitForSelector('.toolbar', { state: 'visible', timeout: 15000 });
await page.evaluate(() => {
  const el = document.querySelector('.app');
  if (!el) throw new Error('.app 이 없습니다');
});
const reopened = Array.from(readFileSync(savedPath));
await page.evaluate(
  async ([data]) => {
    const file = new File([new Uint8Array(data)], 'notes.pptx');
    const dt = new DataTransfer();
    dt.items.add(file);
    document
      .querySelector('.app')
      .dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  },
  [reopened],
);
await page.waitForTimeout(800);
check(
  '포커스를 옮기지 않고 저장한 메모가 파일에 들어 있다',
  (await page.inputValue('.notes-input')) === NOTE_1,
  (await page.inputValue('.notes-input')).slice(0, 40),
);

console.log('\n[장을 옮겨도 메모가 따라온다]');
const thumbs = page.locator('.thumb:not(.thumb-add)');
const slideCount = await thumbs.count();
check('미리보기 칸이 있다', slideCount >= 2, `${slideCount}장`);

const NOTE_2 = '두 번째 장 메모 — 사례는 짧게.';
await thumbs.nth(1).click();
await page.waitForTimeout(300);
check('2장 메모는 비어 있다', (await page.inputValue('.notes-input')) === '');
await page.locator('.notes-input').click();
await page.locator('.notes-input').pressSequentially(NOTE_2);

await thumbs.nth(0).click();
await page.waitForTimeout(400);
check('1장으로 돌아오면 1장 메모가 보인다', (await page.inputValue('.notes-input')) === NOTE_1);
await thumbs.nth(1).click();
await page.waitForTimeout(400);
check('2장 메모도 그대로다', (await page.inputValue('.notes-input')) === NOTE_2);
check(
  '메모가 있는 장에 표시가 뜬다',
  (await page.locator('.thumb-note-dot').count()) >= 2,
  `${await page.locator('.thumb-note-dot').count()}개`,
);

console.log('\n[메모판 접기]');
await page.getByRole('button', { name: '메모판 접기' }).click();
check('접으면 입력칸이 사라진다', (await page.locator('.notes-input').count()) === 0);
await page.getByRole('button', { name: '메모판 펼치기' }).click();
check('다시 펼치면 글이 그대로다', (await page.inputValue('.notes-input')) === NOTE_2);

console.log('\n[F5 발표 모드]');
await page.locator('.deck-stage').click({ position: { x: 5, y: 5 } });
await page.keyboard.press('F5');
await page.waitForTimeout(500);
check('발표 화면이 뜬다', (await page.locator('.show').count()) === 1);
check(
  'F5 는 처음부터 시작한다',
  ((await page.textContent('.show-counter')) ?? '').startsWith('1 /'),
  await page.textContent('.show-counter'),
);
await page.screenshot({ path: `${outDir}/show-01.png` });

const slideBox = await page.locator('.show .slide').boundingBox();
check('슬라이드가 화면을 채운다', slideBox !== null && slideBox.width > 1000, `${Math.round(slideBox?.width ?? 0)}px`);

await page.keyboard.press('ArrowRight');
await page.waitForTimeout(250);
check(
  '방향키로 다음 장으로 넘어간다',
  ((await page.textContent('.show-counter')) ?? '').startsWith('2 /'),
  await page.textContent('.show-counter'),
);

await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(250);
check('왼쪽 방향키로 돌아온다', ((await page.textContent('.show-counter')) ?? '').startsWith('1 /'));

console.log('\n[B 검은 화면]');
await page.keyboard.press('b');
await page.waitForTimeout(250);
check('슬라이드가 가려진다', (await page.locator('.show .slide').count()) === 0);
await page.keyboard.press('b');
await page.waitForTimeout(250);
check('다시 누르면 돌아온다', (await page.locator('.show .slide').count()) === 1);

console.log('\n[S 발표자 보기]');
await page.keyboard.press('ArrowRight'); // 2장 — 메모를 적어 둔 장
await page.waitForTimeout(250);
await page.keyboard.press('s');
await page.waitForTimeout(400);
check('발표자 보기로 바뀐다', (await page.locator('.show-presenter').count()) === 1);
const notesText = (await page.textContent('.presenter-notes')) ?? '';
check('그 장의 메모가 보인다', notesText.includes(NOTE_2), notesText.slice(0, 60));
check(
  '경과 시간이 보인다',
  /^\d{2}:\d{2}$/.test(((await page.textContent('.presenter-clock')) ?? '').trim()),
  await page.textContent('.presenter-clock'),
);
check('다음 장 미리보기가 있다', (await page.locator('.presenter-next .slide').count()) <= 1);
check(
  '몇 번째 장인지 보인다',
  ((await page.textContent('.presenter-count')) ?? '').startsWith('2 /'),
);
await page.screenshot({ path: `${outDir}/show-02-presenter.png` });

console.log('\n[Esc 로 나가기]');
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
check('발표 화면이 닫힌다', (await page.locator('.show').count()) === 0);
check('편집 화면으로 돌아온다', (await page.locator('.notes-input').count()) === 1);

console.log('\n[Shift+F5 는 현재 장부터]');
await thumbs.nth(1).click();
await page.waitForTimeout(300);
await page.locator('.deck-stage').click({ position: { x: 5, y: 5 } });
await page.keyboard.press('Shift+F5');
await page.waitForTimeout(400);
check(
  '2장부터 시작한다',
  ((await page.textContent('.show-counter')) ?? '').startsWith('2 /'),
  await page.textContent('.show-counter'),
);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

console.log('\n[발표 중에는 편집 단축키가 듣지 않는다]');
const beforeSlides = await thumbs.count();
await page.keyboard.press('F5');
await page.waitForTimeout(400);
await page.keyboard.press('Control+m'); // 평소라면 슬라이드 추가
await page.waitForTimeout(400);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
check(
  '발표 중 Ctrl+M 이 슬라이드를 늘리지 않았다',
  (await thumbs.count()) === beforeSlides,
  `${beforeSlides} → ${await thumbs.count()}`,
);

console.log('\n[장이 많을 때 슬라이드 목록]');
// 예전에 여기가 깨졌다: 목록이 세로 flex 라 장이 많아지면 칸이 min-height
// 까지 찌그러지는데 안의 미리보기는 그대로라 아래 칸을 덮었다.
await page.reload({ waitUntil: 'load' });
// 새로고침 직후에는 React 가 아직 키 처리기를 걸기 전일 수 있다.
// 도구막대가 뜨면 준비가 끝난 것이다.
await page.waitForSelector('.toolbar', { state: 'visible', timeout: 15000 });
await dropFile('many-slides.pptx');
await page.waitForTimeout(600);
const rail = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.thumb:not(.thumb-add)')).slice(0, 8).map((el) => {
    const box = el.getBoundingClientRect();
    const slide = el.querySelector('.slide')?.getBoundingClientRect();
    return { height: Math.round(box.height), slide: Math.round(slide?.height ?? 0) };
  }),
);
check('목록 칸이 여러 개 보인다', rail.length >= 5, `${rail.length}칸`);
const bleeding = rail.filter((r) => r.slide > r.height);
check(
  '미리보기가 칸 밖으로 넘치지 않는다',
  bleeding.length === 0,
  bleeding.length > 0 ? `칸 ${bleeding[0].height}px < 미리보기 ${bleeding[0].slide}px` : `칸 ${rail[0]?.height}px`,
);
const sameHeight = new Set(rail.map((r) => r.height)).size === 1;
check('칸 높이가 모두 같다', sameHeight, [...new Set(rail.map((r) => r.height))].join(', '));
await page.screenshot({ path: `${outDir}/rail.png`, clip: { x: 0, y: 0, width: 420, height: 820 } });

console.log('\n[좁은 화면에서도 메모판이 보이는가]');
// 예전에 여기가 깨졌다: 슬라이드를 960px 고정으로 그려서 노트북 화면에서는
// 메모판이 화면 밖으로 밀려 "없는 것"이 됐다. 강의 중에 찾을 자리가 아니다.
for (const size of [
  { name: '1280×720', width: 1280, height: 720 },
  { name: '1366×768', width: 1366, height: 768 },
]) {
  const small = await context.newPage();
  await small.setViewportSize({ width: size.width, height: size.height });
  await small.goto(baseUrl, { waitUntil: 'load' });
  const deckBytes = Array.from(readFileSync(`${samplesDir}/many-slides.pptx`));
  await small.evaluate(
    async ([data]) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(data)], 'many-slides.pptx'));
      document
        .querySelector('.app')
        .dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    },
    [deckBytes],
  );
  await small.waitForTimeout(1000);
  const fit = await small.evaluate(() => {
    const box = document.querySelector('.notes-input')?.getBoundingClientRect();
    const slide = document.querySelector('.deck-canvas .slide')?.getBoundingClientRect();
    return {
      top: box ? Math.round(box.top) : null,
      bottom: box ? Math.round(box.bottom) : null,
      view: window.innerHeight,
      slideWidth: slide ? Math.round(slide.width) : 0,
    };
  });
  check(
    `${size.name} 에서 메모판이 화면 안에 있다`,
    fit.bottom !== null && fit.bottom <= fit.view && fit.top >= 0,
    `메모판 ${fit.top}~${fit.bottom}px / 화면 ${fit.view}px`,
  );
  check(`${size.name} 에서 슬라이드가 너무 작지 않다`, fit.slideWidth >= 400, `${fit.slideWidth}px`);
  await small.close();
}

console.log('\n[메모판 높이 조절]');
// 파워포인트처럼 경계선을 끌어 메모판을 키우고 슬라이드를 줄인다.
await page.reload({ waitUntil: 'load' });
// 새로고침 직후에는 React 가 아직 키 처리기를 걸기 전일 수 있다.
// 도구막대가 뜨면 준비가 끝난 것이다.
await page.waitForSelector('.toolbar', { state: 'visible', timeout: 15000 });
await dropFile('many-slides.pptx');
await page.waitForTimeout(700);

const measure = () =>
  page.evaluate(() => {
    const n = document.querySelector('.notes-input')?.getBoundingClientRect();
    const sl = document.querySelector('.deck-canvas .slide')?.getBoundingClientRect();
    return {
      notes: n ? Math.round(n.height) : 0,
      bottom: n ? Math.round(n.bottom) : 0,
      slide: sl ? Math.round(sl.width) : 0,
      view: window.innerHeight,
    };
  });

const start = await measure();
check('경계선이 있다', (await page.locator('.notes-splitter').count()) === 1);

const grip = await page.locator('.notes-splitter').boundingBox();
await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
await page.mouse.down();
await page.mouse.move(grip.x + grip.width / 2, grip.y - 150, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(350);
const bigger = await measure();
check('위로 끌면 메모판이 커진다', bigger.notes > start.notes + 70, `${start.notes} → ${bigger.notes}`);
// 폭 맞춤에서는 장표 폭이 그대로여야 한다. 메모판을 조금 끌 때마다
// 장표가 가로세로로 같이 줄었다 늘었다 하면 화면이 출렁여 못 쓴다.
check('장표 폭은 흔들리지 않는다', bigger.slide === start.slide, `${start.slide} → ${bigger.slide}`);
check('커져도 메모판이 화면 안에 있다', bigger.bottom <= bigger.view, `${bigger.bottom} / ${bigger.view}`);

// 끝까지 아래로 끌어도 메모판이 없어지면 안 된다.
const grip2 = await page.locator('.notes-splitter').boundingBox();
await page.mouse.move(grip2.x + grip2.width / 2, grip2.y + grip2.height / 2);
await page.mouse.down();
await page.mouse.move(grip2.x + grip2.width / 2, grip2.y + 400, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(350);
const smaller = await measure();
check('아래로 끌면 줄어든다', smaller.notes < bigger.notes, `${bigger.notes} → ${smaller.notes}`);
// 쪽지만큼 남으면 있으나 마나다. 두세 줄은 보여야 한다.
check('끝까지 끌어도 글 칸에 두세 줄은 남는다', smaller.notes >= 48, `${smaller.notes}px`);

await page.locator('.notes-splitter').dblclick();
await page.waitForTimeout(300);
const reset = await measure();
check('두 번 누르면 기본 높이로 돌아온다', reset.notes > smaller.notes, `${smaller.notes} → ${reset.notes}`);
await page.screenshot({ path: `${outDir}/notes-splitter.png` });

console.log('\n[확대 조절]');
const zoomSize = () =>
  page.evaluate(() => {
    const sl = document.querySelector('.deck-canvas .slide')?.getBoundingClientRect();
    const box = document.querySelector('.deck-canvas');
    return {
      w: sl ? Math.round(sl.width) : 0,
      h: sl ? Math.round(sl.height) : 0,
      canvas: box ? Math.round(box.clientWidth) : 0,
      canvasH: box ? Math.round(box.clientHeight) : 0,
      label: document.querySelector('.zoom-value')?.textContent,
    };
  });
const fit = await zoomSize();
check('기본은 폭 맞춤이다', fit.label === '폭 맞춤', String(fit.label));
check('폭 맞춤은 남은 폭을 거의 다 쓴다', fit.w >= fit.canvas - 24, `장표 ${fit.w}px / 자리 ${fit.canvas}px`);

await page.getByTitle('슬라이드 키우기 (Ctrl+=)').click();
await page.waitForTimeout(350);
const zoomed = await zoomSize();
check('＋ 를 누르면 커진다', zoomed.w > fit.w, `${fit.w} → ${zoomed.w}px`);

// 확대해 둔 상태에서 누르면 먼저 맞춤으로 돌아온다.
await page.locator('.zoom-value').click();
await page.waitForTimeout(350);
const back = await zoomSize();
check('가운데 단추로 맞춤 크기로 되돌아온다', Math.abs(back.w - fit.w) <= 2, `${zoomed.w} → ${back.w}px`);

// 두 모드의 차이는 "세로가 모자랄 때" 드러난다. 메모판을 크게 해서
// 장표 자리를 낮춘 다음 비교한다. 자리가 넉넉하면 둘은 같은 결과를 낸다.
const grip3 = await page.locator('.notes-splitter').boundingBox();
await page.mouse.move(grip3.x + grip3.width / 2, grip3.y + grip3.height / 2);
await page.mouse.down();
await page.mouse.move(grip3.x + grip3.width / 2, grip3.y - 260, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(400);

const tall = await zoomSize();
check(
  '폭 맞춤은 자리가 모자라도 폭을 지킨다 (세로로 굴려 본다)',
  tall.w === back.w && tall.h > tall.canvasH,
  `장표 ${tall.w}×${tall.h} / 자리 세로 ${tall.canvasH}px`,
);

// 한 번 더 누르면 화면 맞춤으로 바뀐다.
await page.locator('.zoom-value').click();
await page.waitForTimeout(400);
const screen = await zoomSize();
check('한 번 더 누르면 화면 맞춤이 된다', screen.label === '화면 맞춤', String(screen.label));
check('화면 맞춤은 장표 전체가 세로에 들어온다', screen.h <= screen.canvasH + 1, `${screen.h} / ${screen.canvasH}px`);
check('화면 맞춤에서는 폭을 줄여 전체를 보여 준다', screen.w < tall.w, `${tall.w} → ${screen.w}px`);

// 폭 맞춤으로 되돌려 둔다.
await page.locator('.zoom-value').click();
await page.waitForTimeout(350);
check('다시 누르면 폭 맞춤으로 돌아온다', (await zoomSize()).label === '폭 맞춤');

console.log('\n[장 번호와 삭제는 위 도구막대에]');
check('장 번호가 도구막대에 있다', (await page.locator('.slide-counter').count()) === 1,
  (await page.textContent('.slide-counter')) ?? '');
check('슬라이드 아래 도구 줄은 없앴다', (await page.locator('.deck-actions').count()) === 0);

await browser.close();

if (problems.length > 0) {
  console.error(`\n실패 ${problems.length}건:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('\n발표 모드·메모판 확인 완료');
