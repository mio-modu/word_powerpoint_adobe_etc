import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const pkg = (name: string): string =>
  new URL(`../../packages/${name}/src/index.ts`, import.meta.url).pathname;

// 빌드한 날짜·시각(한국 기준). 화면 왼쪽 위에 박아 둔다.
//
// 왜 필요한가: 파일 하나로 받아 쓰면 "지금 내가 여는 게 몇 번째 판인지"
// 알 길이 없다. 고쳐 보냈는데 옛 파일을 계속 열면서 "안 고쳐졌다"고
// 보게 되는 일이 실제로 있었다. 눈에 보여야 확인할 수 있다.
const buildStamp = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: '2-digit',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})
  .format(new Date())
  .replace(/\s/g, '');

export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    __BUILD__: JSON.stringify(buildStamp),
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
