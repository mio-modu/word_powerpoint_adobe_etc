/** OPC·OOXML 고정 문자열. */

export const PKG_NS = {
  contentTypes: 'http://schemas.openxmlformats.org/package/2006/content-types',
  relationships: 'http://schemas.openxmlformats.org/package/2006/relationships',
} as const;

/** 관계 타입 URI. 길어서 전부 상수로 둔다. */
const OFFICE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

export const REL = {
  officeDocument: `${OFFICE_REL}/officeDocument`,
  coreProperties: `${PKG_REL}/metadata/core-properties`,
  extendedProperties: `${OFFICE_REL}/extended-properties`,
  styles: `${OFFICE_REL}/styles`,
  numbering: `${OFFICE_REL}/numbering`,
  settings: `${OFFICE_REL}/settings`,
  fontTable: `${OFFICE_REL}/fontTable`,
  theme: `${OFFICE_REL}/theme`,
  image: `${OFFICE_REL}/image`,
  hyperlink: `${OFFICE_REL}/hyperlink`,
  slide: `${OFFICE_REL}/slide`,
  slideMaster: `${OFFICE_REL}/slideMaster`,
  slideLayout: `${OFFICE_REL}/slideLayout`,
  notesSlide: `${OFFICE_REL}/notesSlide`,
  notesMaster: `${OFFICE_REL}/notesMaster`,
  presProps: `${OFFICE_REL}/presProps`,
  viewProps: `${OFFICE_REL}/viewProps`,
  tableStyles: `${OFFICE_REL}/tableStyles`,
} as const;

export const CT = {
  rels: 'application/vnd.openxmlformats-package.relationships+xml',
  xml: 'application/xml',
  coreProperties: 'application/vnd.openxmlformats-package.core-properties+xml',
  extendedProperties: 'application/vnd.openxmlformats-officedocument.extended-properties+xml',

  // WordprocessingML
  wordDocument:
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  wordStyles: 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml',
  wordSettings: 'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml',
  wordNumbering: 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml',
  wordFontTable: 'application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml',

  // PresentationML
  presentation:
    'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
  slide: 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml',
  slideMaster: 'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml',
  slideLayout: 'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml',
  notesSlide: 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml',
  notesMaster: 'application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml',
  presProps: 'application/vnd.openxmlformats-officedocument.presentationml.presProps+xml',
  viewProps: 'application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml',
  tableStyles: 'application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml',
  theme: 'application/vnd.openxmlformats-officedocument.theme+xml',
} as const;

export const CONTENT_TYPES_PART = '[Content_Types].xml';
