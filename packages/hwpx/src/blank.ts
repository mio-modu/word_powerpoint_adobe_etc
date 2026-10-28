import { element, PAPER, type XmlDocument, type XmlElement } from '@jamo/core';
import { ENTRY, FILE_ID, MIME, NS, sectionEntry, sectionId } from './constants.js';

/**
 * 빈 HWPX 문서를 만든다.
 *
 * 참조 구현의 번호 체계를 그대로 베끼지 않고, **내부적으로 일관된** 최소
 * 집합을 만든다. 예컨대 참조 구현의 "바탕글" 스타일은 paraPr 3번을 가리키는데,
 * paraPr 을 0번만 만들어 놓고 3번을 가리키면 깨진 문서가 된다.
 * 그래서 여기서는 charPr 0 / paraPr 0 / style 0 으로 닫아 둔다.
 */

export interface BlankOptions {
  /** 한글이 '만든 프로그램'으로 표시할 이름. */
  application?: string;
  appVersion?: string;
  paper?: { width: number; height: number };
  /** 첫 문단에 넣을 텍스트. */
  text?: string;
  language?: string;
}

function doc(root: XmlElement): XmlDocument {
  return {
    declaration: { version: '1.0', encoding: 'UTF-8', standalone: 'yes' },
    prolog: [],
    root,
    epilog: [],
  };
}

export function blankVersionXml(opts: BlankOptions = {}): XmlDocument {
  return doc(
    element('hv:HCFVersion', {
      'xmlns:hv': NS.hv,
      // 스펙의 오타. 고치면 한글이 못 읽는다.
      tagetApplication: 'WORDPROCESSOR',
      major: 5,
      minor: 0,
      micro: 5,
      buildNumber: 0,
      os: 1,
      xmlVersion: '1.4',
      application: opts.application ?? 'Jamo Office',
      appVersion: opts.appVersion ?? '0.1.0',
    }),
  );
}

export function blankContainerXml(): XmlDocument {
  return doc(
    element(
      'ocf:container',
      { 'xmlns:ocf': NS.ocf, 'xmlns:hpf': NS.hpf },
      [
        element('ocf:rootfiles', {}, [
          element('ocf:rootfile', {
            'full-path': ENTRY.contentHpf,
            'media-type': MIME.hwpmlPackage,
          }),
        ]),
      ],
    ),
  );
}

export function blankManifestXml(): XmlDocument {
  return doc(
    element('odf:manifest', { 'xmlns:odf': NS.odf }, [
      element('odf:file-entry', { 'full-path': '/', 'media-type': MIME.hwpx }),
      element('odf:file-entry', { 'full-path': ENTRY.version, 'media-type': MIME.xml }),
      element('odf:file-entry', { 'full-path': ENTRY.contentHpf, 'media-type': MIME.hwpmlPackage }),
      element('odf:file-entry', { 'full-path': ENTRY.header, 'media-type': MIME.xml }),
      element('odf:file-entry', { 'full-path': sectionEntry(0), 'media-type': MIME.xml }),
      element('odf:file-entry', { 'full-path': ENTRY.settings, 'media-type': MIME.xml }),
    ]),
  );
}

export function blankSettingsXml(): XmlDocument {
  return doc(
    element('ha:HWPApplicationSetting', { 'xmlns:ha': NS.ha, 'xmlns:config': NS.config }, [
      element('ha:CaretPosition', { listIDRef: 0, paraIDRef: 0, pos: 0 }),
    ]),
  );
}

