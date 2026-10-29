import { element, setTextContent, type XmlDocument, type XmlElement } from '@jamo/core';
import { xmlDocumentOf } from '@jamo/opc';
import { W_NS } from './wordml.js';

export const PART = {
  document: 'word/document.xml',
  styles: 'word/styles.xml',
  settings: 'word/settings.xml',
  fontTable: 'word/fontTable.xml',
  core: 'docProps/core.xml',
  app: 'docProps/app.xml',
} as const;

export interface BlankDocxOptions {
  /** 기본 글꼴. 한글 윈도우에 기본 설치된 글꼴을 쓰는 게 안전하다. */
  fontFamily?: string;
  /** pt. */
  fontSize?: number;
  /** 용지 (twip). 기본 A4. */
  paper?: { width: number; height: number; landscape?: boolean };
  title?: string;
  creator?: string;
  text?: string;
  application?: string;
}

/** A4 (twip). 210mm × 297mm. */
export const A4_TWIP = { width: 11906, height: 16838 } as const;

/** 2.5cm 여백 (twip). */
const DEFAULT_MARGIN = {
  top: 1417,
  right: 1417,
  bottom: 1417,
  left: 1417,
  header: 851,
  footer: 992,
  gutter: 0,
} as const;

export interface PaperTwip {
  width: number;
  height: number;
}

export function sectionProperties(
  paper: PaperTwip = A4_TWIP,
  landscape = false,
): XmlElement {
  const width = landscape ? paper.height : paper.width;
  const height = landscape ? paper.width : paper.height;
  return element('w:sectPr', {}, [
    element('w:pgSz', {
      'w:w': String(width),
      'w:h': String(height),
      ...(landscape ? { 'w:orient': 'landscape' } : {}),
    }),
    element('w:pgMar', {
      'w:top': String(DEFAULT_MARGIN.top),
      'w:right': String(DEFAULT_MARGIN.right),
      'w:bottom': String(DEFAULT_MARGIN.bottom),
      'w:left': String(DEFAULT_MARGIN.left),
      'w:header': String(DEFAULT_MARGIN.header),
      'w:footer': String(DEFAULT_MARGIN.footer),
      'w:gutter': String(DEFAULT_MARGIN.gutter),
    }),
    element('w:cols', { 'w:space': '425' }),
    element('w:docGrid', { 'w:linePitch': '360' }),
  ]);
}

export function blankDocumentXml(opts: BlankDocxOptions = {}): XmlDocument {
  const body: XmlElement[] = [];
  if (opts.text !== undefined) {
    body.push(element('w:p', {}, [element('w:r', {}, [textNode(opts.text)])]));
  } else {
    body.push(element('w:p'));
  }
  body.push(sectionProperties(opts.paper ?? A4_TWIP, opts.paper?.landscape ?? false));

  return xmlDocumentOf(
    element(
      'w:document',
      { 'xmlns:w': W_NS.w, 'xmlns:r': W_NS.r },
      [element('w:body', {}, body)],
    ),
  );
}

function textNode(value: string): XmlElement {
  const el = element('w:t', /^\s|\s$/.test(value) ? { 'xml:space': 'preserve' } : {});
  setTextContent(el, value);
  return el;
}

function heading(styleId: string, name: string, level: number, sizeHalfPt: number): XmlElement {
  return element('w:style', { 'w:type': 'paragraph', 'w:styleId': styleId }, [
    element('w:name', { 'w:val': name }),
    element('w:basedOn', { 'w:val': 'Normal' }),
    element('w:next', { 'w:val': 'Normal' }),
    element('w:qFormat'),
    element('w:pPr', {}, [
      element('w:keepNext'),
      element('w:spacing', { 'w:before': '240', 'w:after': '120' }),
      element('w:outlineLvl', { 'w:val': String(level) }),
    ]),
    element('w:rPr', {}, [
      element('w:b'),
      element('w:sz', { 'w:val': String(sizeHalfPt) }),
      element('w:szCs', { 'w:val': String(sizeHalfPt) }),
    ]),
  ]);
}

export function blankStylesXml(opts: BlankDocxOptions = {}): XmlDocument {
  const font = opts.fontFamily ?? '맑은 고딕';
  const half = String(Math.round((opts.fontSize ?? 10) * 2));
  return xmlDocumentOf(
    element('w:styles', { 'xmlns:w': W_NS.w, 'xmlns:r': W_NS.r }, [
      element('w:docDefaults', {}, [
        element('w:rPrDefault', {}, [
          element('w:rPr', {}, [
            element('w:rFonts', {
              'w:ascii': font,
              'w:eastAsia': font,
              'w:hAnsi': font,
              'w:cs': font,
            }),
            element('w:sz', { 'w:val': half }),
            element('w:szCs', { 'w:val': half }),
          ]),
        ]),
        element('w:pPrDefault', {}, [
          element('w:pPr', {}, [
            element('w:spacing', { 'w:line': '276', 'w:lineRule': 'auto' }),
          ]),
        ]),
      ]),
      element(
        'w:style',
        { 'w:type': 'paragraph', 'w:default': '1', 'w:styleId': 'Normal' },
        [element('w:name', { 'w:val': 'Normal' }), element('w:qFormat')],
      ),
      heading('Heading1', 'heading 1', 0, 32),
      heading('Heading2', 'heading 2', 1, 26),
      heading('Heading3', 'heading 3', 2, 24),
    ]),
  );
}

export function blankCorePropsXml(opts: BlankDocxOptions = {}): XmlDocument {
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const created = element('dcterms:created', { 'xsi:type': 'dcterms:W3CDTF' });
  setTextContent(created, now);
  const modified = element('dcterms:modified', { 'xsi:type': 'dcterms:W3CDTF' });
  setTextContent(modified, now);

  const title = element('dc:title');
  if (opts.title) setTextContent(title, opts.title);
  const creator = element('dc:creator');
  if (opts.creator) setTextContent(creator, opts.creator);

  return xmlDocumentOf(
    element(
      'cp:coreProperties',
      {
        'xmlns:cp': 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties',
        'xmlns:dc': 'http://purl.org/dc/elements/1.1/',
        'xmlns:dcterms': 'http://purl.org/dc/terms/',
        'xmlns:dcmitype': 'http://purl.org/dc/dcmitype/',
        'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
      },
      [title, creator, element('cp:lastModifiedBy'), created, modified],
    ),
  );
}

export function blankAppPropsXml(opts: BlankDocxOptions = {}): XmlDocument {
  const app = element('Application');
  setTextContent(app, opts.application ?? 'Jamo Office');
  return xmlDocumentOf(
    element(
      'Properties',
      {
        xmlns: 'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties',
        'xmlns:vt': 'http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes',
      },
      [app],
    ),
  );
}

export function blankSettingsXml(): XmlDocument {
  return xmlDocumentOf(
    element('w:settings', { 'xmlns:w': W_NS.w }, [
      element('w:compat', {}, [
        element('w:compatSetting', {
          'w:name': 'compatibilityMode',
          'w:uri': 'http://schemas.microsoft.com/office/word',
          'w:val': '15',
        }),
      ]),
    ]),
  );
}
