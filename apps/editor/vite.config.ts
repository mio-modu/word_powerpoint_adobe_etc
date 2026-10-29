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
    // 한 덩어리로 묶는다. 쪼개 봐야 파일 하나로 합칠 때 되돌려야 하고,
    // 전체가 87KB(gzip)라 나눌 이유가 없다.
    chunkSizeWarningLimit: 1500,
    modulePreload: false,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        // ES 모듈이 아니라 고전 스크립트로 내보낸다. 브라우저가 file:// 에서
        // 외부 모듈 스크립트를 CORS 로 막기 때문에, 단일 HTML 파일로 합쳤을 때
        // 모듈 형식이면 열리지 않는다.
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
