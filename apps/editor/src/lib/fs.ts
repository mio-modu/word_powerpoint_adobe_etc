import { EXTENSION, MIME_TYPE, type DocumentKind } from './formats.js';

/**
 * 파일 열기/저장.
 *
 * File System Access API 를 쓸 수 있으면 **열었던 파일에 그대로 덮어쓴다**.
 * 이게 있어야 "프로그램" 처럼 쓸 수 있다 — 고치고 Ctrl+S 하면 끝.
 * 지원하지 않는 브라우저(파이어폭스, 사파리)에서는 내려받기로 떨어진다.
 */

type FsHandle = FileSystemFileHandle;

interface PickerType {
  description: string;
  accept: Record<string, string[]>;
}

declare global {
  interface Window {
    showOpenFilePicker?: (options?: {
      multiple?: boolean;
      types?: PickerType[];
    }) => Promise<FsHandle[]>;
    showSaveFilePicker?: (options?: {
      suggestedName?: string;
      types?: PickerType[];
    }) => Promise<FsHandle>;
  }
}

export function supportsFileSystemAccess(): boolean {
  return typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';
}

const OPEN_TYPES: PickerType[] = [
  {
    description: '문서 파일',
    accept: {
      'application/octet-stream': ['.hwp', '.hwpx', '.docx', '.pptx'],
    },
  },
];

export interface PickedFile {
  name: string;
  data: Uint8Array;
  handle?: FsHandle;
}

/** 파일 선택 대화상자. 핸들을 받아오면 나중에 제자리 저장이 가능하다. */
export async function pickFile(): Promise<PickedFile | undefined> {
  if (window.showOpenFilePicker) {
    let handles: FsHandle[];
    try {
      handles = await window.showOpenFilePicker({ multiple: false, types: OPEN_TYPES });
    } catch {
      return undefined; // 사용자가 취소
    }
    const handle = handles[0];
    if (!handle) return undefined;
    const file = await handle.getFile();
    return { name: file.name, data: new Uint8Array(await file.arrayBuffer()), handle };
  }

  // 폴백: 숨은 input[type=file]
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.hwp,.hwpx,.docx,.pptx';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(undefined);
        return;
      }
      void file.arrayBuffer().then((buffer) => {
        resolve({ name: file.name, data: new Uint8Array(buffer) });
      });
    });
    // 취소를 감지할 표준 방법이 없다. 창이 다시 focus 되면 취소로 본다.
    input.click();
  });
}

/** 핸들이 있으면 그 파일에 덮어쓴다. 성공하면 true. */
export async function writeToHandle(handle: FsHandle, data: Uint8Array): Promise<boolean> {
  try {
    const writable = await handle.createWritable();
    await writable.write(data as unknown as BufferSource);
    await writable.close();
    return true;
  } catch {
    return false;
  }
}

/** 다른 이름으로 저장. 핸들을 돌려주면 이후 제자리 저장에 쓸 수 있다. */
export async function saveAs(
  data: Uint8Array,
  suggestedName: string,
  kind: DocumentKind,
): Promise<FsHandle | undefined> {
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [
          {
            description: suggestedName,
            accept: { [MIME_TYPE[kind]]: [EXTENSION[kind]] },
          },
        ],
      });
      await writeToHandle(handle, data);
      return handle;
    } catch {
      return undefined; // 취소
    }
  }
  downloadBlob(data, suggestedName, MIME_TYPE[kind]);
  return undefined;
}

export function downloadBlob(data: Uint8Array, filename: string, mimeType: string): void {
  const blob = new Blob([data as unknown as BlobPart], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // 즉시 해제하면 일부 브라우저에서 내려받기가 끊긴다.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** `보고서.hwp` + `.hwpx` → `보고서.hwpx` */
export function replaceExtension(filename: string, extension: string): string {
  const i = filename.lastIndexOf('.');
  const base = i > 0 ? filename.slice(0, i) : filename;
  return `${base}${extension}`;
}
