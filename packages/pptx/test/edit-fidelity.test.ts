import { describe, expect, it } from 'vitest';
import { PptxFile } from '@jamo/pptx';
import { childElements, firstChild, parseXml, serializeXml, type XmlElement } from '@jamo/core';

/**
 * 고칠 때 무엇이 남는가.
 *
 * 이 프로젝트의 약속은 "열었다 저장했더니 뭔가 사라지는 일이 없어야 한다"
 * 인데, 글상자를 고치는 길에서 그게 깨져 있었다. 한 글자만 바꿔도 문단을
 * 통째로 다시 만들어 글머리표·정렬·들여쓰기가 날아가고 한 줄 안에 섞여
 * 있던 서식이 하나로 통일됐다. 화면에서는 티가 안 나고 파워포인트에서
 * 열어 봐야 알 수 있는 종류라 더 나빴다.
 *
 * 그래서 여기서는 "글자가 바뀌었는가" 가 아니라 **"안 건드린 곳이 정말로
 * 그대로인가"** 를 본다.
 */

/** 파워포인트가 만들 법한 글상자. 글머리표·정렬·여러 런이 섞여 있다. */
const SHAPE_XML = `<p:sp xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" \
xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">\
<p:nvSpPr><p:cNvPr id="2" name="본문"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>\
<p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>\
<p:spPr/>\
<p:txBody>\
<a:bodyPr><a:normAutofit fontScale="92500"/></a:bodyPr>\
<a:lstStyle><a:lvl1pPr marL="285750" indent="-285750"><a:buChar char="•"/></a:lvl1pPr></a:lstStyle>\
<a:p><a:pPr marL="285750" indent="-285750" algn="just"><a:buChar char="•"/></a:pPr>\
<a:r><a:rPr lang="ko-KR" sz="2400" b="1"><a:solidFill><a:srgbClr val="C8A24A"/></a:solidFill>\
<a:latin typeface="나눔고딕"/></a:rPr><a:t>첫째 줄</a:t></a:r></a:p>\
<a:p><a:pPr lvl="1" algn="ctr"/>\
<a:r><a:rPr lang="ko-KR" sz="1800"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr>\
<a:t>둘째 </a:t></a:r>\
<a:r><a:rPr lang="ko-KR" sz="1800" i="1"><a:solidFill><a:srgbClr val="4A7BC8"/></a:solidFill></a:rPr>\
<a:t>줄</a:t></a:r></a:p>\
<a:p><a:pPr marL="285750" indent="-285750"><a:buChar char="•"/></a:pPr>\
<a:r><a:rPr lang="ko-KR" sz="2000" u="sng"/><a:t>셋째 줄</a:t></a:r></a:p>\
<a:p><a:endParaRPr lang="ko-KR" sz="1600" b="1"/></a:p>\
</p:txBody></p:sp>`;

const shape = (): XmlElement => parseXml(SHAPE_XML).root;
const paragraphs = (sp: XmlElement): XmlElement[] =>
  childElements(firstChild(sp, 'p:txBody')!, 'a:p');
const xmlOf = (el: XmlElement): string => serializeXml({ declaration: {}, prolog: [], root: el, epilog: [] });
const textsOf = (sp: XmlElement): string[] => paragraphs(sp).map((p) => PptxFile.text(p));

