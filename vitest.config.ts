import { defineConfig } from 'vitest/config';

const pkg = (name: string): string =>
  new URL(`./packages/${name}/src/index.ts`, import.meta.url).pathname;

export default defineConfig({
  test: {
    // 앱 쪽에도 단위 테스트가 있다 (단축키 표처럼 브라우저가 필요 없는 것들).
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@jamo/core': pkg('core'),
      '@jamo/opc': pkg('opc'),
      '@jamo/hwpx': pkg('hwpx'),
      '@jamo/hwp5': pkg('hwp5'),
      '@jamo/docx': pkg('docx'),
      '@jamo/pptx': pkg('pptx'),
    },
  },
});
