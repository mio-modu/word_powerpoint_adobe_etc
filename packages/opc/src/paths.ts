/**
 * OPC 파트 이름 다루기.
 *
 * 관계(`Relationship/@Target`)는 **출처 파트의 디렉터리 기준 상대 경로**다.
 * `ppt/slides/slide1.xml` 에서 `../slideLayouts/slideLayout1.xml` 을 가리키는
 * 식이라, 이 계산을 틀리면 파트를 못 찾는다. 가장 흔한 버그 지점.
 */

/** 선두 `/` 를 떼고 ZIP 항목 이름 형태로 정규화. */
export function normalizePart(name: string): string {
  return name.replace(/^\/+/, '');
}

export function dirname(partName: string): string {
  const p = normalizePart(partName);
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

export function basename(partName: string): string {
  const p = normalizePart(partName);
  const i = p.lastIndexOf('/');
  return i < 0 ? p : p.slice(i + 1);
}

export function extension(partName: string): string {
  const b = basename(partName);
  const i = b.lastIndexOf('.');
  return i < 0 ? '' : b.slice(i + 1).toLowerCase();
}

/** `a/b` + `../c/d.xml` → `a/c/d.xml` */
export function resolveRelative(baseDir: string, target: string): string {
  if (target.startsWith('/')) return normalizePart(target);
  const segments = baseDir === '' ? [] : baseDir.split('/');
  for (const seg of target.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') segments.pop();
    else segments.push(seg);
  }
  return segments.join('/');
}

/** `source` 파트에서 본 `target` 파트의 상대 경로. */
export function relativeTo(sourcePart: string, targetPart: string): string {
  const from = dirname(sourcePart).split('/').filter(Boolean);
  const to = normalizePart(targetPart).split('/').filter(Boolean);
  let i = 0;
  while (i < from.length && i < to.length && from[i] === to[i]) i += 1;
  const up = Array.from({ length: from.length - i }, () => '..');
  return [...up, ...to.slice(i)].join('/');
}

/** 파트의 관계 파일 경로. 패키지 루트는 `''` 를 넘긴다. */
export function relsPartFor(partName: string): string {
  const p = normalizePart(partName);
  if (p === '') return '_rels/.rels';
  const dir = dirname(p);
  const base = basename(p);
  return dir === '' ? `_rels/${base}.rels` : `${dir}/_rels/${base}.rels`;
}

/** `_rels/...` 자체인지. 관계 파일은 다시 관계를 갖지 않는다. */
export function isRelsPart(partName: string): boolean {
  return /(^|\/)_rels\//.test(normalizePart(partName));
}
