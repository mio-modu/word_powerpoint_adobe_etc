/**
 * PPTX 고정 보일러플레이트.
 *
 * PowerPoint 는 프레젠테이션을 열 때 테마·슬라이드 마스터·레이아웃을
 * 반드시 요구하고, 그중 일부는 자식 개수까지 따진다 (`fillStyleLst` 는 3개,
 * `lnStyleLst` 는 3개 …). 수를 맞추지 않으면 "복구가 필요한 파일"이 된다.
 * 그래서 이 부분은 요소 빌더로 조립하지 않고 검증된 XML 문자열로 둔다.
 * 동적인 부분(슬라이드, 텍스트)만 코드로 만든다.
 */

export const P_NS = {
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
} as const;

export const PART = {
  presentation: 'ppt/presentation.xml',
  theme: 'ppt/theme/theme1.xml',
  slideMaster: 'ppt/slideMasters/slideMaster1.xml',
  slideLayout: 'ppt/slideLayouts/slideLayout1.xml',
  presProps: 'ppt/presProps.xml',
  viewProps: 'ppt/viewProps.xml',
  tableStyles: 'ppt/tableStyles.xml',
  core: 'docProps/core.xml',
  app: 'docProps/app.xml',
} as const;

export function slidePart(index: number): string {
  return `ppt/slides/slide${index}.xml`;
}

const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NS_PA = `xmlns:a="${P_NS.a}" xmlns:r="${P_NS.r}" xmlns:p="${P_NS.p}"`;

/** 16:9 (EMU). 12192000 × 6858000 = 13.333in × 7.5in */
export const SLIDE_SIZE_16_9 = { width: 12192000, height: 6858000 } as const;
/** 4:3 (EMU). */
export const SLIDE_SIZE_4_3 = { width: 9144000, height: 6858000 } as const;

export function presentationXml(
  slideCount: number,
  size: { width: number; height: number },
): string {
  // rId1 = slideMaster, rId2.. = 슬라이드, 그 뒤가 theme/presProps/… 순서다.
  const slideIds = Array.from(
    { length: slideCount },
    (_unused, i) => `<p:sldId id="${256 + i}" r:id="rId${2 + i}"/>`,
  ).join('');
  return `${DECL}
<p:presentation ${NS_PA} saveSubsetFonts="1">\
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>\
<p:sldIdLst>${slideIds}</p:sldIdLst>\
<p:sldSz cx="${size.width}" cy="${size.height}"/>\
<p:notesSz cx="${size.height}" cy="${size.width}"/>\
</p:presentation>`;
}

const EMPTY_SP_TREE = `<p:spTree>\
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>\
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>\
<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>\
</p:spTree>`;

export function slideMasterXml(): string {
  const txStyle = (sizes: number[]): string =>
    sizes
      .map(
        (sz, i) =>
          `<a:lvl${i + 1}pPr><a:defRPr sz="${sz}"/></a:lvl${i + 1}pPr>`,
      )
      .join('');
  return `${DECL}
<p:sldMaster ${NS_PA}>\
<p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>${EMPTY_SP_TREE}</p:cSld>\
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" \
accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>\
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>\
<p:txStyles>\
<p:titleStyle>${txStyle([4400])}</p:titleStyle>\
<p:bodyStyle>${txStyle([3200, 2800, 2400, 2000, 2000, 2000, 2000, 2000, 2000])}</p:bodyStyle>\
<p:otherStyle>${txStyle([1800, 1800, 1800, 1800, 1800, 1800, 1800, 1800, 1800])}</p:otherStyle>\
</p:txStyles>\
</p:sldMaster>`;
}

export function slideLayoutXml(): string {
  return `${DECL}
<p:sldLayout ${NS_PA} type="blank" preserve="1">\
<p:cSld name="빈 화면">${EMPTY_SP_TREE}</p:cSld>\
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>\
</p:sldLayout>`;
}

export function emptySlideXml(): string {
  return `${DECL}
<p:sld ${NS_PA}>\
<p:cSld>${EMPTY_SP_TREE}</p:cSld>\
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>\
</p:sld>`;
}

/**
 * 테마. PowerPoint 는 fillStyleLst/lnStyleLst/effectStyleLst/bgFillStyleLst 의
 * 항목 수를 각각 3/3/3/3 으로 기대한다.
 */
export function themeXml(opts: { majorFont?: string; minorFont?: string } = {}): string {
  const major = opts.majorFont ?? '맑은 고딕';
  const minor = opts.minorFont ?? '맑은 고딕';
  const solid = (val: string): string => `<a:solidFill><a:schemeClr val="${val}"/></a:solidFill>`;
  const line = (w: number): string =>
    `<a:ln w="${w}" cap="flat" cmpd="sng" algn="ctr">${solid('phClr')}<a:prstDash val="solid"/></a:ln>`;
  return `${DECL}
<a:theme xmlns:a="${P_NS.a}" name="Jamo">\
<a:themeElements>\
<a:clrScheme name="Jamo">\
<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>\
<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>\
<a:dk2><a:srgbClr val="44546A"/></a:dk2>\
<a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>\
<a:accent1><a:srgbClr val="4472C4"/></a:accent1>\
<a:accent2><a:srgbClr val="ED7D31"/></a:accent2>\
<a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>\
<a:accent4><a:srgbClr val="FFC000"/></a:accent4>\
<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5>\
<a:accent6><a:srgbClr val="70AD47"/></a:accent6>\
<a:hlink><a:srgbClr val="0563C1"/></a:hlink>\
<a:folHlink><a:srgbClr val="954F72"/></a:folHlink>\
</a:clrScheme>\
<a:fontScheme name="Jamo">\
<a:majorFont><a:latin typeface="${major}"/><a:ea typeface="${major}"/><a:cs typeface=""/></a:majorFont>\
<a:minorFont><a:latin typeface="${minor}"/><a:ea typeface="${minor}"/><a:cs typeface=""/></a:minorFont>\
</a:fontScheme>\
<a:fmtScheme name="Jamo">\
<a:fillStyleLst>${solid('phClr')}${solid('phClr')}${solid('phClr')}</a:fillStyleLst>\
<a:lnStyleLst>${line(6350)}${line(12700)}${line(19050)}</a:lnStyleLst>\
<a:effectStyleLst>\
<a:effectStyle><a:effectLst/></a:effectStyle>\
<a:effectStyle><a:effectLst/></a:effectStyle>\
<a:effectStyle><a:effectLst/></a:effectStyle>\
</a:effectStyleLst>\
<a:bgFillStyleLst>${solid('phClr')}${solid('phClr')}${solid('phClr')}</a:bgFillStyleLst>\
</a:fmtScheme>\
</a:themeElements>\
</a:theme>`;
}

export function presPropsXml(): string {
  return `${DECL}\n<p:presentationPr ${NS_PA}/>`;
}

export function viewPropsXml(): string {
  return `${DECL}\n<p:viewPr ${NS_PA}/>`;
}

export function tableStylesXml(): string {
  return `${DECL}\n<a:tblStyleLst xmlns:a="${P_NS.a}" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`;
}
