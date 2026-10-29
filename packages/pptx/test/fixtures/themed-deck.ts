import { parseXml, serializeXml, stringToEntry, zip, type ZipEntries } from '@jamo/core';

/**
 * 테마·마스터·레이아웃이 제대로 얽힌 PPTX 를 손으로 짠다.
 *
 * 우리 blank() 로 만든 덱은 너무 단순해서, 실제 파일에서 문제가 되는 것들을
 * 재현하지 못한다. 특히 이것들을 일부러 넣었다:
 *  - 슬라이드에는 글자 크기·색이 **없고** 레이아웃·마스터에만 있다
 *  - 배경이 마스터에만 있다
 *  - clrMap 이 bg1 → dk2 처럼 **뒤집혀** 있다 (어두운 테마의 흔한 모습)
 *  - 그룹 안에 도형이 있어 좌표 변환이 필요하다
 */

const CT = {
  presentation: 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
  slide: 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml',
  master: 'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml',
  layout: 'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml',
  theme: 'application/vnd.openxmlformats-officedocument.theme+xml',
};

const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const EMPTY_TREE = `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree>`;

/** 색 이름이 뒤집힌 어두운 테마. bg1 이 밝은 색이 아니라 짙은 남색을 가리킨다. */
const THEME = `${DECL}
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="어두운테마">
<a:themeElements>
<a:clrScheme name="어두운테마">
<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="1A2236"/></a:dk2>
<a:lt2><a:srgbClr val="E8EAF0"/></a:lt2>
<a:accent1><a:srgbClr val="C9A227"/></a:accent1>
<a:accent2><a:srgbClr val="4472C4"/></a:accent2>
<a:accent3><a:srgbClr val="70AD47"/></a:accent3>
<a:accent4><a:srgbClr val="FFC000"/></a:accent4>
<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5>
<a:accent6><a:srgbClr val="ED7D31"/></a:accent6>
<a:hlink><a:srgbClr val="0563C1"/></a:hlink>
<a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
</a:clrScheme>
<a:fontScheme name="어두운테마">
<a:majorFont><a:latin typeface="Noto Sans"/><a:ea typeface="나눔스퀘어"/><a:cs typeface=""/></a:majorFont>
<a:minorFont><a:latin typeface="Noto Sans"/><a:ea typeface="본고딕"/><a:cs typeface=""/></a:minorFont>
</a:fontScheme>
<a:fmtScheme name="어두운테마">
<a:fillStyleLst>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:solidFill><a:schemeClr val="phClr"><a:lumMod val="60000"/></a:schemeClr></a:solidFill>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
</a:fillStyleLst>
<a:lnStyleLst><a:ln/><a:ln/><a:ln/></a:lnStyleLst>
<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
<a:bgFillStyleLst>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
</a:bgFillStyleLst>
</a:fmtScheme>
</a:themeElements>
</a:theme>`;

/** 마스터: 배경은 bgRef 로 테마를 가리키고, 제목은 44pt 금색으로 정해 둔다. */
const MASTER = `${DECL}
<p:sldMaster ${NS}>
<p:cSld>
<p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>
${EMPTY_TREE}
</p:cSld>
<p:clrMap bg1="dk2" tx1="lt1" bg2="lt2" tx2="dk1" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
<p:txStyles>
<p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="4400" b="1"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:latin typeface="+mj-ea"/></a:defRPr></a:lvl1pPr></p:titleStyle>
<p:bodyStyle><a:lvl1pPr><a:defRPr sz="2000"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:defRPr></a:lvl1pPr><a:lvl2pPr><a:defRPr sz="1600"/></a:lvl2pPr></p:bodyStyle>
<p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle>
</p:txStyles>
</p:sldMaster>`;

/** 레이아웃: 제목 자리의 위치를 정하고, 본문은 마스터를 따른다. */
const LAYOUT = `${DECL}
<p:sldLayout ${NS} type="titleOnly" preserve="1">
<p:cSld name="제목만">
<p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
<p:sp>
<p:nvSpPr><p:cNvPr id="2" name="제목 자리"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="838200" y="365125"/><a:ext cx="10515600" cy="1325563"/></a:xfrm></p:spPr>
<p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:endParaRPr lang="ko-KR"/></a:p></p:txBody>
</p:sp>
<p:sp>
<p:nvSpPr><p:cNvPr id="3" name="레이아웃 장식 띠"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="120000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="ko-KR"/></a:p></p:txBody>
</p:sp>
</p:spTree>
</p:cSld>
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>`;

/**
 * 슬라이드: 제목에 **서식을 하나도 적지 않는다.** 44pt 금색 나눔스퀘어는
 * 마스터·테마에서 물려받아야 한다. 그림, 그룹, 둥근 사각형, 표도 넣는다.
 */
