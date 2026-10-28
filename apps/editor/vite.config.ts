import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const pkg = (name: string): string =>
  new URL(`../../packages/${name}/src/index.ts`, import.meta.url).pathname;

export default defineConfig({
  plugins: [react()],
  base: './',
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
  build: {
    // 통째로 내려받아 오프라인으로 쓰기 좋게 한 덩어리로 묶는다.
    chunkSizeWarningLimit: 1500,
  },
});
