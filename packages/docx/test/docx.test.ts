import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync, zipSync } from 'fflate';
import { DocxFile } from '@jamo/docx';
import { HwpxFile } from '@jamo/hwpx';
import { childElements, firstChild, attr } from '@jamo/core';

const reopen = (f: DocxFile): DocxFile => DocxFile.open(f.save());

describe('빈 DOCX 만들기', () => {
  it('저장했다가 다시 열 수 있다', () => {
    const file = DocxFile.blank({ text: '안녕하세요' });
    expect(reopen(file).getText()).toBe('안녕하세요');
  });

  it('Word 가 요구하는 파트를 모두 담는다', () => {
    const names = Object.keys(unzipSync(DocxFile.blank().save()));
    expect(names).toContain('[Content_Types].xml');
    expect(names).toContain('_rels/.rels');
    expect(names).toContain('word/document.xml');
    expect(names).toContain('word/_rels/document.xml.rels');
    expect(names).toContain('word/styles.xml');
    expect(names).toContain('docProps/core.xml');
  });

  it('콘텐츠 타입 Override 가 본문 파트를 가리킨다', () => {
    const raw = strFromU8(unzipSync(DocxFile.blank().save())['[Content_Types].xml']!);
    expect(raw).toContain('PartName="/word/document.xml"');
    expect(raw).toContain('wordprocessingml.document.main+xml');
  });

  it('w:sectPr 는 본문의 마지막 자식이다', () => {
    const file = DocxFile.blank({ text: 'A' });
    file.appendParagraph('B');
    file.appendParagraph('C');
    const kids = childElements(file.body);
    expect(kids[kids.length - 1]!.name).toBe('w:sectPr');
    expect(file.getText()).toBe('A\nB\nC');
  });
});

describe('문단 편집', () => {
  it('문단을 추가·수정·삭제한다', () => {
    const file = DocxFile.blank({ text: '첫째' });
    file.appendParagraph('둘째');
    const [p1, p2] = file.paragraphs();
    file.setParagraphText(p2!, '둘째 수정');
    expect(file.getText()).toBe('첫째\n둘째 수정');
    file.removeParagraph(p1!);
    expect(reopen(file).getText()).toBe('둘째 수정');
  });

  it('중간에 끼워 넣는다', () => {
    const file = DocxFile.blank({ text: 'A' });
    file.appendParagraph('C');
    const [first] = file.paragraphs();
    file.insertParagraphAfter(first!, 'B');
    expect(file.getText()).toBe('A\nB\nC');
  });

  it('제목 스타일을 적용한다', () => {
    const file = DocxFile.blank({ text: '보고서' });
    const [p] = file.paragraphs();
    file.setParagraphStyle(p!, 'Heading1');
    const model = reopen(file).toModel();
    expect(model.sections[0]!.blocks[0]!.style?.styleName).toBe('Heading1');
  });

  it('앞뒤 공백은 xml:space="preserve" 로 지켜진다', () => {
    const file = DocxFile.blank({ text: '  들여쓴 문장  ' });
    const raw = strFromU8(unzipSync(file.save())['word/document.xml']!);
    expect(raw).toContain('xml:space="preserve"');
    expect(reopen(file).getText()).toBe('  들여쓴 문장  ');
  });

  it('탭과 줄바꿈을 전용 요소로 쓴다', () => {
    const file = DocxFile.blank();
    const [p] = file.paragraphs();
    file.setParagraphText(p!, 'A\tB\nC');
    const raw = strFromU8(unzipSync(file.save())['word/document.xml']!);
    expect(raw).toContain('<w:tab/>');
    expect(raw).toContain('<w:br/>');
    expect(reopen(file).getText()).toBe('A\tB\nC');
  });
});

describe('서식 읽기', () => {
  it('w:b w:val="0" 은 굵게가 아니다', () => {
    const file = DocxFile.blank({ text: 'x' });
    const run = DocxFile.runs(file.paragraphs()[0]!)[0]!;
    run.children.unshift({
      kind: 'element',
      name: 'w:rPr',
      attrs: [],
      selfClosed: false,
      children: [
        { kind: 'element', name: 'w:b', attrs: [{ name: 'w:val', value: '0' }], children: [], selfClosed: true },
        { kind: 'element', name: 'w:i', attrs: [], children: [], selfClosed: true },
        { kind: 'element', name: 'w:sz', attrs: [{ name: 'w:val', value: '24' }], children: [], selfClosed: true },
      ],
    });
    const style = reopen(file).toModel().sections[0]!.blocks[0]!.runs[0]!.style!;
    expect(style.bold).toBe(false);
    expect(style.italic).toBe(true);
    expect(style.fontSize).toBe(12);
  });
});

