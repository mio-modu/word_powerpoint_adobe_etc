import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync, zipSync } from 'fflate';
import { PptxFile, SLIDE_SIZE_4_3 } from '@jamo/pptx';
import { attr, childElements, firstChild } from '@jamo/core';

const reopen = (f: PptxFile): PptxFile => PptxFile.open(f.save());

describe('빈 PPTX 만들기', () => {
  it('저장했다가 다시 열 수 있다', () => {
    const file = PptxFile.blank({ title: '발표자료' });
    const again = reopen(file);
    expect(again.slideCount).toBe(1);
    expect(again.meta.title).toBe('발표자료');
  });

  it('PowerPoint 가 요구하는 파트를 모두 담는다', () => {
    const names = Object.keys(unzipSync(PptxFile.blank().save()));
    for (const required of [
      '[Content_Types].xml',
      '_rels/.rels',
      'ppt/presentation.xml',
      'ppt/_rels/presentation.xml.rels',
      'ppt/slideMasters/slideMaster1.xml',
      'ppt/slideMasters/_rels/slideMaster1.xml.rels',
      'ppt/slideLayouts/slideLayout1.xml',
      'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
      'ppt/slides/slide1.xml',
      'ppt/slides/_rels/slide1.xml.rels',
      'ppt/theme/theme1.xml',
    ]) {
      expect(names, `${required} 누락`).toContain(required);
    }
  });

  it('테마의 스타일 목록이 각각 3개다 (PowerPoint 요구사항)', () => {
    const raw = strFromU8(unzipSync(PptxFile.blank().save())['ppt/theme/theme1.xml']!);
    const count = (tag: string): number =>
      (raw.match(new RegExp(`<${tag}(?=[ />])`, 'g')) ?? []).length;
    expect(count('a:solidFill')).toBeGreaterThanOrEqual(6);
    expect(count('a:effectStyle')).toBe(3);
    expect(count('a:ln')).toBe(3);
    expect(count('a:fillStyleLst')).toBe(1);
    expect(count('a:bgFillStyleLst')).toBe(1);
  });

  it('슬라이드 크기를 바꿀 수 있다', () => {
    const file = PptxFile.blank({ slideSize: SLIDE_SIZE_4_3 });
    expect(reopen(file).slideSize).toEqual({ width: 9144000, height: 6858000 });
  });

  it('기본은 16:9 다', () => {
    expect(PptxFile.blank().slideSize).toEqual({ width: 12192000, height: 6858000 });
  });
});

describe('슬라이드 조작', () => {
  it('슬라이드를 추가한다', () => {
    const file = PptxFile.blank();
    file.addSlide();
    file.addSlide();
    expect(reopen(file).slideCount).toBe(3);
  });

  it('추가한 슬라이드도 레이아웃 관계를 갖는다', () => {
    const file = PptxFile.blank();
    file.addSlide();
    const names = Object.keys(unzipSync(file.save()));
    expect(names).toContain('ppt/slides/slide2.xml');
    expect(names).toContain('ppt/slides/_rels/slide2.xml.rels');
  });

  it('슬라이드를 지우면 sldIdLst 에서도 빠진다', () => {
    const file = PptxFile.blank();
    file.addTitleSlide('둘째 장');
    file.addTitleSlide('셋째 장');
    expect(file.slideCount).toBe(3);
    file.removeSlide(1);
    const again = reopen(file);
    expect(again.slideCount).toBe(2);
    expect(again.getText()).toContain('셋째 장');
    expect(again.getText()).not.toContain('둘째 장');
  });

  it('sldIdLst 가 sldSz 보다 앞에 온다 (스키마 순서)', () => {
    const file = PptxFile.blank();
    const kids = childElements(file.root).map((e) => e.name);
    expect(kids.indexOf('p:sldIdLst')).toBeLessThan(kids.indexOf('p:sldSz'));
  });
});

describe('텍스트', () => {
  it('텍스트 상자를 넣고 읽는다', () => {
    const file = PptxFile.blank();
    file.addTextBox(0, '제목입니다', { fontSize: 40, bold: true });
    file.addTextBox(0, ['첫째 줄', '둘째 줄']);
    expect(reopen(file).getText()).toBe('제목입니다\n첫째 줄\n둘째 줄');
  });

  it('도형 텍스트를 교체하면 서식이 유지된다', () => {
    const file = PptxFile.blank();
    const sp = file.addTextBox(0, '원래 제목', { fontSize: 40, bold: true });
    PptxFile.setShapeText(sp, ['바꾼 제목']);
    const model = reopen(file).toModel();
    const run = model.slides[0]!.shapes[0]!.paragraphs[0]!.runs[0]!;
    expect(run.text).toBe('바꾼 제목');
    expect(run.style?.fontSize).toBe(40);
    expect(run.style?.bold).toBe(true);
  });

  it('줄바꿈은 a:br 로 저장된다', () => {
    const file = PptxFile.blank();
    const sp = file.addTextBox(0, 'x');
    PptxFile.setShapeText(sp, ['위\n아래']);
    const raw = strFromU8(unzipSync(file.save())['ppt/slides/slide1.xml']!);
    expect(raw).toContain('<a:br>');
    expect(reopen(file).getText()).toBe('위\n아래');
  });

  it('특수문자를 이스케이프한다', () => {
    const file = PptxFile.blank();
    file.addTextBox(0, '매출 & 이익 <비교> "2026"');
    expect(reopen(file).getText()).toBe('매출 & 이익 <비교> "2026"');
  });

  it('개요에서 덱을 만든다', () => {
    const file = PptxFile.fromOutline(
      [
        { title: '2026 사업계획', bullets: ['매출 목표', '신규 채널'] },
        { title: '시장 분석', bullets: ['경쟁사', '가격'] },
      ],
      { title: '사업계획서' },
    );
    const again = reopen(file);
    expect(again.slideCount).toBe(2);
    expect(again.getText()).toContain('2026 사업계획');
    expect(again.getText()).toContain('경쟁사');
  });
});

describe('무손실 보존', () => {
  it('모르는 파트(미디어/차트)를 그대로 보존한다', () => {
    const base = unzipSync(PptxFile.blank().save());
    const media = new Uint8Array([9, 8, 7, 6]);
    const file = PptxFile.open(zipSync({ ...base, 'ppt/media/image1.png': media }));
    file.addTextBox(0, '수정');
    const out = unzipSync(file.save());
    expect(out['ppt/media/image1.png']).toEqual(media);
  });

  it('도형의 모르는 속성도 남는다', () => {
    const file = PptxFile.blank();
    const sp = file.addTextBox(0, 'x');
    const spPr = firstChild(sp, 'p:spPr')!;
    spPr.children.push({
      kind: 'element',
      name: 'a:effectLst',
      attrs: [],
      children: [{ kind: 'element', name: 'a:outerShdw', attrs: [{ name: 'blurRad', value: '50800' }], children: [], selfClosed: true }],
      selfClosed: false,
    });
    const raw = strFromU8(unzipSync(reopen(file).save())['ppt/slides/slide1.xml']!);
    expect(raw).toContain('<a:outerShdw blurRad="50800"/>');
  });
});

describe('잘못된 입력', () => {
  it('DOCX 를 PPTX 로 열면 알아보기 쉬운 오류를 낸다', async () => {
    const { DocxFile } = await import('@jamo/docx');
    expect(() => PptxFile.open(DocxFile.blank().save())).toThrow(/DOCX 라면/);
  });

  it('ZIP 이 아니면 거부한다', () => {
    expect(() => PptxFile.open(new Uint8Array([1, 2, 3, 4]))).toThrow(/ZIP/);
  });
});
