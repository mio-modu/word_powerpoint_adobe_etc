/** 테스트용 구형 .hwp 샘플 생성. 합성 파일이지만 스펙대로 조립한 것이다. */
import { writeFileSync } from 'node:fs';
import { writeSyntheticHwp } from '../packages/hwp5/test/fixtures/hwp5-writer.js';

const out = process.argv[2] ?? '.';
const bytes = writeSyntheticHwp({
  previewText: '구형 한글 문서 샘플',
  fonts: ['함초롬바탕', '맑은 고딕'],
  charShapes: [
    { baseSize: 1600, property: 0b10, faceNameId: 1 },
    { baseSize: 1000, property: 0, faceNameId: 0 },
  ],
  paraShapes: [{ align: 3 }, { align: 0 }],
  paragraphs: [
    { text: '구형 한글 문서', paraShapeId: 0, charShapeRuns: [[0, 0]] },
    { text: '이 파일은 HWP 5.0 바이너리입니다.', paraShapeId: 1, charShapeRuns: [[0, 1]] },
    { text: '이름\t점수\t등급', paraShapeId: 1, charShapeRuns: [[0, 1]] },
  ],
});
writeFileSync(`${out}/sample-old.hwp`, bytes);
console.log(`  sample-old.hwp  ${bytes.length.toLocaleString()} bytes`);
