import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@jamo/core': new URL('./packages/core/src/index.ts', import.meta.url).pathname,
      '@jamo/hwpx': new URL('./packages/hwpx/src/index.ts', import.meta.url).pathname,
      '@jamo/hwp5': new URL('./packages/hwp5/src/index.ts', import.meta.url).pathname,
    },
  },
});