export function blankContentHpf(opts: BlankOptions = {}): XmlDocument {
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  return doc(
    element(
      'opf:package',
      {
        'xmlns:ha': NS.ha,
        'xmlns:hp': NS.hp,
        'xmlns:hp10': NS.hp10,
        'xmlns:hs': NS.hs,
        'xmlns:hc': NS.hc,
        'xmlns:hh': NS.hh,
        'xmlns:hhs': NS.hhs,
        'xmlns:hm': NS.hm,
        'xmlns:hpf': NS.hpf,
        'xmlns:dc': NS.dc,
        'xmlns:opf': NS.opf,
        'xmlns:ooxmlchart': NS.ooxmlchart,
        'xmlns:hwpunitchar': NS.hwpunitchar,
        'xmlns:epub': NS.epub,
        'xmlns:config': NS.config,
        version: '',
        'unique-identifier': '',
        id: '',
      },
      [
        element('opf:metadata', {}, [
          element('opf:title', {}, []),
          element('opf:language', {}, [{ kind: 'text', text: opts.language ?? 'ko' }]),
          metaItem('creator', ''),
          metaItem('subject', ''),
          metaItem('description', ''),
          metaItem('lastsaveby', ''),
          metaItem('CreatedDate', now),
          metaItem('ModifiedDate', now),
          metaItem('keyword', ''),
        ]),
        element('opf:manifest', {}, [
          element('opf:item', {
            id: FILE_ID.header,
            href: ENTRY.header,
            'media-type': MIME.xml,
          }),
          element('opf:item', {
            id: sectionId(0),
            href: sectionEntry(0),
            'media-type': MIME.xml,
          }),
          element('opf:item', {
            id: FILE_ID.settings,
            href: ENTRY.settings,
            'media-type': MIME.xml,
          }),
        ]),
        element('opf:spine', {}, [
          element('opf:itemref', { idref: FILE_ID.header, linear: 'yes' }),
          element('opf:itemref', { idref: sectionId(0), linear: 'yes' }),
        ]),
      ],
    ),
  );
}

function metaItem(name: string, value: string): XmlElement {
  return element('opf:meta', { name, content: 'text' }, value ? [{ kind: 'text', text: value }] : []);
}

const LANGS = ['HANGUL', 'LATIN', 'HANJA', 'JAPANESE', 'OTHER', 'SYMBOL', 'USER'] as const;

function fontface(lang: string): XmlElement {
  return element('hh:fontface', { lang, fontCnt: 2 }, [
    font('0', '함초롬돋움'),
    font('1', '함초롬바탕'),
  ]);
}

function font(id: string, face: string): XmlElement {
  return element('hh:font', { id, face, type: 'TTF', isEmbedded: 0 }, [
    element('hh:typeInfo', {
      familyType: 'FCAT_GOTHIC',
      weight: 8,
      proportion: 4,
      contrast: 0,
      strokeVariation: 1,
      armStyle: 1,
      letterform: 1,
      midline: 1,
      xHeight: 1,
    }),
  ]);
}

function borderFill(id: string, withFill: boolean): XmlElement {
  const children: XmlElement[] = [
    element('hh:slash', { type: 'NONE', Crooked: 0, isCounter: 0 }),
    element('hh:backSlash', { type: 'NONE', Crooked: 0, isCounter: 0 }),
    element('hh:leftBorder', { type: 'NONE', width: '0.1 mm', color: '#000000' }),
    element('hh:rightBorder', { type: 'NONE', width: '0.1 mm', color: '#000000' }),
    element('hh:topBorder', { type: 'NONE', width: '0.1 mm', color: '#000000' }),
    element('hh:bottomBorder', { type: 'NONE', width: '0.1 mm', color: '#000000' }),
    element('hh:diagonal', { type: 'SOLID', width: '0.1 mm', color: '#000000' }),
  ];
  if (withFill) {
    children.push(
      element('hc:fillBrush', {}, [
        element('hc:winBrush', { faceColor: 'none', hatchColor: '#FF000000', alpha: 0 }),
      ]),
    );
  }
  return element(
    'hh:borderFill',
    { id, threeD: 0, shadow: 0, centerLine: 'NONE', breakCellSeparateLine: 0 },
    children,
  );
}

function sevenLang(name: string, value: string | number): XmlElement {
  return element(name, {
    hangul: value,
    latin: value,
    hanja: value,
    japanese: value,
    other: value,
    symbol: value,
    user: value,
  });
}

function defaultCharPr(): XmlElement {
  return element(
    'hh:charPr',
    {
      id: '0',
      height: 1000,
      textColor: '#000000',
      shadeColor: 'none',
      useFontSpace: 0,
      useKerning: 0,
      symMark: 'NONE',
      borderFillIDRef: '2',
    },
    [
      sevenLang('hh:fontRef', '1'),
      sevenLang('hh:ratio', 100),
      sevenLang('hh:spacing', 0),
      sevenLang('hh:relSz', 100),
      sevenLang('hh:offset', 0),
      element('hh:underline', { type: 'NONE', shape: 'SOLID', color: '#000000' }),
      element('hh:strikeout', { shape: 'NONE', color: '#000000' }),
      element('hh:outline', { type: 'NONE' }),
      element('hh:shadow', { type: 'NONE', color: '#B2B2B2', offsetX: 10, offsetY: 10 }),
    ],
  );
}

