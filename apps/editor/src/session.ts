import { useCallback, useMemo, useRef, useState } from 'react';
import type {
  CharStyle,
  JamoPresentation,
  JamoTextDocument,
  ParagraphStyle,
  XmlElement,
} from '@jamo/core';
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
  canSaveInPlace: boolean;
  readOnly: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

/** 지금 커서가 놓인 곳. 서식·표 명령이 어디에 적용될지 결정한다. */
export interface Focus {
  /** 문단 요소 (표 셀 안의 문단도 포함). */
  paragraph?: XmlElement;
  /** 표 안이라면 그 표와 위치. */
  table?: XmlElement;
  row?: number;
  column?: number;
  /**
   * 셀 범위 선택의 시작점. Shift+클릭으로 늘린다.
   * 이 값과 row/column 이 만드는 직사각형이 선택 범위다.
   */
  anchor?: { row: number; column: number };
  /** 슬라이드 도형. */
  shape?: XmlElement;
  slideIndex?: number;
}

/** 선택된 셀 범위. 없으면 undefined. */
export function selectionRect(
  focus: Focus,
): { top: number; left: number; bottom: number; right: number } | undefined {
  if (focus.table === undefined || focus.row === undefined || focus.column === undefined) {
    return undefined;
  }
  const anchor = focus.anchor ?? { row: focus.row, column: focus.column };
  return {
    top: Math.min(anchor.row, focus.row),
    left: Math.min(anchor.column, focus.column),
    bottom: Math.max(anchor.row, focus.row),
    right: Math.max(anchor.column, focus.column),
  };
}

export interface SessionApi {
  state: SessionState | undefined;
  error: string | undefined;
  busy: boolean;
  textDocument: JamoTextDocument | undefined;
  presentation: JamoPresentation | undefined;
  focus: Focus;
  setFocus: (focus: Focus) => void;

  open: () => Promise<void>;
  openFromData: (name: string, data: Uint8Array) => void;
  createNew: (kind: 'hwpx' | 'docx' | 'pptx') => void;
  close: () => void;
  dismissError: () => void;

  save: () => Promise<void>;
  saveAsFormat: (kind: 'hwpx' | 'docx' | 'pptx') => Promise<void>;

  undo: () => void;
  redo: () => void;

  setParagraphText: (source: unknown, text: string) => void;
  addParagraph: (afterSource: unknown | undefined, text: string) => void;
  removeParagraph: (source: unknown) => void;

  /** 지금 커서가 놓인 문단의 글자 서식을 바꾼다. */
  applyCharStyle: (patch: Partial<CharStyle>) => void;
  applyParagraphStyle: (patch: Partial<ParagraphStyle>) => void;
  /** 현재 문단의 서식 (도구막대 상태 표시용). */
  currentCharStyle: () => CharStyle | undefined;
  currentParagraphStyle: () => ParagraphStyle | undefined;

  insertTable: (rows: number, cols: number) => void;
  /** 표 맨 끝에 줄을 하나 더한다. 마지막 칸에서 Tab 을 눌렀을 때 쓴다. */
  appendRowToTable: (table: unknown) => void;
  mergeCells: () => void;
  splitCell: () => void;
  setCellShade: (color: string | undefined) => void;
  tableCommand: (
    action: 'rowBelow' | 'rowAbove' | 'deleteRow' | 'columnRight' | 'columnLeft' | 'deleteColumn' | 'deleteTable',
  ) => void;

  setShapeText: (source: unknown, lines: string[]) => void;
  addSlide: () => void;
  removeSlide: (index: number) => void;

  convertForEditing: () => void;
}

/** 되돌리기 스택 한도. 문서 전체를 스냅샷으로 들고 있어 상한이 필요하다. */
const UNDO_LIMIT = 60;
const UNDO_BYTES_LIMIT = 96 * 1024 * 1024;

