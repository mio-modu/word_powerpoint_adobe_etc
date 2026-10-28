import { defineConfig } from 'vite';

const pkg = (name: string): string =>
  new URL(`./packages/${name}/src/index.ts`, import.meta.url).pathname;

/**
 * 워크스페이스 패키지를 소스에서 바로 쓰도록 하는 공용 별칭.
 * 빌드 단계를 끼우지 않아 수정 즉시 반영된다.
 */
export const jamoAliases = {
  '@jamo/core': pkg('core'),
  '@jamo/opc': pkg('opc'),
  '@jamo/hwpx': pkg('hwpx'),
  '@jamo/hwp5': pkg('hwp5'),
  '@jamo/docx': pkg('docx'),
  '@jamo/pptx': pkg('pptx'),
};

export default defineConfig({
  resolve: { alias: jamoAliases },
});
