/**
 * 슬라이드 메모 (발표자 노트).
 *
 * PPTX 에서 메모는 슬라이드 안이 아니라 `ppt/notesSlides/notesSlideN.xml`
 * 이라는 별도 파트에 있고, 슬라이드가 관계(rels)로 그걸 가리킨다. 파일
 * 이름의 숫자는 슬라이드 번호와 아무 상관이 없으므로 — 슬라이드를 지우거나
 * 옮기면 바로 어긋난다 — 항상 관계를 따라가야 한다.
 *
 * 메모 글이 들어가는 자리는 노트 파트 안에서 `<p:ph type="body"/>` 를 가진
 * 도형이다. 같은 파트에 슬라이드 그림 자리(`sldImg`), 머리말, 쪽 번호가
 * 같이 있어서 "텍스트가 있는 첫 도형"으로 고르면 엉뚱한 걸 집는다.
 */
import {
  attr,
  childElements,
  descendants,
  element,
  firstChild,
  parseXml,
  type XmlElement,
} from '@jamo/core';
import { CT, OpcPackage, REL } from '@jamo/opc';
import { PART, notesMasterXml, notesSlidePart, notesSlideXml } from './templates.js';
import { buildParagraph, paragraphText, shapeParagraphs } from './presentationml.js';

/** 노트 파트 안에서 글을 적는 도형을 찾는다. */
function bodyShape(notesRoot: XmlElement): XmlElement | undefined {
  for (const sp of descendants(notesRoot, 'p:sp')) {
    const nvSpPr = firstChild(sp, 'p:nvSpPr');
    const nvPr = nvSpPr && firstChild(nvSpPr, 'p:nvPr');
    const ph = nvPr && firstChild(nvPr, 'p:ph');
    if (ph && attr(ph, 'type') === 'body') return sp;
  }
  // 자리표시자 표시가 없는 파일도 있다. 그럴 때만 글이 담긴 도형 중
  // 슬라이드 그림이 아닌 첫 번째를 쓴다.
  for (const sp of descendants(notesRoot, 'p:sp')) {
    const nvSpPr = firstChild(sp, 'p:nvSpPr');
    const nvPr = nvSpPr && firstChild(nvSpPr, 'p:nvPr');
    const ph = nvPr && firstChild(nvPr, 'p:ph');
    const type = ph ? attr(ph, 'type') : undefined;
    if (type === 'sldImg' || type === 'hdr' || type === 'ftr' || type === 'dt' || type === 'sldNum') {
      continue;
    }
    if (firstChild(sp, 'p:txBody')) return sp;
  }
  return undefined;
}

/** 슬라이드에 달린 메모 파트 경로. 없으면 undefined. */
export function notesPartOf(pkg: OpcPackage, slidePart: string): string | undefined {
  return pkg.relatedPart(slidePart, REL.notesSlide);
}

/**
 * 슬라이드의 메모를 읽는다.
 *
 * 빈 문단만 있는 메모는 메모가 없는 것과 같으므로 undefined 로 돌려준다.
 * 그래야 UI 가 "메모 있음" 표시를 잘못 켜지 않는다.
 */
export function readNotes(pkg: OpcPackage, slidePart: string): string | undefined {
  const part = notesPartOf(pkg, slidePart);
  if (!part) return undefined;
  const root = pkg.xml(part)?.root;
  if (!root) return undefined;
  const sp = bodyShape(root);
  if (!sp) return undefined;
  const text = shapeParagraphs(sp)
    .map((p) => paragraphText(p))
    .join('\n');
  return text.trim() === '' ? undefined : text;
}