describe('글상자를 고칠 때 안 건드린 곳', () => {
  it('글이 그대로인 줄은 XML 이 1바이트도 안 바뀐다', () => {
    const sp = shape();
    const before = paragraphs(sp).map(xmlOf);

    // 셋째 줄만 고친다.
    PptxFile.setShapeText(sp, ['첫째 줄', '둘째 줄', '셋째 줄을 고쳤다', '']);

    const after = paragraphs(sp).map(xmlOf);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(after[3]).toBe(before[3]);
    expect(after[2]).not.toBe(before[2]);
  });

  it('고친 줄도 글머리표와 정렬을 지킨다', () => {
    const sp = shape();
    PptxFile.setShapeText(sp, ['첫째 줄을 고쳤다', '둘째 줄', '셋째 줄', '']);
    const pPr = firstChild(paragraphs(sp)[0]!, 'a:pPr');
    expect(pPr).toBeDefined();
    expect(firstChild(pPr!, 'a:buChar')).toBeDefined();
    expect(xmlOf(pPr!)).toContain('algn="just"');
    expect(xmlOf(pPr!)).toContain('marL="285750"');
  });

  it('런이 하나뿐인 줄은 글자 서식이 그대로다', () => {
    const sp = shape();
    PptxFile.setShapeText(sp, ['바뀐 첫 줄', '둘째 줄', '셋째 줄', '']);
    const xml = xmlOf(paragraphs(sp)[0]!);
    expect(xml).toContain('sz="2400"');
    expect(xml).toContain('b="1"');
    expect(xml).toContain('C8A24A');
    expect(xml).toContain('나눔고딕');
    expect(xml).toContain('바뀐 첫 줄');
  });

  it('bodyPr 과 lstStyle 을 버리지 않는다', () => {
    const sp = shape();
    PptxFile.setShapeText(sp, ['하나']);
    const txBody = firstChild(sp, 'p:txBody')!;
    expect(firstChild(txBody, 'a:bodyPr')).toBeDefined();
    expect(xmlOf(firstChild(txBody, 'a:bodyPr')!)).toContain('normAutofit');
    expect(firstChild(txBody, 'a:lstStyle')).toBeDefined();
  });

  it('bodyPr·lstStyle 이 문단보다 앞에 온다 (스키마 순서)', () => {
    const sp = shape();
    PptxFile.setShapeText(sp, ['하나', '둘', '셋', '넷', '다섯']);
    const names = childElements(firstChild(sp, 'p:txBody')!).map((el) => el.name);
    expect(names[0]).toBe('a:bodyPr');
    expect(names[1]).toBe('a:lstStyle');
    expect(names.slice(2).every((n) => n === 'a:p')).toBe(true);
  });
});

describe('줄을 늘리고 줄일 때', () => {
  it('새 줄은 바로 앞 줄의 서식을 물려받는다', () => {
    const sp = shape();
    PptxFile.setShapeText(sp, ['첫째 줄', '둘째 줄', '셋째 줄', '', '넷째 줄']);
    const added = paragraphs(sp)[4]!;
    // 앞 줄이 빈 문단이었으므로 그 서식(sz=1600, b=1)을 따른다.
    expect(xmlOf(added)).toContain('sz="1600"');
    expect(PptxFile.text(added)).toBe('넷째 줄');
  });

  it('목록 가운데에 줄을 더하면 글머리표가 이어진다', () => {
    const sp = shape();
    // 셋째 줄 뒤(빈 줄 앞)가 아니라 끝에 더해 본다 — 앞 줄은 빈 문단.
    PptxFile.setShapeText(sp, ['첫째 줄', '둘째 줄', '셋째 줄', '셋째 줄 반', '']);
    const added = paragraphs(sp)[3]!;
    // 앞 줄(셋째)이 글머리표를 가졌으므로 그것을 물려받는다.
    expect(firstChild(firstChild(added, 'a:pPr')!, 'a:buChar')).toBeDefined();
  });

  it('줄을 줄이면 뒤에서부터 없어진다', () => {
    const sp = shape();
    PptxFile.setShapeText(sp, ['첫째 줄', '둘째 줄']);
    expect(textsOf(sp)).toEqual(['첫째 줄', '둘째 줄']);
  });

  it('전부 지우면 빈 문단 하나가 남는다', () => {
    const sp = shape();
    PptxFile.setShapeText(sp, []);
    expect(paragraphs(sp)).toHaveLength(1);
    expect(PptxFile.text(paragraphs(sp)[0]!)).toBe('');
  });
});

describe('줄을 어느 줄에 맞추는가', () => {
  it('가운데에 줄을 넣어도 아래 줄들의 서식이 밀리지 않는다', () => {
    // 위치로만 맞추던 시절에는 여기서 셋째 줄(밑줄, 20pt)의 서식이
    // 빈 문단 자리로 내려앉았다.
    const sp = shape();
    const before = paragraphs(sp).map(xmlOf);
    PptxFile.setShapeText(sp, ['첫째 줄', '둘째 줄', '사이에 넣은 줄', '셋째 줄', '']);

    const after = paragraphs(sp).map(xmlOf);
    expect(after[0]).toBe(before[0]); // 첫째 줄 그대로
    expect(after[1]).toBe(before[1]); // 둘째 줄 그대로
    expect(after[3]).toBe(before[2]); // 셋째 줄이 한 칸 내려갔을 뿐 내용은 그대로
    expect(after[4]).toBe(before[3]); // 빈 문단도 그대로
    expect(PptxFile.text(paragraphs(sp)[2]!)).toBe('사이에 넣은 줄');
  });

  it('맨 앞에 줄을 넣어도 나머지가 그대로다', () => {
    const sp = shape();
    const before = paragraphs(sp).map(xmlOf);
    PptxFile.setShapeText(sp, ['맨 앞 줄', '첫째 줄', '둘째 줄', '셋째 줄', '']);
    const after = paragraphs(sp).map(xmlOf);
    expect(after.slice(1)).toEqual(before);
  });

  it('가운데 줄을 지워도 나머지가 그대로다', () => {
    const sp = shape();
    const before = paragraphs(sp).map(xmlOf);
    PptxFile.setShapeText(sp, ['첫째 줄', '셋째 줄', '']);
    const after = paragraphs(sp).map(xmlOf);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[2]);
    expect(after[2]).toBe(before[3]);
  });

  it('오타 하나 고치면 그 줄의 서식이 살아남는다', () => {
    const sp = shape();
    PptxFile.setShapeText(sp, ['첫째 줄', '둘째 줄', '셋재 줄', '']);
    const xml = xmlOf(paragraphs(sp)[2]!);
    expect(xml).toContain('u="sng"'); // 밑줄
    expect(xml).toContain('sz="2000"');
    expect(xml).toContain('buChar'); // 글머리표
    expect(xml).toContain('셋재 줄');
  });
});

