import { looksLikeCfb, looksLikeZip } from '@jamo/core';
import { DocxFile } from '@jamo/docx';
import { Hwp5File } from '@jamo/hwp5';
import { HwpxFile } from '@jamo/hwpx';
import { PptxFile } from '@jamo/pptx';

/**
 * 파일 종류 판별과 열기.
 *
 * 확장자는 믿지 않는다. 사용자가 `.hwp` 로 저장한 hwpx, `.docx` 로 저장한
 * pptx 가 실제로 돌아다닌다. 앞부분 바이트와 내부 구조를 보고 정한다.
 */

export type DocumentKind = 'hwpx' | 'hwp5' | 'docx' | 'pptx';

export type OpenedDocument =
  | { kind: 'hwpx'; file: HwpxFile }
  | { kind: 'hwp5'; file: Hwp5File }
  | { kind: 'docx'; file: DocxFile }
  | { kind: 'pptx'; file: PptxFile };

export const KIND_LABEL: Record<DocumentKind, string> = {
  hwpx: '한글 문서 (.hwpx)',
  hwp5: '한글 문서 — 구형 (.hwp)',
  docx: '워드 문서 (.docx)',
  pptx: '파워포인트 (.pptx)',
};

/** 편집 후 저장할 수 있는 형식인지. 구형 .hwp 는 읽기만 된다. */
export function isWritable(kind: DocumentKind): boolean {
  return kind !== 'hwp5';
}

export class UnsupportedFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedFileError';
  }
}

export function detectKind(data: Uint8Array): DocumentKind {
  if (looksLikeCfb(data)) {
    if (Hwp5File.looksLikeHwp5(data)) return 'hwp5';
    throw new UnsupportedFileError(
      '구형 바이너리 파일(.doc / .ppt / .xls)입니다. 아직 지원하지 않습니다. ' +
        '한글이나 워드에서 .hwpx / .docx 로 저장한 뒤 열어 주세요.',
    );
  }
  if (!looksLikeZip(data)) {
    throw new UnsupportedFileError('알 수 없는 형식입니다. hwp, hwpx, docx, pptx 를 지원합니다.');
  }

  // ZIP 계열은 안을 봐야 구분된다. 가장 가벼운 순서로 시도한다.
  const errors: string[] = [];
  for (const [kind, probe] of [
    ['hwpx', () => HwpxFile.open(data)],
    ['docx', () => DocxFile.open(data)],
    ['pptx', () => PptxFile.open(data)],
  ] as const) {
    try {
      probe();
      return kind;
    } catch (cause) {
      errors.push(`${kind}: ${(cause as Error).message}`);
    }
  }
  throw new UnsupportedFileError(
    `ZIP 파일이지만 지원하는 문서가 아닙니다.\n${errors.join('\n')}`,
  );
}

export function openDocument(data: Uint8Array): OpenedDocument {
  const kind = detectKind(data);
  switch (kind) {
    case 'hwpx':
      return { kind, file: HwpxFile.open(data) };
    case 'hwp5':
      return { kind, file: Hwp5File.open(data) };
    case 'docx':
      return { kind, file: DocxFile.open(data) };
    case 'pptx':
      return { kind, file: PptxFile.open(data) };
  }
}

export const EXTENSION: Record<DocumentKind, string> = {
  hwpx: '.hwpx',
  hwp5: '.hwp',
  docx: '.docx',
  pptx: '.pptx',
};

export const MIME_TYPE: Record<DocumentKind, string> = {
  hwpx: 'application/hwp+zip',
  hwp5: 'application/x-hwp',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
