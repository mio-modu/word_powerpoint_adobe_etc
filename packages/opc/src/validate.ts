/**
 * OOXML 패키지 구조 검사기.
 *
 * 한쇼·PowerPoint 가 "손상된 문서입니다" 라고 말할 때, 대개는 내용이 아니라
 * **얼개**가 어긋난 것이다. 관계가 가리키는 파트가 없거나, 파트에 형식
 * 선언이 없거나, 본문이 쓴 r:id 가 관계 목록에 없거나.
 *
 * 그런 것들은 열어 보기 전에는 눈에 띄지 않는다. 그래서 여기서 기계적으로
 * 훑는다. 저장한 파일을 한쇼에 가져가기 전에 이걸로 먼저 거른다.
 *
 * 저장한 파일을 사용자에게 건네기 전에 앱이 이걸로 먼저 훑는다.
 */
import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { CT } from './constants.js';

export interface Finding {
  kind: 'error' | 'warn';
  where: string;
  what: string;
}

const RELS_OF = (part: string): string => {
  const i = part.lastIndexOf('/');
  return i < 0 ? `_rels/${part}.rels` : `${part.slice(0, i)}/_rels/${part.slice(i + 1)}.rels`;
};

/** `ppt/slides/slide1.xml` + `../notesSlides/n.xml` → `ppt/notesSlides/n.xml` */
function resolveTarget(source: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const baseDir = source.includes('/') ? source.slice(0, source.lastIndexOf('/')) : '';
  const parts = baseDir === '' ? [] : baseDir.split('/');
  for (const segment of target.split('/')) {
    if (segment === '.' || segment === '') continue;
    if (segment === '..') parts.pop();
    else parts.push(segment);
  }
  return parts.join('/');
}

const attrOf = (tag: string, name: string): string | undefined =>
  new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];

