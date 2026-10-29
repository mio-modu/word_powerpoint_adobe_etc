import { defineConfig } from 'vitest/config';

const pkg = (name: string): string =>
  new URL(`./packages/${name}/src/index.ts`, import.meta.url).pathname;

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
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
