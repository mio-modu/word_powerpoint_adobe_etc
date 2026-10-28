/**
 * 각 포맷의 샘플 파일을 뽑아낸다.
 *
 * 단위 테스트는 "우리가 쓴 걸 우리가 읽을 수 있다"까지만 보장한다.
 * 실제로 다른 오피스 프로그램이 열 수 있는지는 파일을 뽑아 직접 열어봐야
 * 알 수 있다. 이 스크립트가 그 검증용 파일을 만든다.
 *
 *   npx vite-node scripts/emit-samples.mts -- out-dir
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { DocxFile } from '@jamo/docx';
import { HwpxFile } from '@jamo/hwpx';
import { PptxFile } from '@jamo/pptx';

const out = process.argv[2] ?? 'samples';
mkdirSync(out, { recursive: true });

const write = (name: string, bytes: Uint8Array): void => {
  writeFileSync(`${out}/${name}`, bytes);
  console.log(`  ${name}  ${bytes.length.toLocaleString()} bytes`);
};

const docx = DocxFile.blank({ text: '자모 오피스 테스트 문서', title: '검증용' });
docx.setParagraphStyle(docx.paragraphs()[0]!, 'Heading1');
docx.appendParagraph('한글 본문입니다. 가나다라마바사 ABC 123.');
docx.appendParagraph('  앞뒤 공백이 있는 줄  ');
docx.appendParagraph('탭\t구분\t된\t줄');
write('sample.docx', docx.save());

const hwpx = HwpxFile.blank({ text: '한글 문서 제목' });
hwpx.appendParagraph(0, '두 번째 문단입니다.');
hwpx.appendParagraph(0, '세 번째 문단 — 특수문자 & < > " 테스트');
hwpx.setMeta({ title: '자모 테스트', creator: '자모 오피스' });
write('sample.hwpx', hwpx.save());

write('converted-from-hwpx.docx', DocxFile.fromModel(hwpx.toModel()).save());

const pptx = PptxFile.fromOutline(
  [
    { title: '2026 사업계획', bullets: ['매출 목표 30억', '신규 채널 3개', '팀 규모 12명'] },
    { title: '시장 분석', bullets: ['경쟁사 A·B 점유율', '가격 포지셔닝', '리스크 & 대응'] },
    { title: '감사합니다', bullets: [] },
  ],
  { title: '사업계획서', creator: '자모 오피스' },
);
write('sample.pptx', pptx.save());
