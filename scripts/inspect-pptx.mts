/**
 * 슬라이드를 우리 엔진이 어떻게 읽는지 들여다본다.
 *
 * 텍스트만 나오는지, 배경·색·도형까지 나오는지 눈으로 확인하려고 만들었다.
 *
 *   npx vite-node scripts/inspect-pptx.mts -- 파일.pptx [슬라이드번호]
 */
import { readFileSync } from 'node:fs';
import { PptxFile } from '@jamo/pptx';
import { hwpunit } from '@jamo/core';

const path = process.argv[2]!;
const only = process.argv[3] ? Number(process.argv[3]) : undefined;
const file = PptxFile.open(new Uint8Array(readFileSync(path)));
const model = file.toModel();

const mm = (v: number): string => `${hwpunit.toMm(v).toFixed(0)}mm`;
console.log(`${path}`);
console.log(`슬라이드 ${model.slides.length}장, 크기 ${mm(model.slideSize.width)} × ${mm(model.slideSize.height)}`);

const theme = file.themeFor(file.masterPartOf(file.layoutPartOf(0)));
console.log('\n테마 색:');
for (const [k, v] of theme.scheme) console.log(`  ${k.padEnd(10)} ${v}`);
console.log('clrMap:', [...theme.map].map(([k, v]) => `${k}→${v}`).join(' '));
console.log('테마 글꼴:', theme.majorFont, '/', theme.minorFont);

model.slides.forEach((slide, i) => {
  if (only !== undefined && i + 1 !== only) return;
  console.log(`\n── 슬라이드 ${i + 1} ──`);
  console.log('  배경:', slide.background ? JSON.stringify(slide.background) : '(없음)');
  console.log(`  도형 ${slide.shapes.length}개`);
  for (const shape of slide.shapes) {
    const f = shape.frame;
    const where = f ? `${mm(f.x)},${mm(f.y)} ${mm(f.width)}×${mm(f.height)}` : '자리없음';
    const bits: string[] = [];
    if (shape.placeholder) bits.push(`자리=${shape.placeholder}`);
    if (shape.image) bits.push(`그림=${shape.image.part}`);
    if (shape.table) bits.push(`표=${shape.table.rows.length}줄`);
    if (shape.fill) bits.push(`채움=${shape.fill.type}${shape.fill.color ? ':' + shape.fill.color : ''}`);
    if (shape.line?.color) bits.push(`선=${shape.line.color}`);
    if (shape.anchor) bits.push(`세로=${shape.anchor}`);
    const text = shape.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join(' / ');
    console.log(`  · ${(shape.name ?? '').slice(0, 22).padEnd(22)} ${where.padEnd(26)} ${bits.join(' ')}`);
    if (text.trim()) {
      const style = shape.paragraphs[0]?.runs[0]?.style;
      console.log(`      "${text.slice(0, 60)}"`);
      console.log(`      서식: ${JSON.stringify(style)}`);
    }
  }
});
