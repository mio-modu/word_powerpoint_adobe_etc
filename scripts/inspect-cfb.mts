/**
 * CFB 컨테이너 안을 들여다본다.
 *
 *   npx vite-node scripts/inspect-cfb.mts -- path/to/file.hwp
 *
 * 합성 픽스처만으로는 CFB 리더를 믿을 수 없다. 다른 프로그램이 만든 실제
 * OLE2 파일(.doc, .ppt, .hwp)을 여기에 넣어 확인한다.
 */
import { readFileSync } from 'node:fs';
import { CfbFile, Hwp5File } from '@jamo/hwp5';

const path = process.argv[2];
if (!path) {
  console.error('사용법: inspect-cfb.mts <파일>');
  process.exit(1);
}

const bytes = new Uint8Array(readFileSync(path));
if (!CfbFile.looksLikeCfb(bytes)) {
  console.error('CFB(OLE2) 컨테이너가 아닙니다.');
  process.exit(2);
}

const cfb = CfbFile.open(bytes);
console.log(`${path}  (${bytes.length.toLocaleString()} bytes)`);
console.log('스트림 목록:');
let total = 0;
for (const entry of cfb.list()) {
  const read = entry.type === 'stream' ? cfb.read(entry.path) : undefined;
  const actual = read?.byteLength ?? 0;
  if (entry.type === 'stream') total += actual;
  const mark = entry.type === 'stream' && actual !== entry.size ? '  ← 크기 불일치!' : '';
  console.log(
    `  [${entry.type.padEnd(7)}] ${entry.path.padEnd(34)} ${String(entry.size).padStart(9)}` +
      ` 읽음=${String(actual).padStart(9)}${mark}`,
  );
}
console.log(`읽어낸 바이트 합계: ${total.toLocaleString()}`);

if (Hwp5File.looksLikeHwp5(bytes)) {
  const hwp = Hwp5File.open(bytes);
  console.log(`\nHWP 5.0 문서 — 버전 ${hwp.header.version}, 압축=${hwp.header.compressed}`);
  console.log(`섹션 ${hwp.sectionCount}개, 글꼴 ${hwp.faceNames.length}종, 글자모양 ${hwp.charShapes.length}개`);
  const text = hwp.getText();
  console.log(`\n본문 ${text.length}자 중 앞부분:`);
  console.log(text.slice(0, 600));
}