describe('무손실 보존', () => {
  it('모르는 파트(테마/이미지)를 그대로 보존한다', () => {
    const base = unzipSync(DocxFile.blank({ text: 'x' }).save());
    const theme = new Uint8Array([1, 2, 3, 4, 5]);
    const input: Record<string, Uint8Array> = { ...base, 'word/theme/theme1.xml': theme };
    const file = DocxFile.open(zipSync(input));
    file.setParagraphText(file.paragraphs()[0]!, 'y');
    const out = unzipSync(file.save());
    expect(out['word/theme/theme1.xml']).toEqual(theme);
    expect(DocxFile.open(file.save()).getText()).toBe('y');
  });

  it('추적 변경 같은 모르는 요소도 남는다', () => {
    const file = DocxFile.blank({ text: '원문' });
    const p = file.paragraphs()[0]!;
    p.children.push({
      kind: 'element',
      name: 'w:ins',
      attrs: [{ name: 'w:id', value: '1' }],
      children: [],
      selfClosed: true,
    });
    const raw = strFromU8(unzipSync(reopen(file).save())['word/document.xml']!);
    expect(raw).toContain('<w:ins w:id="1"/>');
  });
});

describe('HWPX → DOCX 변환', () => {
  it('한글 문서를 Word 문서로 옮긴다', () => {
    const hwpx = HwpxFile.blank({ text: '한글에서 쓴 문장' });
    hwpx.appendParagraph(0, '두 번째 문장');
    hwpx.setMeta({ title: '변환 테스트', creator: '홍길동' });

    const docx = DocxFile.fromModel(hwpx.toModel());
    const again = reopen(docx);
    expect(again.getText()).toBe('한글에서 쓴 문장\n두 번째 문장');
    expect(again.meta.creator).toBe('홍길동');
    // A4 는 twip 으로 11906 × 16838.
    const sectPr = firstChild(again.body, 'w:sectPr')!;
    const pgSz = firstChild(sectPr, 'w:pgSz')!;
    expect(attr(pgSz, 'w:w')).toBe('11906');
    expect(attr(pgSz, 'w:h')).toBe('16838');
  });

  it('글꼴·크기가 함께 넘어간다', () => {
    const hwpx = HwpxFile.blank({ text: '서식 있는 글' });
    const docx = DocxFile.fromModel(hwpx.toModel());
    const style = reopen(docx).toModel().sections[0]!.blocks[0]!.runs[0]!.style!;
    expect(style.fontFamily).toBe('함초롬바탕');
    expect(style.fontSize).toBe(10);
  });
});

describe('DOCX 표', () => {
  it('표를 넣고 다시 읽는다', () => {
    const file = DocxFile.blank({ text: '아래 표' });
    file.insertTable(2, 3, { text: [['이름', '점수', '등급'], ['홍길동', '95', 'A']] });
    const again = reopen(file);
    expect(again.tables()).toHaveLength(1);
    const text = again.getText();
    expect(text).toContain('홍길동');
    expect(text).toContain('등급');
  });

  it('셀에 문단이 반드시 하나 있다 (Word 요구사항)', () => {
    const file = DocxFile.blank();
    const tbl = file.insertTable(2, 2);
    for (const tr of childElements(tbl, 'w:tr')) {
      for (const tc of childElements(tr, 'w:tc')) {
        expect(childElements(tc, 'w:p').length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('tblGrid 의 칸 수가 실제 칸 수와 맞는다', () => {
    const file = DocxFile.blank();
    const tbl = file.insertTable(2, 4);
    const grid = firstChild(tbl, 'w:tblGrid')!;
    expect(childElements(grid, 'w:gridCol')).toHaveLength(4);
    expect(childElements(childElements(tbl, 'w:tr')[0]!, 'w:tc')).toHaveLength(4);
  });

  it('표 뒤에 문단이 따라온다', () => {
    const file = DocxFile.blank({ text: 'x' });
    const tbl = file.insertTable(1, 1);
    const kids = childElements(file.body);
    const i = kids.indexOf(tbl);
    expect(kids[i + 1]!.name).toBe('w:p');
  });

  it('w:sectPr 는 여전히 마지막이다', () => {
    const file = DocxFile.blank({ text: 'x' });
    file.insertTable(2, 2);
    const kids = childElements(file.body);
    expect(kids[kids.length - 1]!.name).toBe('w:sectPr');
  });

  it('줄과 칸을 넣고 뺀다', () => {
    const file = DocxFile.blank();
    const tbl = file.insertTable(2, 2, { text: [['A', 'B'], ['C', 'D']] });
    DocxFile.insertRow(tbl, 0);
    expect(childElements(tbl, 'w:tr')).toHaveLength(3);
    DocxFile.insertColumn(tbl, 0);
    expect(childElements(firstChild(tbl, 'w:tblGrid')!, 'w:gridCol')).toHaveLength(3);
    expect(childElements(childElements(tbl, 'w:tr')[0]!, 'w:tc')).toHaveLength(3);
    DocxFile.removeRow(tbl, 1);
    expect(childElements(tbl, 'w:tr')).toHaveLength(2);
    DocxFile.removeColumn(tbl, 2);
    expect(childElements(firstChild(tbl, 'w:tblGrid')!, 'w:gridCol')).toHaveLength(2);
    expect(reopen(file).getText()).toContain('A');
  });

  it('셀 글자를 바꾼다', () => {
    const file = DocxFile.blank();
    const tbl = file.insertTable(2, 2, { text: [['A', 'B'], ['C', 'D']] });
    const cells = DocxFile.cells(tbl);
    file.setParagraphText(cells[0]![1]!, '바뀜');
    expect(reopen(file).getText()).toContain('바뀜');
  });
});