function defaultParaPr(): XmlElement {
  return element(
    'hh:paraPr',
    {
      id: '0',
      tabPrIDRef: '0',
      condense: 0,
      fontLineHeight: 0,
      snapToGrid: 1,
      suppressLineNumbers: 0,
      checked: 0,
    },
    [
      element('hh:align', { horizontal: 'JUSTIFY', vertical: 'BASELINE' }),
      element('hh:heading', { type: 'NONE', idRef: '0', level: 0 }),
      element('hh:breakSetting', {
        breakLatinWord: 'KEEP_WORD',
        breakNonLatinWord: 'BREAK_WORD',
        widowOrphan: 0,
        keepWithNext: 0,
        keepLines: 0,
        pageBreakBefore: 0,
        lineWrap: 'BREAK',
      }),
      element('hh:autoSpacing', { eAsianEng: 0, eAsianNum: 0 }),
      element('hh:margin', {}, [
        element('hc:intent', { value: 0, unit: 'HWPUNIT' }),
        element('hc:left', { value: 0, unit: 'HWPUNIT' }),
        element('hc:right', { value: 0, unit: 'HWPUNIT' }),
        element('hc:prev', { value: 0, unit: 'HWPUNIT' }),
        element('hc:next', { value: 0, unit: 'HWPUNIT' }),
      ]),
      element('hh:lineSpacing', { type: 'PERCENT', value: 160, unit: 'HWPUNIT' }),
      element('hh:border', {
        borderFillIDRef: '2',
        offsetLeft: 0,
        offsetRight: 0,
        offsetTop: 0,
        offsetBottom: 0,
        connect: 0,
        ignoreMargin: 0,
      }),
    ],
  );
}

export function blankHeaderXml(): XmlDocument {
  return doc(
    element(
      'hh:head',
      {
        'xmlns:hh': NS.hh,
        'xmlns:hp': NS.hp,
        'xmlns:hc': NS.hc,
        version: '1.4',
        secCnt: 1,
      },
      [
        element('hh:beginNum', { page: 1, footnote: 1, endnote: 1, pic: 1, tbl: 1, equation: 1 }),
        element('hh:refList', {}, [
          element('hh:fontfaces', { itemCnt: LANGS.length }, LANGS.map(fontface)),
          element('hh:borderFills', { itemCnt: 2 }, [borderFill('1', false), borderFill('2', true)]),
          element('hh:charProperties', { itemCnt: 1 }, [defaultCharPr()]),
          element('hh:tabProperties', { itemCnt: 1 }, [
            element('hh:tabPr', { id: '0', autoTabLeft: 0, autoTabRight: 0 }),
          ]),
          element('hh:numberings', { itemCnt: 0 }),
          element('hh:paraProperties', { itemCnt: 1 }, [defaultParaPr()]),
          element('hh:styles', { itemCnt: 1 }, [
            element('hh:style', {
              id: '0',
              type: 'PARA',
              name: '바탕글',
              engName: 'Normal',
              paraPrIDRef: '0',
              charPrIDRef: '0',
              nextStyleIDRef: '0',
              langID: '1042',
              lockForm: 0,
            }),
          ]),
        ]),
        element('hh:compatibleDocument', { targetProgram: 'HWP201X' }, [
          element('hh:layoutCompatibility', {}),
        ]),
        element('hh:docOption', {}, [
          element('hh:linkinfo', { path: '', pageInherit: 0, footnoteInherit: 0 }),
        ]),
        element('hh:trackchageConfig', { flags: 56 }),
      ],
    ),
  );
}