export function validatePackage(data: Uint8Array): Finding[] {
  const found: Finding[] = [];
  const add = (kind: Finding['kind'], where: string, what: string): void => {
    found.push({ kind, where, what });
  };

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(data);
  } catch (cause) {
    return [{ kind: 'error', where: '(ZIP)', what: `열 수 없습니다: ${(cause as Error).message}` }];
  }
  const names = new Set(Object.keys(entries));
  const text = (name: string): string => strFromU8(entries[name]!);

  // ── 1. [Content_Types].xml ────────────────────────────────────────────
  if (!names.has('[Content_Types].xml')) {
    add('error', '[Content_Types].xml', '없습니다. 이것만으로 열리지 않습니다.');
    return found;
  }
  const ct = text('[Content_Types].xml');
  const defaults = new Map<string, string>();
  for (const tag of ct.match(/<Default\b[^>]*\/?>/g) ?? []) {
    const ext = attrOf(tag, 'Extension');
    const type = attrOf(tag, 'ContentType');
    if (ext && type) defaults.set(ext.toLowerCase(), type);
  }
  const overrides = new Map<string, string>();
  for (const tag of ct.match(/<Override\b[^>]*\/?>/g) ?? []) {
    const part = attrOf(tag, 'PartName');
    const type = attrOf(tag, 'ContentType');
    if (part && type) {
      const clean = part.replace(/^\//, '');
      if (overrides.has(clean)) add('error', '[Content_Types].xml', `Override 가 두 번: /${clean}`);
      overrides.set(clean, type);
    }
  }

  // Override 가 없는 파트를 가리키면 안 된다.
  for (const part of overrides.keys()) {
    if (!names.has(part)) add('error', '[Content_Types].xml', `없는 파트를 가리킵니다: /${part}`);
  }

  // 모든 파트에 형식이 있어야 한다.
  const effectiveType = (name: string): string | undefined => {
    const over = overrides.get(name);
    if (over !== undefined) return over;
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
    return defaults.get(ext);
  };

  for (const name of names) {
    if (name.endsWith('/')) continue;
    if (name === '[Content_Types].xml') continue;
    if (effectiveType(name) !== undefined) continue;
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
    add('error', name, `형식 선언이 없습니다 (확장자 .${ext} 의 Default 도, Override 도 없음)`);
  }

  /**
   * 자리마다 정해진 형식이 있어야 한다.
   *
   * 여기가 특히 조용한 함정이다. `.xml` 에 Default 가 걸려 있으면 슬라이드의
   * Override 를 빼먹어도 "형식은 있는" 상태가 된다. 그런데 PowerPoint 와
   * 한쇼는 슬라이드 자리에 presentationml.slide 가 아닌 것이 오면 파일을
   * 거부한다. Default 로 때운 것을 통과시키면 검사기가 있으나 마나다.
   */
  const EXPECTED: Array<[RegExp, string, string]> = [
    [/^ppt\/presentation\.xml$/, CT.presentation, '프레젠테이션 본문'],
    [/^ppt\/slides\/[^/]+\.xml$/, CT.slide, '슬라이드'],
    [/^ppt\/slideLayouts\/[^/]+\.xml$/, CT.slideLayout, '슬라이드 레이아웃'],
    [/^ppt\/slideMasters\/[^/]+\.xml$/, CT.slideMaster, '슬라이드 마스터'],
    [/^ppt\/notesSlides\/[^/]+\.xml$/, CT.notesSlide, '슬라이드 노트'],
    [/^ppt\/notesMasters\/[^/]+\.xml$/, CT.notesMaster, '노트 마스터'],
    [/^ppt\/theme\/[^/]+\.xml$/, CT.theme, '테마'],
    [/^word\/document\.xml$/, CT.wordDocument, '워드 본문'],
    [/^word\/styles\.xml$/, CT.wordStyles, '워드 스타일'],
    [/^word\/numbering\.xml$/, CT.wordNumbering, '워드 번호 매기기'],
    [/^docProps\/core\.xml$/, CT.coreProperties, '문서 속성'],
    [/^docProps\/app\.xml$/, CT.extendedProperties, '문서 속성(확장)'],
  ];

  for (const name of names) {
    for (const [pattern, want, label] of EXPECTED) {
      if (!pattern.test(name)) continue;
      const got = effectiveType(name);
      if (got !== want) {
        add(
          'error',
          name,
          `${label} 자리인데 형식이 다릅니다. 있어야 할 것: ${want} / 지금: ${got ?? '(없음)'}`,
        );
      }
      break;
    }
  }

  // ── 2. 관계 ───────────────────────────────────────────────────────────
  if (!names.has('_rels/.rels')) add('error', '_rels/.rels', '패키지 루트 관계가 없습니다.');

  for (const relsName of [...names].filter((n) => n.endsWith('.rels'))) {
    const owner =
      relsName === '_rels/.rels'
        ? ''
        : relsName.replace(/(^|\/)_rels\//, '$1').replace(/\.rels$/, '');
    if (owner !== '' && !names.has(owner)) {
      add('warn', relsName, `임자 파트가 없습니다: ${owner}`);
    }
    const xml = text(relsName);
    const ids = new Set<string>();
    for (const tag of xml.match(/<Relationship\b[^>]*\/?>/g) ?? []) {
      const id = attrOf(tag, 'Id');
      const target = attrOf(tag, 'Target');
      const mode = attrOf(tag, 'TargetMode');
      const type = attrOf(tag, 'Type');
      if (!id) add('error', relsName, `Id 없는 관계: ${tag}`);
      else if (ids.has(id)) add('error', relsName, `같은 Id 가 두 번: ${id}`);
      else ids.add(id);
      if (!type) add('error', relsName, `Type 없는 관계: ${id ?? tag}`);
      if (mode === 'External') continue;
      if (!target) {
        add('error', relsName, `Target 없는 관계: ${id ?? tag}`);
        continue;
      }
      const resolved = resolveTarget(owner, target);
      if (!names.has(resolved)) {
        add('error', relsName, `${id}: 없는 파트를 가리킵니다 → ${target} (${resolved})`);
      }
    }
  }

  // ── 3. 본문이 쓴 r:id 가 관계에 있는가 ────────────────────────────────
  for (const name of names) {
    if (!name.endsWith('.xml') || name.endsWith('.rels')) continue;
    if (name === '[Content_Types].xml') continue;
    const xml = text(name);
    const used = new Set<string>();
    for (const m of xml.matchAll(/\br:(?:id|embed|link|pict|dm|lo|qs|cs)="([^"]+)"/g)) {
      used.add(m[1]!);
    }
    if (used.size === 0) continue;
    const relsName = RELS_OF(name);
    const relsXml = names.has(relsName) ? text(relsName) : '';
    const known = new Set(
      (relsXml.match(/<Relationship\b[^>]*\/?>/g) ?? [])
        .map((tag) => attrOf(tag, 'Id'))
        .filter((id): id is string => id !== undefined),
    );
    for (const id of used) {
      if (!known.has(id)) {
        add('error', name, `${id} 를 쓰는데 ${relsName} 에 그 관계가 없습니다`);
      }
    }
  }

  // ── 4. PresentationML 만의 규칙 ───────────────────────────────────────
  const presentation = [...names].find((n) => /^ppt\/presentation\.xml$/.test(n));
  if (presentation) {
    const xml = text(presentation);
    // 자식 순서는 스키마가 정해 두었다. 어기면 PowerPoint 가 거부한다.
    const ORDER = [
      'p:sldMasterIdLst',
      'p:notesMasterIdLst',
      'p:handoutMasterIdLst',
      'p:sldIdLst',
      'p:sldSz',
      'p:notesSz',
    ];
    const seen = ORDER.map((tag) => ({ tag, at: xml.indexOf(`<${tag}`) })).filter((x) => x.at >= 0);
    for (let i = 1; i < seen.length; i += 1) {
      if (seen[i]!.at < seen[i - 1]!.at) {
        add('error', presentation, `자식 순서가 어긋납니다: ${seen[i]!.tag} 가 ${seen[i - 1]!.tag} 보다 앞`);
      }
    }
    // 슬라이드 목록이 가리키는 관계가 실제 슬라이드여야 한다.
    const relsXml = names.has(RELS_OF(presentation)) ? text(RELS_OF(presentation)) : '';
    const targetOf = new Map<string, string>();
    for (const tag of relsXml.match(/<Relationship\b[^>]*\/?>/g) ?? []) {
      const id = attrOf(tag, 'Id');
      const target = attrOf(tag, 'Target');
      if (id && target) targetOf.set(id, resolveTarget(presentation, target));
    }
    const lst = /<p:sldIdLst>([\s\S]*?)<\/p:sldIdLst>/.exec(xml)?.[1] ?? '';
    for (const tag of lst.match(/<p:sldId\b[^>]*\/?>/g) ?? []) {
      const rid = attrOf(tag, 'r:id');
      const part = rid ? targetOf.get(rid) : undefined;
      if (!part) add('error', presentation, `sldIdLst 의 ${rid} 가 가리키는 파트가 없습니다`);
      else if (!/^ppt\/slides\//.test(part)) {
        add('error', presentation, `sldIdLst 의 ${rid} 가 슬라이드가 아닙니다: ${part}`);
      }
    }
  }

  // ── 5. 슬라이드마다 레이아웃이 있어야 한다 ────────────────────────────
  for (const slide of [...names].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))) {
    const relsXml = names.has(RELS_OF(slide)) ? text(RELS_OF(slide)) : '';
    if (!relsXml.includes('slideLayout')) {
      add('error', slide, '레이아웃 관계가 없습니다 (PowerPoint 가 거부합니다)');
    }
  }

  return found;
}
