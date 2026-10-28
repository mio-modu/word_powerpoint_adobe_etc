/**
 * 한글이 만든 진짜 .hwpx 파일로 엔진을 검증한다.
 *
 * 단위 테스트는 "우리가 쓴 걸 우리가 읽는다"까지만 보장한다. 한컴오피스가
 * 실제로 뱉은 파일을 열고, 손대지 않고 저장했을 때 바이트까지 같은지,
 * 고친 뒤에도 나머지가 남는지는 진짜 파일로만 확인할 수 있다.
 *
 *   npx vite-node scripts/verify-real-file.mts -- 어떤문서.hwpx
 *
 * 저장소에는 실제 파일을 넣지 않았다. 남의 저작물이기도 하고, 각자 손에 있는
 * 문서로 확인하는 편이 더 의미 있다. 한글에서 아무 문서나 .hwpx 로 저장해
 * 이 스크립트에 넘기면 된다.
 */
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { HwpxFile } from '@jamo/hwpx';
import { DocxFile } from '@jamo/docx';
import { parseXml, serializeXml, isTable, isParagraph } from '@jamo/core';

const path = process.argv[2]!;
const bytes = new Uint8Array(readFileSync(path));
let fails = 0;
const ok = (label: string, pass: boolean, detail = '') => {
  console.log(`${pass ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) fails += 1;
};

console.log('[1] 한글이 만든 진짜 파일을 우리 리더로 연다');
const file = HwpxFile.open(bytes);
ok('열린다', true);
ok('섹션을 찾는다', file.sectionCount >= 1, `${file.sectionCount}개`);
const tables = file.styles;
ok('글꼴 표를 읽는다', tables.fonts.size > 0, `언어그룹 ${tables.fonts.size}종`);
ok('charPr 표를 읽는다', tables.charPr.size > 0, `${tables.charPr.size}개`);
ok('paraPr 표를 읽는다', tables.paraPr.size > 0, `${tables.paraPr.size}개`);
ok('스타일 표를 읽는다', tables.styles.size > 0, `${tables.styles.size}개`);
const hangulFonts = [...(tables.fonts.get('HANGUL')?.values() ?? [])].map((f) => f.face);
console.log('      한글 글꼴:', hangulFonts.slice(0, 6).join(', '));
const styleNames = [...tables.styles.values()]
  .map((s) => s.attrs.find((a) => a.name === 'name')?.value)
  .filter(Boolean);
console.log('      스타일:', styleNames.slice(0, 8).join(', '));

console.log('\n[2] 모델로 바꾼다');
const model = file.toModel();
const blocks = model.sections[0]!.blocks;
ok('블록을 뽑는다', blocks.length > 0, `${blocks.length}개 (문단 ${blocks.filter(isParagraph).length}, 표 ${blocks.filter(isTable).length})`);
const page = model.sections[0]!.page;
ok('용지 설정을 읽는다', page.width > 0 && page.height > 0, `${page.width}×${page.height} HWPUNIT (A4=59528×84188)`);
console.log('      여백:', JSON.stringify(page.margin));

console.log('\n[3] 손대지 않고 저장했을 때 내용이 보존되는가');
const resaved = file.save();
const original = unzipSync(bytes);
const after = unzipSync(resaved);
const originalNames = Object.keys(original).sort();
const afterNames = Object.keys(after).sort();
ok('모든 파트가 남는다', JSON.stringify(originalNames) === JSON.stringify(afterNames),
   `${originalNames.length}개 → ${afterNames.length}개`);

// 우리가 해석하지 않는 파트는 바이트가 똑같아야 한다.
const untouched = ['Preview/PrvImage.png', 'Preview/PrvText.txt', 'META-INF/container.rdf'];
for (const name of untouched) {
  if (!original[name]) continue;
  const same = Buffer.compare(Buffer.from(original[name]!), Buffer.from(after[name]!)) === 0;
  ok(`${name} 바이트 그대로`, same);
}

// XML 파트는 파싱→직렬화를 거치므로, 다시 파싱해 구조가 같은지 본다.
for (const name of originalNames.filter((n) => n.endsWith('.xml') || n.endsWith('.hpf'))) {
  const a = strFromU8(original[name]!);
  const b = strFromU8(after[name]!);
  const same = a === b;
  if (same) { ok(`${name} 바이트까지 동일`, true); continue; }
  // 바이트가 달라도 구조가 같으면 괜찮다 (선언부 공백 등).
  const reA = serializeXml(parseXml(a));
  const reB = serializeXml(parseXml(b));
  ok(`${name} 구조 동일`, reA === reB, same ? '' : `길이 ${a.length} → ${b.length}`);
}

console.log('\n[4] 다시 열 수 있는가 (왕복)');
const reopened = HwpxFile.open(resaved);
ok('다시 열린다', true);
ok('본문이 같다', reopened.getText() === file.getText());
ok('스타일 수가 같다', reopened.styles.charPr.size === tables.charPr.size);

console.log('\n[4b] 한글이 만든 표를 제대로 읽는가');
const realTables = blocks.filter(isTable);
if (realTables.length === 0) {
  console.log('      (이 문서에는 표가 없습니다)');
} else {
  ok('표를 찾는다', true, `${realTables.length}개`);
  realTables.forEach((t, i) => {
    const cols = Math.max(...t.rows.map((r) => r.cells.length));
    console.log(`      표 ${i + 1}: ${t.rows.length}줄 × ${cols}칸, 폭 ${t.width ?? '?'} HWPUNIT`);
    const merged = t.rows.flatMap((r) => r.cells).filter((c) => c.colSpan > 1 || c.rowSpan > 1);
    if (merged.length > 0) {
      console.log(`         병합된 셀 ${merged.length}개 — 예: ${merged[0]!.colSpan}×${merged[0]!.rowSpan}`);
    }
    const sample = t.rows
      .slice(0, 2)
      .map((r) => r.cells.map((c) => c.paragraphs.map((p) => p.runs.map((x) => x.text).join('')).join('')).map((x) => x || '·').join(' | '));
    for (const line of sample) console.log('        ', line);
  });
  ok('셀 주소가 격자와 맞는다', realTables.every((t) =>
    t.rows.every((r, ri) => r.cells.every((c) => c.rowAddr === ri))));
}

console.log('\n[5] 실제 편집 시나리오 — 글자 고치고 표 넣고 저장');
const edited = HwpxFile.open(bytes);
const paras = edited.paragraphs(0);
edited.setParagraphText(paras[0]!.element, '한글이 만든 파일을 자모에서 고쳤습니다');
edited.setParagraphRunStyle(paras[0]!.element, { bold: true, fontSize: 14 });
edited.insertTable(0, 2, 3, { text: [['항목', '목표', '실적'], ['매출', '30억', '32억']] });
const editedBytes = edited.save();
const check = HwpxFile.open(editedBytes);
ok('고친 글자가 남는다', check.getText().includes('자모에서 고쳤습니다'));
ok('넣은 표가 남는다', check.getText().includes('항목\t목표\t실적'));
const editedBlocks = check.toModel().sections[0]!.blocks;
ok('표가 블록으로 잡힌다', editedBlocks.some(isTable));
const firstPara = editedBlocks.find(isParagraph)!;
ok('서식이 남는다', firstPara.runs[0]!.style?.bold === true, JSON.stringify(firstPara.runs[0]!.style));
// 한글이 넣어둔 미리보기 이미지는 그대로여야 한다.
const editedZip = unzipSync(editedBytes);
ok('편집 후에도 미리보기 이미지 보존',
   Buffer.compare(Buffer.from(original['Preview/PrvImage.png']!), Buffer.from(editedZip['Preview/PrvImage.png']!)) === 0);

console.log('\n[6] 한글 파일 → 워드 변환');
const docx = DocxFile.open(DocxFile.fromModel(edited.toModel()).save());
ok('DOCX 로 변환된다', docx.getText().includes('자모에서 고쳤습니다'));
ok('표도 넘어간다', docx.tables().length >= 1, `${docx.tables().length}개`);

console.log(fails === 0 ? '\n전부 통과' : `\n실패 ${fails}건`);
process.exit(fails === 0 ? 0 : 1);
