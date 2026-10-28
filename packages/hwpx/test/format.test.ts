import { describe, expect, it } from 'vitest';
import { HwpxFile } from '@jamo/hwpx';
import { DocxFile } from '@jamo/docx';
import { childElements, firstChild, isParagraph } from '@jamo/core';

const reopenH = (f: HwpxFile): HwpxFile => HwpxFile.open(f.save());
const reopenD = (f: DocxFile): DocxFile => DocxFile.open(f.save());

const hwpxStyle = (f: HwpxFile) => {
  const block = f.toModel().sections[0]!.blocks.find(isParagraph)!;
  return block.runs[0]!.style!;
};
const docxStyle = (f: DocxFile) => {
  const block = f.toModel().sections[0]!.blocks.find(isParagraph)!;
  return block.runs[0]!.style!;
};

describe('HWPX 글자 서식', () => {
  it('굵게를 켜고 끈다', () => {
    const file = HwpxFile.blank({ text: '강조할 글' });
    const [p] = file.paragraphs(0);
    file.setParagraphRunStyle(p!.element, { bold: true });
    expect(hwpxStyle(reopenH(file)).bold).toBe(true);

    file.setParagraphRunStyle(p!.element, { bold: false });
    expect(hwpxStyle(reopenH(file)).bold).toBeFalsy();
  });

  it('기울임·밑줄·취소선을 함께 건다', () => {
    const file = HwpxFile.blank({ text: '서식' });
    const [p] = file.paragraphs(0);
    file.setParagraphRunStyle(p!.element, { italic: true, underline: true, strikeout: true });
    const style = hwpxStyle(reopenH(file));
    expect(style.italic).toBe(true);
    expect(style.underline).toBe(true);
    expect(style.strikeout).toBe(true);
  });

  it('글자 크기와 색을 바꾼다', () => {
    const file = HwpxFile.blank({ text: '제목' });
    const [p] = file.paragraphs(0);
    file.setParagraphRunStyle(p!.element, { fontSize: 20, color: '#FF0000' });
    const style = hwpxStyle(reopenH(file));
    expect(style.fontSize).toBe(20);
    expect(style.color).toBe('#FF0000');
  });

  it('새 글꼴을 글꼴 목록에 등록한다', () => {
    const file = HwpxFile.blank({ text: '글꼴' });
    const [p] = file.paragraphs(0);
    file.setParagraphRunStyle(p!.element, { fontFamily: '나눔고딕' });
    const style = hwpxStyle(reopenH(file));
    expect(style.fontFamily).toBe('나눔고딕');
    // 모든 언어 그룹에 같은 ID 로 들어가야 한다.
    const fontfaces = firstChild(firstChild(reopenH(file).header, 'hh:refList')!, 'hh:fontfaces')!;
    for (const group of childElements(fontfaces, 'hh:fontface')) {
      expect(childElements(group, 'hh:font').some((f) => f.attrs.some((a) => a.value === '나눔고딕'))).toBe(true);
    }
  });

  it('같은 서식을 반복해도 charPr 이 늘지 않는다', () => {
    const file = HwpxFile.blank({ text: 'A' });
    file.appendParagraph(0, 'B');
    file.appendParagraph(0, 'C');
    const charProps = () =>
      childElements(
        firstChild(firstChild(file.header, 'hh:refList')!, 'hh:charProperties')!,
        'hh:charPr',
      ).length;
    for (const p of file.paragraphs(0)) file.setParagraphRunStyle(p.element, { bold: true });
    const after = charProps();
    for (const p of file.paragraphs(0)) file.setParagraphRunStyle(p.element, { bold: true });
    expect(charProps()).toBe(after);
    // 기본 1개 + 굵게 1개
    expect(after).toBeLessThanOrEqual(2);
  });

  it('해석하지 않는 속성(그림자)은 보존된다', () => {
    const file = HwpxFile.blank({ text: 'x' });
    const charPr = file.styles.charPr.get('0')!;
    const shadow = firstChild(charPr, 'hh:shadow')!;
    shadow.attrs.push({ name: 'data-test', value: '보존', quote: '"' });

    const [p] = file.paragraphs(0);
    file.setParagraphRunStyle(p!.element, { bold: true });
    const newId = file.toModel().sections[0]!.blocks.length;
    expect(newId).toBeGreaterThan(0);
    // 새로 만든 charPr 은 0번을 복제했으므로 표식이 따라와야 한다.
    const raw = new TextDecoder().decode(file.save());
    expect(raw.length).toBeGreaterThan(0);
    const reopened = reopenH(file);
    const allShadows = [...reopened.styles.charPr.values()].map((cp) => firstChild(cp, 'hh:shadow'));
    expect(allShadows.filter((sh) => sh?.attrs.some((a) => a.name === 'data-test')).length).toBe(2);
  });
});

describe('HWPX 문단 서식', () => {
  it('정렬을 바꾼다', () => {
    const file = HwpxFile.blank({ text: '가운데로' });
    const [p] = file.paragraphs(0);
    file.setParagraphFormat(p!.element, { align: 'center' });
    const block = reopenH(file).toModel().sections[0]!.blocks.find(isParagraph)!;
    expect(block.style?.align).toBe('center');
  });

  it('들여쓰기를 준다', () => {
    const file = HwpxFile.blank({ text: '들여쓴 문단' });
    const [p] = file.paragraphs(0);
    file.setParagraphFormat(p!.element, { indentLeft: 2000 });
    const block = reopenH(file).toModel().sections[0]!.blocks.find(isParagraph)!;
    expect(block.style?.indentLeft).toBe(2000);
  });
});