describe('여러 런이 섞인 줄', () => {
  it('고치면 첫 런의 서식으로 합쳐진다', () => {
    // 평문 한 줄로는 어느 글자가 어느 런인지 알 수 없다. 첫 런을 따른다.
    const sp = shape();
    PptxFile.setShapeText(sp, ['첫째 줄', '둘째 줄을 통째로 고침', '셋째 줄', '']);
    const xml = xmlOf(paragraphs(sp)[1]!);
    expect(xml).toContain('FFFFFF'); // 첫 런의 색
    expect(xml).not.toContain('4A7BC8'); // 둘째 런의 색은 사라진다
    expect(PptxFile.text(paragraphs(sp)[1]!)).toBe('둘째 줄을 통째로 고침');
  });

  it('건드리지 않으면 두 런이 그대로 남는다', () => {
    const sp = shape();
    PptxFile.setShapeText(sp, ['첫째 줄을 고침', '둘째 줄', '셋째 줄', '']);
    const xml = xmlOf(paragraphs(sp)[1]!);
    expect(xml).toContain('FFFFFF');
    expect(xml).toContain('4A7BC8');
  });
});

describe('줄바꿈', () => {
  it('한 줄 안의 줄바꿈은 a:br 로 들어간다', () => {
    // a:t 안에 생 줄바꿈을 넣으면 파워포인트가 줄로 보지 않는다.
    const sp = shape();
    PptxFile.setShapeText(sp, ['위\n아래', '둘째 줄', '셋째 줄', '']);
    const xml = xmlOf(paragraphs(sp)[0]!);
    expect(xml).toContain('<a:br>');
    expect(xml).not.toMatch(/<a:t>[^<]*\n[^<]*<\/a:t>/);
    expect(PptxFile.text(paragraphs(sp)[0]!)).toBe('위\n아래');
  });

  it('줄바꿈을 넣어도 글머리표와 정렬은 남는다', () => {
    const sp = shape();
    PptxFile.setShapeText(sp, ['위\n아래', '둘째 줄', '셋째 줄', '']);
    const pPr = firstChild(paragraphs(sp)[0]!, 'a:pPr');
    expect(pPr).toBeDefined();
    expect(firstChild(pPr!, 'a:buChar')).toBeDefined();
    expect(xmlOf(pPr!)).toContain('algn="just"');
  });
});

describe('실제 파일에서', () => {
  it('고친 뒤 저장하고 다시 열어도 글이 맞다', () => {
    const file = PptxFile.blank();
    file.addTextBox(0, ['한 줄', '두 줄', '세 줄']);
    const sp = file.shapes(0)[0]!;
    PptxFile.setShapeText(sp, ['한 줄', '고친 두 줄', '세 줄']);
    const again = PptxFile.open(file.save());
    expect(PptxFile.paragraphs(again.shapes(0)[0]!).map((p) => PptxFile.text(p))).toEqual([
      '한 줄',
      '고친 두 줄',
      '세 줄',
    ]);
  });

  it('빈 문단에 글을 쓰면 endParaRPr 의 서식을 따른다', () => {
    const sp = shape();
    PptxFile.setShapeText(sp, ['첫째 줄', '둘째 줄', '셋째 줄', '빈 줄에 쓴 글']);
    const last = paragraphs(sp)[3]!;
    expect(PptxFile.text(last)).toBe('빈 줄에 쓴 글');
    expect(xmlOf(last)).toContain('sz="1600"');
    // endParaRPr 은 끝에 남아 있어야 한다.
    const names = childElements(last).map((el) => el.name);
    expect(names[names.length - 1]).toBe('a:endParaRPr');
  });
});