const SLIDE = `${DECL}
<p:sld ${NS}>
<p:cSld>
<p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
<p:sp>
<p:nvSpPr><p:cNvPr id="2" name="제목"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
<p:spPr/>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="ko-KR"/><a:t>영광을 만나기 위한 준비</a:t></a:r></a:p></p:txBody>
</p:sp>
<p:pic>
<p:nvPicPr><p:cNvPr id="3" name="사진"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
<p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm><a:off x="6096000" y="2000000"/><a:ext cx="2000000" cy="1500000"/></a:xfrm><a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom></p:spPr>
</p:pic>
<p:grpSp>
<p:nvGrpSpPr><p:cNvPr id="4" name="묶음"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="1000000" y="3000000"/><a:ext cx="2000000" cy="1000000"/><a:chOff x="0" y="0"/><a:chExt cx="1000000" cy="500000"/></a:xfrm></p:grpSpPr>
<p:sp>
<p:nvSpPr><p:cNvPr id="5" name="카드"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="100000" y="100000"/><a:ext cx="400000" cy="200000"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 20000"/></a:avLst></a:prstGeom><a:solidFill><a:srgbClr val="FF8800"/></a:solidFill></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="ko-KR"/><a:t>카드</a:t></a:r></a:p></p:txBody>
</p:sp>
</p:grpSp>
<p:graphicFrame>
<p:nvGraphicFramePr><p:cNvPr id="6" name="표"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
<p:xfrm><a:off x="500000" y="5000000"/><a:ext cx="4000000" cy="1000000"/></p:xfrm>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
<a:tbl>
<a:tblGrid><a:gridCol w="2000000"/><a:gridCol w="2000000"/></a:tblGrid>
<a:tr h="500000">
<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="ko-KR"/><a:t>항목</a:t></a:r></a:p></a:txBody><a:tcPr><a:solidFill><a:srgbClr val="223344"/></a:solidFill></a:tcPr></a:tc>
<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="ko-KR"/><a:t>값</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>
</a:tr>
<a:tr h="500000">
<a:tc gridSpan="2"><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="ko-KR"/><a:t>합쳐진 칸</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>
<a:tc hMerge="1"><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="ko-KR"/></a:p></a:txBody><a:tcPr/></a:tc>
</a:tr>
</a:tbl>
</a:graphicData></a:graphic>
</p:graphicFrame>
</p:spTree>
</p:cSld>
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;

const PRESENTATION = `${DECL}
<p:presentation ${NS}>
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
<p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>
<p:sldSz cx="12192000" cy="6858000"/>
<p:notesSz cx="6858000" cy="12192000"/>
</p:presentation>`;

/** 1×1 투명 PNG. 내용은 중요하지 않고 "파트가 있다"는 사실만 쓴다. */
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

function rels(items: Array<{ id: string; type: string; target: string }>): string {
  return `${DECL}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${items.map((i) => `<Relationship Id="${i.id}" Type="${i.type}" Target="${i.target}"/>`).join('')}
</Relationships>`;
}

function contentTypes(): string {
  return `${DECL}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/ppt/presentation.xml" ContentType="${CT.presentation}"/>
<Override PartName="/ppt/slides/slide1.xml" ContentType="${CT.slide}"/>
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="${CT.master}"/>
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="${CT.layout}"/>
<Override PartName="/ppt/theme/theme1.xml" ContentType="${CT.theme}"/>
</Types>`;
}

/** 어두운 테마 + 그림 + 그룹 + 표가 든 덱을 만든다. */
export function buildThemedDeck(): Uint8Array {
  const entries: ZipEntries = new Map();
  const put = (path: string, xml: string): void => {
    // 한 번 파싱했다가 다시 쓴다. 우리 직렬화기를 거친 결과로 시험하기 위함.
    entries.set(path, stringToEntry(serializeXml(parseXml(xml))));
  };

  entries.set('[Content_Types].xml', stringToEntry(contentTypes()));
  put('_rels/.rels', rels([{ id: 'rId1', type: `${R}/officeDocument`, target: 'ppt/presentation.xml' }]));
  put('ppt/presentation.xml', PRESENTATION);
  put(
    'ppt/_rels/presentation.xml.rels',
    rels([
      { id: 'rId1', type: `${R}/slideMaster`, target: 'slideMasters/slideMaster1.xml' },
      { id: 'rId2', type: `${R}/slide`, target: 'slides/slide1.xml' },
      { id: 'rId3', type: `${R}/theme`, target: 'theme/theme1.xml' },
    ]),
  );
  put('ppt/slideMasters/slideMaster1.xml', MASTER);
  put(
    'ppt/slideMasters/_rels/slideMaster1.xml.rels',
    rels([
      { id: 'rId1', type: `${R}/slideLayout`, target: '../slideLayouts/slideLayout1.xml' },
      { id: 'rId2', type: `${R}/theme`, target: '../theme/theme1.xml' },
    ]),
  );
  put('ppt/slideLayouts/slideLayout1.xml', LAYOUT);
  put(
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
    rels([{ id: 'rId1', type: `${R}/slideMaster`, target: '../slideMasters/slideMaster1.xml' }]),
  );
  put('ppt/theme/theme1.xml', THEME);
  put('ppt/slides/slide1.xml', SLIDE);
  put(
    'ppt/slides/_rels/slide1.xml.rels',
    rels([
      { id: 'rId1', type: `${R}/slideLayout`, target: '../slideLayouts/slideLayout1.xml' },
      { id: 'rId2', type: `${R}/image`, target: '../media/image1.png' },
    ]),
  );
  entries.set('ppt/media/image1.png', PNG_BYTES);

  return zip(entries, { order: ['[Content_Types].xml', '_rels/.rels'] });
}

export { PNG_BYTES };