export function useSession(): SessionApi {
  const docRef = useRef<OpenedDocument | undefined>(undefined);
  const handleRef = useRef<FileSystemFileHandle | undefined>(undefined);
  const undoRef = useRef<Uint8Array[]>([]);
  const redoRef = useRef<Uint8Array[]>([]);
  const [state, setState] = useState<SessionState | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [focus, setFocus] = useState<Focus>({});

  const refreshUndoFlags = useCallback(() => {
    setState((s) =>
      s ? { ...s, canUndo: undoRef.current.length > 0, canRedo: redoRef.current.length > 0 } : s,
    );
  }, []);

  const touch = useCallback(() => {
    setRevision((r) => r + 1);
    setState((s) =>
      s
        ? {
            ...s,
            dirty: true,
            canUndo: undoRef.current.length > 0,
            canRedo: redoRef.current.length > 0,
          }
        : s,
    );
  }, []);

  /** 고치기 직전 상태를 저장한다. 모든 편집 명령이 먼저 부른다. */
  const snapshot = useCallback(() => {
    const doc = docRef.current;
    if (!doc || doc.kind === 'hwp5') return;
    try {
      undoRef.current.push(doc.file.save());
    } catch {
      return; // 직렬화할 수 없으면 되돌리기를 포기한다. 편집은 막지 않는다.
    }
    redoRef.current = [];
    let total = undoRef.current.reduce((sum, b) => sum + b.byteLength, 0);
    while (undoRef.current.length > UNDO_LIMIT || total > UNDO_BYTES_LIMIT) {
      const dropped = undoRef.current.shift();
      if (!dropped) break;
      total -= dropped.byteLength;
    }
  }, []);

  const adopt = useCallback(
    (
      doc: OpenedDocument,
      name: string,
      handle: FileSystemFileHandle | undefined,
      dirty: boolean,
    ) => {
      docRef.current = doc;
      handleRef.current = handle;
      undoRef.current = [];
      redoRef.current = [];
      setFocus({});
      setState({
        kind: doc.kind,
        name,
        dirty,
        canSaveInPlace: handle !== undefined && isWritable(doc.kind),
        readOnly: !isWritable(doc.kind),
        canUndo: false,
        canRedo: false,
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
    undoRef.current = [];
    redoRef.current = [];
    setFocus({});
    setState(undefined);
    setError(undefined);
  }, []);

  const dismissError = useCallback(() => setError(undefined), []);

  // --------------------------------------------------------------- 되돌리기

  const restore = useCallback(
    (from: 'undo' | 'redo') => {
      const doc = docRef.current;
      if (!doc || doc.kind === 'hwp5') return;
      const source = from === 'undo' ? undoRef.current : redoRef.current;
      const target = from === 'undo' ? redoRef.current : undoRef.current;
      const bytes = source.pop();
      if (!bytes) return;
      try {
        target.push(doc.file.save());
        docRef.current = openDocument(bytes);
      } catch (cause) {
        setError(`되돌리지 못했습니다: ${(cause as Error).message}`);
        return;
      }
      // 복원하면 XML 트리가 통째로 바뀌므로 기존 커서 위치는 무효다.
      setFocus({});
      setRevision((r) => r + 1);
      setState((s) =>
        s
          ? {
              ...s,
              dirty: true,
              canUndo: undoRef.current.length > 0,
              canRedo: redoRef.current.length > 0,
            }
          : s,
      );
    },
    [],
  );

  const undo = useCallback(() => restore('undo'), [restore]);
  const redo = useCallback(() => restore('redo'), [restore]);

  // --------------------------------------------------------------------- 저장

  const save = useCallback(async () => {
    const doc = docRef.current;
    const current = state;
    if (!doc || !current || doc.kind === 'hwp5') return;
    setBusy(true);
    try {
      const data = doc.file.save();
      const handle = handleRef.current;
      if (handle && (await writeToHandle(handle, data))) {
        setState((s) => (s ? { ...s, dirty: false } : s));
        return;
      }
      const newHandle = await saveAs(data, current.name, doc.kind);
      if (newHandle) handleRef.current = newHandle;
      setState((s) => (s ? { ...s, dirty: false, canSaveInPlace: newHandle !== undefined } : s));
    } catch (cause) {
      setError(`저장하지 못했습니다: ${(cause as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [state]);

  const saveAsFormat = useCallback(
    async (kind: 'hwpx' | 'docx' | 'pptx') => {
      const doc = docRef.current;
      const current = state;
      if (!doc || !current) return;
      setBusy(true);
      try {
        const data = exportAs(doc, kind);
        await saveAs(data, replaceExtension(current.name, EXTENSION[kind]), kind);
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
      adopt(
        { kind: 'hwpx', file: HwpxFile.fromModel(doc.file.toModel()) },
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
      snapshot();
      if (doc.kind === 'hwpx') doc.file.setParagraphText(source, text);
      else if (doc.kind === 'docx') doc.file.setParagraphText(source, text);
      else return;
      touch();
    },
    [snapshot, touch],
  );

  const addParagraph = useCallback(
    (afterSource: unknown | undefined, text: string) => {
      const doc = docRef.current;
      if (!doc) return;
      snapshot();
      if (doc.kind === 'hwpx') {
        if (isXmlElement(afterSource)) doc.file.insertParagraphAfter(0, afterSource, text);
        else doc.file.appendParagraph(0, text);
      } else if (doc.kind === 'docx') {
        if (isXmlElement(afterSource)) doc.file.insertParagraphAfter(afterSource, text);
        else doc.file.appendParagraph(text);
      } else return;
      touch();
    },
    [snapshot, touch],
  );

  const removeParagraph = useCallback(
    (source: unknown) => {
      const doc = docRef.current;
      if (!doc || !isXmlElement(source)) return;
      snapshot();
      if (doc.kind === 'hwpx') doc.file.removeParagraph(0, source);
      else if (doc.kind === 'docx') doc.file.removeParagraph(source);
      else return;
      touch();
    },
    [snapshot, touch],
  );

  // ------------------------------------------------------------------- 서식

  const applyCharStyle = useCallback(
    (patch: Partial<CharStyle>) => {
      const doc = docRef.current;
      if (!doc) return;
      if (doc.kind === 'pptx') {
        // 슬라이드는 도형 단위로 적용한다.
        if (!focus.shape) return;
        snapshot();
        PptxFile.setShapeStyle(focus.shape, patch);
        touch();
        return;
      }
      const p = focus.paragraph;
      if (!p) return;
      snapshot();
      if (doc.kind === 'hwpx') doc.file.setParagraphRunStyle(p, patch);
      else if (doc.kind === 'docx') doc.file.setParagraphRunStyle(p, patch);
      else return;
      touch();
    },
    [focus, snapshot, touch],
  );

  const applyParagraphStyle = useCallback(
    (patch: Partial<ParagraphStyle>) => {
      const doc = docRef.current;
      const p = focus.paragraph;
      if (!doc || !p) return;
      snapshot();
      if (doc.kind === 'hwpx') doc.file.setParagraphFormat(p, patch);
      else if (doc.kind === 'docx') doc.file.setParagraphFormat(p, patch);
      else return;
      touch();
    },
    [focus, snapshot, touch],
  );

  const currentCharStyle = useCallback((): CharStyle | undefined => {
    const doc = docRef.current;
    if (!doc || doc.kind === 'hwp5' || doc.kind === 'pptx') return undefined;
    const p = focus.paragraph;
    if (!p) return undefined;
    return doc.file.runStyleOf(p);
  }, [focus]);

  const currentParagraphStyle = useCallback((): ParagraphStyle | undefined => {
    const doc = docRef.current;
    if (!doc || doc.kind === 'hwp5' || doc.kind === 'pptx') return undefined;
    const p = focus.paragraph;
    if (!p) return undefined;
    return doc.file.paragraphStyleOf(p);
  }, [focus]);

  // --------------------------------------------------------------------- 표

  const insertTable = useCallback(
    (rows: number, cols: number) => {
      const doc = docRef.current;
      if (!doc) return;
      snapshot();
      try {
        if (doc.kind === 'hwpx') {
          doc.file.insertTable(0, rows, cols, { after: focus.paragraph });
        } else if (doc.kind === 'docx') {
          doc.file.insertTable(rows, cols, { after: focus.paragraph });
        } else return;
        touch();
      } catch (cause) {
        setError((cause as Error).message);
      }
    },
    [focus, snapshot, touch],
  );

  const appendRowToTable = useCallback(
    (table: unknown) => {
      const doc = docRef.current;
      if (!doc || !isXmlElement(table)) return;
      const api = doc.kind === 'hwpx' ? HwpxFile : doc.kind === 'docx' ? DocxFile : undefined;
      if (!api) return;
      snapshot();
      const rows = api.grid(table).length;
      if (api.insertRow(table, rows - 1)) touch();
    },
    [snapshot, touch],
  );

  const mergeCells = useCallback(() => {
    const doc = docRef.current;
    const tbl = focus.table;
    const rect = selectionRect(focus);
    if (!doc || !tbl || !rect) return;
    const api = doc.kind === 'hwpx' ? HwpxFile : doc.kind === 'docx' ? DocxFile : undefined;
    if (!api) return;
    snapshot();
    if (api.mergeCells(tbl, rect.top, rect.left, rect.bottom, rect.right)) {
      // 합쳐진 뒤에는 범위가 의미 없다. 주인 셀 하나만 남긴다.
      setFocus((f) => ({ ...f, row: rect.top, column: rect.left, anchor: undefined }));
      touch();
    }
  }, [focus, snapshot, touch]);

  const splitCell = useCallback(() => {
    const doc = docRef.current;
    const tbl = focus.table;
    if (!doc || !tbl || focus.row === undefined || focus.column === undefined) return;
    const api = doc.kind === 'hwpx' ? HwpxFile : doc.kind === 'docx' ? DocxFile : undefined;
    if (!api) return;
    snapshot();
    if (api.splitCell(tbl, focus.row, focus.column)) {
      setFocus((f) => ({ ...f, anchor: undefined }));
      touch();
    }
  }, [focus, snapshot, touch]);

  const setCellShade = useCallback(
    (color: string | undefined) => {
      const doc = docRef.current;
      const tbl = focus.table;
      const rect = selectionRect(focus);
      if (!doc || !tbl || !rect) return;
      if (doc.kind !== 'hwpx' && doc.kind !== 'docx') return;
      snapshot();
      // 선택한 범위 전체에 칠한다. 한 칸만 골랐으면 그 칸만.
      for (let r = rect.top; r <= rect.bottom; r += 1) {
        for (let c = rect.left; c <= rect.right; c += 1) {
          doc.file.setCellShade(tbl, r, c, color);
        }
      }
      touch();
    },
    [focus, snapshot, touch],
  );

  const tableCommand = useCallback(
    (action: Parameters<SessionApi['tableCommand']>[0]) => {
      const doc = docRef.current;
      const tbl = focus.table;
      if (!doc || !tbl) return;
      const row = focus.row ?? 0;
      const col = focus.column ?? 0;
      snapshot();

      const api = doc.kind === 'hwpx' ? HwpxFile : doc.kind === 'docx' ? DocxFile : undefined;
      if (!api) return;

      switch (action) {
        case 'rowBelow':
          api.insertRow(tbl, row);
          break;
        case 'rowAbove':
          api.insertRow(tbl, Math.max(row - 1, 0));
          break;
        case 'deleteRow':
          api.removeRow(tbl, row);
          break;
        case 'columnRight':
          api.insertColumn(tbl, col);
          break;
        case 'columnLeft':
          api.insertColumn(tbl, Math.max(col - 1, 0));
          break;
        case 'deleteColumn':
          api.removeColumn(tbl, col);
          break;
        case 'deleteTable':
          if (doc.kind === 'hwpx') doc.file.removeTable(0, tbl);
          else if (doc.kind === 'docx') doc.file.removeTable(tbl);
          setFocus({});
          break;
      }
      touch();
    },
    [focus, snapshot, touch],
  );

  // -------------------------------------------------------------- 슬라이드

  const setShapeText = useCallback(
    (source: unknown, lines: string[]) => {
      const doc = docRef.current;
      if (!doc || doc.kind !== 'pptx' || !isXmlElement(source)) return;
      snapshot();
      PptxFile.setShapeText(source, lines);
      touch();
    },
    [snapshot, touch],
  );

  const addSlide = useCallback(() => {
    const doc = docRef.current;
    if (!doc || doc.kind !== 'pptx') return;
    snapshot();
    doc.file.addTitleSlide('새 슬라이드', ['내용을 입력하세요']);
    touch();
  }, [snapshot, touch]);

  const removeSlide = useCallback(
    (index: number) => {
      const doc = docRef.current;
      if (!doc || doc.kind !== 'pptx') return;
      snapshot();
      doc.file.removeSlide(index);
      touch();
    },
    [snapshot, touch],
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

  // 되돌리기 가능 여부가 state 와 어긋나지 않게 한 번 맞춘다.
  useMemo(refreshUndoFlags, [revision, refreshUndoFlags]);

  return {
    state,
    error,
    busy,
    textDocument,
    presentation,
    focus,
    setFocus,
    open,
    openFromData,
    createNew,
    close,
    dismissError,
    save,
    saveAsFormat,
    undo,
    redo,
    setParagraphText,
    addParagraph,
    removeParagraph,
    applyCharStyle,
    applyParagraphStyle,
    currentCharStyle,
    currentParagraphStyle,
    insertTable,
    tableCommand,
    appendRowToTable,
    mergeCells,
    splitCell,
    setCellShade,
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
    const model = doc.kind === 'pptx' ? undefined : doc.file.toModel();
    if (!model) throw new Error('변환할 내용이 없습니다');
    const lines = model.sections
      .flatMap((s) => s.blocks)
      .flatMap((b) =>
        'rows' in b
          ? b.rows.map((row) =>
              row.cells.map((c) => c.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join(' ')).join(' | '),
            )
          : [b.runs.map((r) => r.text).join('')],
      )
      .filter((t) => t.trim() !== '');

    const outline: Array<{ title: string; bullets: string[] }> = [];
    for (const line of lines) {
      // 짧은 줄은 새 장의 제목, 긴 줄은 본문으로 본다. 완벽하진 않지만
      // 개요를 손으로 다시 짜는 수고를 줄여 준다.
      if (line.length <= 30 || outline.length === 0) outline.push({ title: line, bullets: [] });
      else outline[outline.length - 1]!.bullets.push(line);
    }
    return PptxFile.fromOutline(
      outline.length > 0 ? outline : [{ title: '빈 문서', bullets: [] }],
      { title: model.meta.title },
    ).save();
  }

  if (doc.kind === 'pptx') {
    const deck = doc.file.toModel();
    const blocks = deck.slides.flatMap((slide, i) => [
      { runs: [{ text: `슬라이드 ${i + 1}`, style: { bold: true, fontSize: 14 } }] },
      ...slide.shapes.flatMap((sh) => sh.paragraphs),
    ]);
    const model = { kind: 'text' as const, meta: deck.meta, sections: [{ page: emptyPage(), blocks }] };
    return target === 'hwpx' ? HwpxFile.fromModel(model).save() : DocxFile.fromModel(model).save();
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
    typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'element'
  );
}

export { Hwp5File };
