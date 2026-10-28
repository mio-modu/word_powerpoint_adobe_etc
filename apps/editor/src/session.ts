import { useCallback, useMemo, useRef, useState } from 'react';
import type { JamoPresentation, JamoTextDocument, XmlElement } from '@jamo/core';
import { DocxFile } from '@jamo/docx';
import { Hwp5File } from '@jamo/hwp5';
import { HwpxFile } from '@jamo/hwpx';
import { PptxFile } from '@jamo/pptx';
import {
  EXTENSION,
  isWritable,
  openDocument,
  type DocumentKind,
  type OpenedDocument,
} from './lib/formats.js';
import { pickFile, replaceExtension, saveAs, writeToHandle } from './lib/fs.js';

/**
 * 편집 세션.
 *
 * 진실의 원천은 엔진 객체(HwpxFile 등)다. 화면은 거기서 뽑아낸 모델을
 * 그릴 뿐이고, 편집은 엔진을 직접 고친 다음 `revision` 을 올려 다시 뽑는다.
 *
 * 이렇게 하는 이유: 모델을 진실로 두면 저장할 때 모델을 다시 XML 로
 * 조립해야 하고, 그 과정에서 우리가 모델링하지 않은 것들이 사라진다.
 * 엔진을 제자리에서 고치면 표·이미지·테마가 그대로 남는다.
 */

export interface SessionState {
  kind: DocumentKind;
  name: string;
  dirty: boolean;
  /** 열었던 파일에 덮어쓸 수 있는지. */
  canSaveInPlace: boolean;
  readOnly: boolean;
}

export interface SessionApi {
  state: SessionState | undefined;
  error: string | undefined;
  busy: boolean;
  /** 워드프로세서 문서일 때의 내용. */
  textDocument: JamoTextDocument | undefined;
  /** 프레젠테이션일 때의 내용. */
  presentation: JamoPresentation | undefined;

  open: () => Promise<void>;
  openFromData: (name: string, data: Uint8Array) => void;
  createNew: (kind: 'hwpx' | 'docx' | 'pptx') => void;
  close: () => void;

  save: () => Promise<void>;
  saveAsFormat: (kind: 'hwpx' | 'docx' | 'pptx') => Promise<void>;

  setParagraphText: (source: unknown, text: string) => void;
  addParagraph: (afterSource: unknown | undefined, text: string) => void;
  removeParagraph: (source: unknown) => void;

  setShapeText: (source: unknown, lines: string[]) => void;
  addSlide: () => void;
  removeSlide: (index: number) => void;

  /** 구형 .hwp 를 편집 가능한 .hwpx 로 바꿔 세션을 잇는다. */
  convertForEditing: () => void;
}

