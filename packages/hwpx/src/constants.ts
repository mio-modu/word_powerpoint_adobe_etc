/**
 * HWPX(OWPML) 고정 문자열.
 *
 * 값은 모두 참조 구현(hwpxlib)과 KS X 6101 기준으로 확인한 것이다.
 * 눈에 거슬려도 고치면 안 되는 것이 하나 있다:
 * version.xml 의 속성명은 `targetApplication` 이 아니라 `tagetApplication` 이다.
 * 스펙 자체의 오타이고, 한글이 그 이름으로 읽는다.
 */

export const NS = {
  hv: 'http://www.hancom.co.kr/hwpml/2011/version',
  odf: 'urn:oasis:names:tc:opendocument:xmlns:manifest:1.0',
  ocf: 'urn:oasis:names:tc:opendocument:xmlns:container',
  hpf: 'http://www.hancom.co.kr/schema/2011/hpf',
  ha: 'http://www.hancom.co.kr/hwpml/2011/app',
  hp: 'http://www.hancom.co.kr/hwpml/2011/paragraph',
  hp10: 'http://www.hancom.co.kr/hwpml/2016/paragraph',
  hs: 'http://www.hancom.co.kr/hwpml/2011/section',
  hc: 'http://www.hancom.co.kr/hwpml/2011/core',
  hh: 'http://www.hancom.co.kr/hwpml/2011/head',
  hhs: 'http://www.hancom.co.kr/hwpml/2011/history',
  hm: 'http://www.hancom.co.kr/hwpml/2011/master-page',
  dc: 'http://purl.org/dc/elements/1.1/',
  opf: 'http://www.idpf.org/2007/opf/',
  ooxmlchart: 'http://www.hancom.co.kr/hwpml/2016/ooxmlchart',
  hwpunitchar: 'http://www.hancom.co.kr/hwpml/2016/HwpUnitChar',
  epub: 'http://www.idpf.org/2007/ops',
  config: 'urn:oasis:names:tc:opendocument:xmlns:config:1.0',
} as const;

export const MIME = {
  hwpx: 'application/hwp+zip',
  hwpmlPackage: 'application/hwpml-package+xml',
  xml: 'application/xml',
  ole: 'application/ole',
} as const;

export const ENTRY = {
  mimetype: 'mimetype',
  version: 'version.xml',
  manifest: 'META-INF/manifest.xml',
  container: 'META-INF/container.xml',
  settings: 'settings.xml',
  contentHpf: 'Contents/content.hpf',
  header: 'Contents/header.xml',
  previewText: 'Preview/PrvText.txt',
  previewImage: 'Preview/PrvImage.png',
} as const;

export const FILE_ID = {
  header: 'header',
  settings: 'settings',
  sectionPrefix: 'section',
  masterPagePrefix: 'masterpage',
} as const;

export function sectionEntry(index: number): string {
  return `Contents/section${index}.xml`;
}

export function sectionId(index: number): string {
  return `${FILE_ID.sectionPrefix}${index}`;
}

/** 쓰기 시 ZIP 항목 순서. mimetype 이 반드시 선두. */
export const ENTRY_ORDER: readonly string[] = [
  ENTRY.mimetype,
  ENTRY.version,
  ENTRY.manifest,
  ENTRY.container,
  ENTRY.contentHpf,
  ENTRY.settings,
  ENTRY.header,
];
