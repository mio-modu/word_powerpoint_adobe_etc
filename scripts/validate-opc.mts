/**
 * OOXML 패키지 구조 검사 — 명령줄 도구.
 *
 * 검사 내용은 @jamo/opc 의 validatePackage 에 있다. 앱도 저장 직전에
 * 같은 함수를 쓴다.
 *
 *   npx vite-node scripts/validate-opc.mts -- <파일.pptx|docx> [...]
 */
import { readFileSync } from 'node:fs';
import { validatePackage } from '@jamo/opc';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('검사할 파일을 적어 주세요.');
  process.exit(2);
}

let bad = 0;
for (const file of files) {
  const findings = validatePackage(readFileSync(file));
  const errors = findings.filter((f) => f.kind === 'error');
  console.log(`\n${file}`);
  if (findings.length === 0) console.log('  ✓ 구조에 문제가 없습니다');
  for (const f of findings) {
    console.log(`  ${f.kind === 'error' ? '✗' : '!'} [${f.where}] ${f.what}`);
  }
  if (errors.length > 0) bad += 1;
}
process.exit(bad === 0 ? 0 : 1);