export function useSession(): SessionApi {
  const docRef = useRef<OpenedDocument | undefined>(undefined);
  const handleRef = useRef<FileSystemFileHandle | undefined>(undefined);
  const [state, setState] = useState<SessionState | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);

  const touch = useCallback((dirty = true) => {
    setRevision((r) => r + 1);
    setState((s) => (s ? { ...s, dirty: dirty || s.dirty } : s));
  }, []);

  const adopt = useCallback(
    (doc: OpenedDocument, name: string, handle: FileSystemFileHandle | undefined, dirty: boolean) => {
      docRef.current = doc;
      handleRef.current = handle;
      setState({
        kind: doc.kind,
        name,
        dirty,
        canSaveInPlace: handle !== undefined && isWritable(doc.kind),
        readOnly: !isWritable(doc.kind),
      });
      setError(undefined);
      setRevision((r) => r + 1);
    },
    [],
  );

  const openFromData = useCallback(
    (name: string, data: Uint8Array) => {
      try {
        adopt(openDocument(data), name, undefined, false);
      } catch (cause) {
        setError((cause as Error).message);
      }
    },
    [adopt],
  );

  const open = useCallback(async () => {
    setBusy(true);
    try {
      const picked = await pickFile();
      if (!picked) return;
      try {
        adopt(openDocument(picked.data), picked.name, picked.handle, false);
      } catch (cause) {
        setError((cause as Error).message);
      }
    } finally {
      setBusy(false);
    }
  }, [adopt]);

  const createNew = useCallback(
    (kind: 'hwpx' | 'docx' | 'pptx') => {
      const made: OpenedDocument =
        kind === 'hwpx'
          ? { kind, file: HwpxFile.blank({ text: '' }) }
          : kind === 'docx'
            ? { kind, file: DocxFile.blank({ text: '' }) }
            : { kind, file: PptxFile.blank() };
      adopt(made, `제목 없음${EXTENSION[kind]}`, undefined, true);
    },
    [adopt],
  );

  const close = useCallback(() => {
    docRef.current = undefined;
    handleRef.current = undefined;
    setState(undefined);
    setError(undefined);
  }, []);

  const serialize = useCallback((): Uint8Array | undefined => {
    const doc = docRef.current;
    if (!doc || doc.kind === 'hwp5') return undefined;
    return doc.file.save();
  }, []);

  const save = useCallback(async () => {
    const doc = docRef.current;
    const current = state;
    if (!doc || !current || doc.kind === 'hwp5') return;
    setBusy(true);
    try {
      const data = serialize();
      if (!data) return;
      const handle = handleRef.current;
      if (handle && (await writeToHandle(handle, data))) {
        setState((s) => (s ? { ...s, dirty: false } : s));
        return;
      }
      const newHandle = await saveAs(data, current.name, doc.kind);
      if (newHandle) handleRef.current = newHandle;
      setState((s) =>
        s ? { ...s, dirty: false, canSaveInPlace: newHandle !== undefined } : s,
      );
    } catch (cause) {
      setError(`저장하지 못했습니다: ${(cause as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [serialize, state]);

  const saveAsFormat = useCallback(
    async (kind: 'hwpx' | 'docx' | 'pptx') => {
      const doc = docRef.current;
      const current = state;
      if (!doc || !current) return;
      setBusy(true);
      try {
        const data = exportAs(doc, kind);
        const name = replaceExtension(current.name, EXTENSION[kind]);
        await saveAs(data, name, kind);
      } catch (cause) {
        setError(`변환하지 못했습니다: ${(cause as Error).message}`);
      } finally {
        setBusy(false);
      }
    },
    [state],
  );

  const convertForEditing = useCallback(() => {
    const doc = docRef.current;
    const current = state;
    if (!doc || doc.kind !== 'hwp5' || !current) return;
    try {
      const converted = HwpxFile.fromModel(doc.file.toModel());
      adopt(
        { kind: 'hwpx', file: converted },
        replaceExtension(current.name, '.hwpx'),
        undefined,
        true,
      );
    } catch (cause) {
      setError(`변환하지 못했습니다: ${(cause as Error).message}`);
    }
  }, [adopt, state]);

  // ------------------------------------------------------------------- 편집

  const setParagraphText = useCallback(
    (source: unknown, text: string) => {
      const doc = docRef.current;
      if (!doc || !isXmlElement(source)) return;
      if (doc.kind === 'hwpx') doc.file.setParagraphText(source, text);
      else if (doc.kind === 'docx') doc.file.setParagraphText(source, text);
      else return;
      touch();
    },
    [touch],
  );

  const addParagraph = useCallback(
    (afterSource: unknown | undefined, text: string) => {
      const doc = docRef.current;
      if (!doc) return;
      if (doc.kind === 'hwpx') {
        if (isXmlElement(afterSource)) doc.file.insertParagraphAfter(0, afterSource, text);
        else doc.file.appendParagraph(0, text);
      } else if (doc.kind === 'docx') {
        if (isXmlElement(afterSource)) doc.file.insertParagraphAfter(afterSource, text);
        else doc.file.appendParagraph(text);
      } else return;
      touch();
    },
    [touch],
  );

  const removeParagraph = useCallback(
    (source: unknown) => {
      const doc = docRef.current;
      if (!doc || !isXmlElement(source)) return;
      if (doc.kind === 'hwpx') doc.file.removeParagraph(0, source);
      else if (doc.kind === 'docx') doc.file.removeParagraph(source);
      else return;
      touch();
    },
    [touch],
  );

  const setShapeText = useCallback(
    (source: unknown, lines: string[]) => {
      const doc = docRef.current;
      if (!doc || doc.kind !== 'pptx' || !isXmlElement(source)) return;
      PptxFile.setShapeText(source, lines);
      touch();
    },
    [touch],
  );

  const addSlide = useCallback(() => {
    const doc = docRef.current;
    if (!doc || doc.kind !== 'pptx') return;
    doc.file.addTitleSlide('새 슬라이드', ['내용을 입력하세요']);
    touch();
  }, [touch]);

  const removeSlide = useCallback(
    (index: number) => {
      const doc = docRef.current;
      if (!doc || doc.kind !== 'pptx') return;
      doc.file.removeSlide(index);
      touch();
    },
    [touch],
  );

  // ----------------------------------------------------------------- 뷰 모델

  const { textDocument, presentation } = useMemo(() => {
    const doc = docRef.current;
    if (!doc) return { textDocument: undefined, presentation: undefined };
    try {
      if (doc.kind === 'pptx') {
        return { textDocument: undefined, presentation: doc.file.toModel() };
      }
      return { textDocument: doc.file.toModel(), presentation: undefined };
    } catch (cause) {
      setError(`문서를 표시할 수 없습니다: ${(cause as Error).message}`);
      return { textDocument: undefined, presentation: undefined };
    }
    // revision 이 바뀔 때마다 엔진에서 다시 뽑는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);

  return {
    state,
    error,
    busy,
    textDocument,
    presentation,
    open,
    openFromData,
    createNew,
    close,
    save,
    saveAsFormat,
    setParagraphText,
    addParagraph,
    removeParagraph,
    setShapeText,
    addSlide,
    removeSlide,
    convertForEditing,
  };
}

/** 어떤 포맷이든 원하는 포맷의 바이트로 내보낸다. */
function exportAs(doc: OpenedDocument, target: 'hwpx' | 'docx' | 'pptx'): Uint8Array {
  if (doc.kind === target) return (doc.file as HwpxFile | DocxFile | PptxFile).save();

  if (target === 'pptx') {
    // 문서 → 슬라이드: 문단을 제목/본문으로 묶어 장을 만든다.
    const model = doc.kind === 'pptx' ? undefined : doc.file.toModel();
    if (!model) throw new Error('변환할 내용이 없습니다');
    const lines = model.sections
      .flatMap((s) => s.paragraphs)
      .map((p) => p.runs.map((r) => r.text).join(''))
      .filter((t) => t.trim() !== '');
    const outline: Array<{ title: string; bullets: string[] }> = [];
    for (const line of lines) {
      // 긴 줄은 본문, 짧은 줄은 새 장의 제목으로 본다. 완벽하진 않지만
      // 개요를 손으로 다시 짜는 수고를 줄여 준다.
      if (line.length <= 30 || outline.length === 0) outline.push({ title: line, bullets: [] });
      else outline[outline.length - 1]!.bullets.push(line);
    }
    return PptxFile.fromOutline(outline.length > 0 ? outline : [{ title: '빈 문서', bullets: [] }], {
      title: model.meta.title,
    }).save();
  }

  if (doc.kind === 'pptx') {
    // 슬라이드 → 문서: 장별로 문단을 늘어놓는다.
    const deck = doc.file.toModel();
    const paragraphs = deck.slides.flatMap((slide, i) => [
      { runs: [{ text: `슬라이드 ${i + 1}`, style: { bold: true, fontSize: 14 } }] },
      ...slide.shapes.flatMap((sh) => sh.paragraphs),
    ]);
    const model = {
      kind: 'text' as const,
      meta: deck.meta,
      sections: [{ page: emptyPage(), paragraphs }],
    };
    return target === 'hwpx'
      ? HwpxFile.fromModel(model).save()
      : DocxFile.fromModel(model).save();
  }

  const model = doc.file.toModel();
  return target === 'hwpx' ? HwpxFile.fromModel(model).save() : DocxFile.fromModel(model).save();
}

function emptyPage() {
  return {
    width: 59528,
    height: 84188,
    landscape: false,
    margin: { left: 8504, right: 8504, top: 5668, bottom: 4252, header: 4252, footer: 4252, gutter: 0 },
  };
}

function isXmlElement(value: unknown): value is XmlElement {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'element'
  );
}

export { Hwp5File };