export function blankSecPr(paper: { width: number; height: number }): XmlElement {
  return element(
    'hp:secPr',
    {
      id: '',
      textDirection: 'HORIZONTAL',
      spaceColumns: 1134,
      tabStop: 8000,
      tabStopVal: 4000,
      tabStopUnit: 'HWPUNIT',
      outlineShapeIDRef: '1',
      memoShapeIDRef: '0',
      textVerticalWidthHead: 0,
    },
    [
      element('hp:grid', { lineGrid: 0, charGrid: 0, wonggojiFormat: 0, strtpgNum: 0, onlySetCharGrid: 0 }),
      element('hp:startNum', { pageStartsOn: 'BOTH', page: 0, pic: 0, tbl: 0, equation: 0 }),
      element('hp:visibility', {
        hideFirstHeader: 0,
        hideFirstFooter: 0,
        hideFirstMasterPage: 0,
        border: 'SHOW_ALL',
        fill: 'SHOW_ALL',
        hideFirstPageNum: 0,
        hideFirstEmptyLine: 0,
        showLineNumber: 0,
      }),
      element('hp:lineNumberShape', { restartType: 0, countBy: 0, distance: 0, startNumber: 0 }),
      element(
        'hp:pagePr',
        {
          landscape: 'WIDELY',
          width: paper.width,
          height: paper.height,
          gutterType: 'LEFT_ONLY',
        },
        [
          element('hp:margin', {
            header: 4252,
            footer: 4252,
            gutter: 0,
            left: 8504,
            right: 8504,
            top: 5668,
            bottom: 4252,
          }),
        ],
      ),
      element('hp:footNotePr', {}, [
        element('hp:autoNumFormat', { type: 'DIGIT', userChar: '', prefixChar: '', suffixChar: ')', supscript: 0 }),
        element('hp:noteLine', { length: -1, type: 'SOLID', width: '0.12 mm', color: '#000000' }),
        element('hp:noteSpacing', { betweenNotes: 283, belowLine: 567, aboveLine: 850 }),
        element('hp:numbering', { type: 'CONTINUOUS', newNum: 1 }),
        element('hp:placement', { place: 'EACH_COLUMN', beneathText: 0 }),
      ]),
      element('hp:endNotePr', {}, [
        element('hp:autoNumFormat', { type: 'DIGIT', userChar: '', prefixChar: '', suffixChar: ')', supscript: 0 }),
        element('hp:noteLine', { length: 14692344, type: 'SOLID', width: '0.12 mm', color: '#000000' }),
        element('hp:noteSpacing', { betweenNotes: 0, belowLine: 567, aboveLine: 850 }),
        element('hp:numbering', { type: 'CONTINUOUS', newNum: 1 }),
        element('hp:placement', { place: 'END_OF_DOCUMENT', beneathText: 0 }),
      ]),
      ...(['BOTH', 'EVEN', 'ODD'] as const).map((type) =>
        element(
          'hp:pageBorderFill',
          {
            type,
            borderFillIDRef: '1',
            textBorder: 'PAPER',
            headerInside: 0,
            footerInside: 0,
            fillArea: 'PAPER',
          },
          [element('hp:offset', { left: 1417, right: 1417, top: 1417, bottom: 1417 })],
        ),
      ),
    ],
  );
}

/** 문단 1줄에 해당하는 기본 lineSegArray. 한글이 열 때 다시 계산한다. */
export function defaultLineSegArray(textWidth = 42520): XmlElement {
  return element('hp:linesegarray', {}, [
    element('hp:lineseg', {
      textpos: 0,
      vertpos: 0,
      vertsize: 1000,
      textheight: 1000,
      baseline: 850,
      spacing: 600,
      horzpos: 0,
      horzsize: textWidth,
      flags: 393216,
    }),
  ]);
}

export function blankSectionXml(opts: BlankOptions = {}): XmlDocument {
  const paper = opts.paper ?? PAPER.A4;
  const runChildren: XmlElement[] = [
    blankSecPr(paper),
    element('hp:ctrl', {}, [
      element('hp:colPr', {
        id: '',
        type: 'NEWSPAPER',
        layout: 'LEFT',
        colCount: 1,
        sameSz: 1,
        sameGap: 0,
      }),
    ]),
  ];
  const t = element('hp:t', {}, opts.text ? [{ kind: 'text', text: opts.text }] : []);
  runChildren.push(t);

  return doc(
    element(
      'hs:sec',
      {
        'xmlns:hs': NS.hs,
        'xmlns:hp': NS.hp,
        'xmlns:hc': NS.hc,
        'xmlns:hh': NS.hh,
      },
      [
        element(
          'hp:p',
          {
            id: '0',
            paraPrIDRef: '0',
            styleIDRef: '0',
            pageBreak: 0,
            columnBreak: 0,
            merged: 0,
          },
          [element('hp:run', { charPrIDRef: '0' }, runChildren), defaultLineSegArray()],
        ),
      ],
    ),
  );
}