/** 메모가 하나라도 생기면 노트 마스터가 있어야 한다. 없으면 만든다. */
function ensureNotesMaster(pkg: OpcPackage, presentationPart: string): string {
  const existing = pkg.relatedPart(presentationPart, REL.notesMaster);
  if (existing) return existing;

  const part = PART.notesMaster;
  if (!pkg.partNames().includes(part)) {
    pkg.setXml(part, parseXml(notesMasterXml()), CT.notesMaster);
    // 마스터는 테마를 가리켜야 한다. 슬라이드 마스터가 쓰는 테마를 같이 쓴다.
    const theme = pkg.relatedPart(PART.slideMaster, REL.theme) ?? PART.theme;
    if (pkg.partNames().includes(theme)) {
      pkg.addRelationship(part, REL.theme, theme);
    }
  }

  const rid = pkg.addRelationship(presentationPart, REL.notesMaster, part);

  // presentation.xml 의 자식 순서는 스키마가 정해 두었다:
  // sldMasterIdLst → notesMasterIdLst → handoutMasterIdLst → sldIdLst → sldSz …
  // 순서를 어기면 PowerPoint 가 파일을 거부한다.
  const root = pkg.requireXml(presentationPart).root;
  if (!firstChild(root, 'p:notesMasterIdLst')) {
    const lst = element('p:notesMasterIdLst');
    lst.children.push(element('p:notesMasterId', { 'r:id': rid }));
    lst.selfClosed = false;
    const after = firstChild(root, 'p:sldMasterIdLst');
    const before = firstChild(root, 'p:sldIdLst') ?? firstChild(root, 'p:sldSz');
    const index = after
      ? root.children.indexOf(after) + 1
      : before
        ? root.children.indexOf(before)
        : root.children.length;
    root.children.splice(index, 0, lst);
    root.selfClosed = false;
  }
  return part;
}

/** 아직 쓰이지 않은 notesSlideN.xml 이름을 고른다. */
function freeNotesPart(pkg: OpcPackage): string {
  const used = new Set(pkg.partNames());
  let n = 1;
  while (used.has(notesSlidePart(n))) n += 1;
  return notesSlidePart(n);
}

/**
 * 슬라이드의 메모를 바꾼다. 메모 파트가 없으면 만들어 붙인다.
 *
 * 빈 문자열을 넣으면 메모를 지운다 — 파트까지 지우지는 않는다. PowerPoint
 * 도 그렇게 하고, 지웠다 다시 쓸 때 관계를 다시 만드는 쪽이 더 위험하다.
 */
export function writeNotes(
  pkg: OpcPackage,
  presentationPart: string,
  slidePart: string,
  text: string,
): void {
  let part = notesPartOf(pkg, slidePart);

  if (!part) {
    if (text.trim() === '') return; // 빈 메모 때문에 파트를 만들 이유는 없다.
    ensureNotesMaster(pkg, presentationPart);
    part = freeNotesPart(pkg);
    pkg.setXml(part, parseXml(notesSlideXml()), CT.notesSlide);

    // 노트 파트는 노트 마스터와 자기가 붙은 슬라이드를 가리킨다.
    const master = pkg.relatedPart(presentationPart, REL.notesMaster);
    if (master) pkg.addRelationship(part, REL.notesMaster, master);
    pkg.addRelationship(part, REL.slide, slidePart);

    // 슬라이드 → 노트 방향 관계. 이게 있어야 다음에 다시 찾을 수 있다.
    pkg.addRelationship(slidePart, REL.notesSlide, part);
  }

  const root = pkg.requireXml(part).root;
  const sp = bodyShape(root);
  if (!sp) return;
  const txBody = firstChild(sp, 'p:txBody');
  if (!txBody) return;

  const bodyPr = firstChild(txBody, 'a:bodyPr');
  const lstStyle = firstChild(txBody, 'a:lstStyle');
  const head: XmlElement[] = [];
  if (bodyPr) head.push(bodyPr);
  if (lstStyle) head.push(lstStyle);

  const lines = text === '' ? [''] : text.split('\n');
  txBody.children = [...head, ...lines.map((line) => buildParagraph([{ text: line }]))];
  txBody.selfClosed = false;
}

/** 덱 전체의 메모를 슬라이드 순서대로. 메모가 없는 장은 undefined. */
export function allNotes(
  pkg: OpcPackage,
  slideParts: readonly string[],
): Array<string | undefined> {
  return slideParts.map((part) => readNotes(pkg, part));
}

/** 노트 파트에 들어 있는 문단 수 — 테스트에서 구조를 확인할 때 쓴다. */
export function notesParagraphCount(pkg: OpcPackage, slidePart: string): number {
  const part = notesPartOf(pkg, slidePart);
  const root = part ? pkg.xml(part)?.root : undefined;
  const sp = root ? bodyShape(root) : undefined;
  if (!sp) return 0;
  const txBody = firstChild(sp, 'p:txBody');
  return txBody ? childElements(txBody, 'a:p').length : 0;
}