describe('DOCX 글자 서식', () => {
  it('굵게를 켜고 끈다', () => {
    const file = DocxFile.blank({ text: '강조' });
    const [p] = file.paragraphs();
    file.setParagraphRunStyle(p!, { bold: true });
    expect(docxStyle(reopenD(file)).bold).toBe(true);
    // 끄기는 "요소 삭제"가 아니라 w:val="0" 으로 적어야 한다.
    // 그냥 지우면 제목 스타일 같은 상속값이 되살아난다.
    file.setParagraphRunStyle(p!, { bold: false });
    expect(docxStyle(reopenD(file)).bold).toBe(false);
  });

  it('제목 스타일에서 굵게를 해제하면 실제로 풀린다', () => {
    const file = DocxFile.blank({ text: '제목' });
    const [p] = file.paragraphs();
    file.setParagraphStyle(p!, 'Heading1'); // Heading1 은 굵은 스타일
    file.setParagraphRunStyle(p!, { bold: false });
    const run = DocxFile.runs(p!)[0]!;
    const b = firstChild(firstChild(run, 'w:rPr')!, 'w:b')!;
    expect(b.attrs.find((a) => a.name === 'w:val')?.value).toBe('0');
    expect(docxStyle(reopenD(file)).bold).toBe(false);
  });

  it('크기·색·밑줄을 바꾼다', () => {
    const file = DocxFile.blank({ text: '서식' });
    const [p] = file.paragraphs();
    file.setParagraphRunStyle(p!, { fontSize: 16, color: '#0066CC', underline: true });
    const style = docxStyle(reopenD(file));
    expect(style.fontSize).toBe(16);
    expect(style.color).toBe('#0066CC');
    expect(style.underline).toBe(true);
  });

  it('w:rPr 자식 순서가 스키마 순서를 지킨다', () => {
    const file = DocxFile.blank({ text: 'x' });
    const [p] = file.paragraphs();
    // 일부러 거꾸로 적용해도 순서가 바로잡혀야 한다.
    file.setParagraphRunStyle(p!, { fontSize: 14 });
    file.setParagraphRunStyle(p!, { bold: true });
    file.setParagraphRunStyle(p!, { fontFamily: '맑은 고딕' });
    const run = DocxFile.runs(p!)[0]!;
    const names = childElements(firstChild(run, 'w:rPr')!).map((e) => e.name);
    expect(names.indexOf('w:rFonts')).toBeLessThan(names.indexOf('w:b'));
    expect(names.indexOf('w:b')).toBeLessThan(names.indexOf('w:sz'));
  });

  it('다루지 않는 rPr 속성은 남는다', () => {
    const file = DocxFile.blank({ text: 'x' });
    const [p] = file.paragraphs();
    file.setParagraphRunStyle(p!, { bold: true });
    const run = DocxFile.runs(p!)[0]!;
    const rPr = firstChild(run, 'w:rPr')!;
    rPr.children.push({
      kind: 'element',
      name: 'w:lang',
      attrs: [{ name: 'w:val', value: 'ko-KR' }],
      children: [],
      selfClosed: true,
    });
    file.setParagraphRunStyle(p!, { italic: true });
    const names = childElements(firstChild(DocxFile.runs(p!)[0]!, 'w:rPr')!).map((e) => e.name);
    expect(names).toContain('w:lang');
    expect(names).toContain('w:i');
  });

  it('문단 정렬을 바꾼다', () => {
    const file = DocxFile.blank({ text: '오른쪽' });
    const [p] = file.paragraphs();
    file.setParagraphFormat(p!, { align: 'right' });
    const block = reopenD(file).toModel().sections[0]!.blocks.find(isParagraph)!;
    expect(block.style?.align).toBe('right');
  });
});

describe('서식이 변환을 넘어간다', () => {
  it('HWPX 서식 → DOCX', () => {
    const hwpx = HwpxFile.blank({ text: '굵고 큰 제목' });
    const [p] = hwpx.paragraphs(0);
    hwpx.setParagraphRunStyle(p!.element, { bold: true, fontSize: 18, color: '#112233' });
    hwpx.setParagraphFormat(p!.element, { align: 'center' });

    const docx = reopenD(DocxFile.fromModel(hwpx.toModel()));
    const block = docx.toModel().sections[0]!.blocks.find(isParagraph)!;
    expect(block.runs[0]!.style?.bold).toBe(true);
    expect(block.runs[0]!.style?.fontSize).toBe(18);
    expect(block.runs[0]!.style?.color).toBe('#112233');
    expect(block.style?.align).toBe('center');
  });

  it('DOCX 서식 → HWPX', () => {
    const docx = DocxFile.blank({ text: '기울인 글' });
    const [p] = docx.paragraphs();
    docx.setParagraphRunStyle(p!, { italic: true, fontSize: 13 });
    docx.setParagraphFormat(p!, { align: 'right' });

    const hwpx = reopenH(HwpxFile.fromModel(docx.toModel()));
    const block = hwpx.toModel().sections[0]!.blocks.find(isParagraph)!;
    expect(block.runs[0]!.style?.italic).toBe(true);
    expect(block.runs[0]!.style?.fontSize).toBe(13);
    expect(block.style?.align).toBe('right');
  });
});
