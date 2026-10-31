import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { PptxFile } from '@jamo/pptx';
import { attr, childElements, firstChild } from '@jamo/core';

const reopen = (f: PptxFile): PptxFile => PptxFile.open(f.save());
const parts = (f: PptxFile): string[] => Object.keys(unzipSync(f.save()));
const read = (f: PptxFile, part: string): string => strFromU8(unzipSync(f.save())[part]!);

describe('슬라이드 메모', () => {
  it('메모가 없는 슬라이드는 undefined 다', () => {
    expect(PptxFile.blank().notes(0)).toBeUndefined();
  });

  it('적은 메모를 저장했다 다시 열어도 그대로다', () => {
    const file = PptxFile.blank();
    file.setNotes(0, '여기서 숨 한 번 쉬고, 질문을 받는다.');
    expect(reopen(file).notes(0)).toBe('여기서 숨 한 번 쉬고, 질문을 받는다.');
  });

  it('여러 줄 메모의 줄 나눔을 지킨다', () => {
    const file = PptxFile.blank();
    const text = '도입 — 3분\n사례 — 7분\n정리 — 2분';
    file.setNotes(0, text);
    expect(reopen(file).notes(0)).toBe(text);
  });

  it('메모를 고쳐 쓰면 덮어쓴다 (덧붙이지 않는다)', () => {
    const file = PptxFile.blank();
    file.setNotes(0, '처음');
    file.setNotes(0, '나중');
    expect(reopen(file).notes(0)).toBe('나중');
  });

  it('빈 메모만 넣으면 노트 파트를 만들지 않는다', () => {
    const file = PptxFile.blank();
    file.setNotes(0, '   ');
    expect(parts(file).some((p) => p.startsWith('ppt/notesSlides/'))).toBe(false);
  });

  it('메모를 지우면 undefined 로 돌아온다', () => {
    const file = PptxFile.blank();
    file.setNotes(0, '지울 메모');
    file.setNotes(0, '');
    expect(reopen(file).notes(0)).toBeUndefined();
  });

  it('특수문자를 깨뜨리지 않는다', () => {
    const file = PptxFile.blank();
    const text = '비교: a < b & c > d — "인용"';
    file.setNotes(0, text);
    expect(reopen(file).notes(0)).toBe(text);
  });
});

describe('메모를 처음 달 때 만드는 구조', () => {
  it('노트 파트와 노트 마스터를 함께 만든다', () => {
    const file = PptxFile.blank();
    file.setNotes(0, '메모');
    const names = parts(file);
    expect(names).toContain('ppt/notesSlides/notesSlide1.xml');
    expect(names).toContain('ppt/notesSlides/_rels/notesSlide1.xml.rels');
    expect(names).toContain('ppt/notesMasters/notesMaster1.xml');
    expect(names).toContain('ppt/notesMasters/_rels/notesMaster1.xml.rels');
  });

  it('[Content_Types].xml 에 두 파트의 형식을 적는다', () => {
    const file = PptxFile.blank();
    file.setNotes(0, '메모');
    const ct = read(file, '[Content_Types].xml');
    expect(ct).toContain('presentationml.notesSlide+xml');
    expect(ct).toContain('presentationml.notesMaster+xml');
  });

  it('슬라이드 → 노트 관계를 건다', () => {
    const file = PptxFile.blank();
    file.setNotes(0, '메모');
    const rels = read(file, 'ppt/slides/_rels/slide1.xml.rels');
    expect(rels).toContain('notesSlide');
    expect(rels).toContain('notesSlide1.xml');
  });

  it('노트 파트는 노트 마스터와 자기 슬라이드를 가리킨다', () => {
    const file = PptxFile.blank();
    file.setNotes(0, '메모');
    const rels = read(file, 'ppt/notesSlides/_rels/notesSlide1.xml.rels');
    expect(rels).toContain('notesMaster');
    expect(rels).toContain('slide1.xml');
  });

  it('notesMasterIdLst 를 sldMasterIdLst 와 sldIdLst 사이에 넣는다', () => {
    // 스키마가 정한 순서다. 어기면 PowerPoint 가 파일을 거부한다.
    const file = PptxFile.blank();
    file.setNotes(0, '메모');
    const names = childElements(reopen(file).root).map((el) => el.name);
    expect(names).toContain('p:notesMasterIdLst');
    expect(names.indexOf('p:sldMasterIdLst')).toBeLessThan(names.indexOf('p:notesMasterIdLst'));
    expect(names.indexOf('p:notesMasterIdLst')).toBeLessThan(names.indexOf('p:sldIdLst'));
  });

  it('메모를 두 장에 달아도 노트 마스터는 하나만 만든다', () => {
    const file = PptxFile.blank();
    file.addSlide();
    file.setNotes(0, '첫 장');
    file.setNotes(1, '둘째 장');
    const names = parts(file);
    expect(names.filter((p) => p.startsWith('ppt/notesMasters/notesMaster'))).toHaveLength(1);
    expect(names.filter((p) => p.startsWith('ppt/notesSlides/notesSlide'))).toHaveLength(2);

    const again = reopen(file);
    expect(again.notes(0)).toBe('첫 장');
    expect(again.notes(1)).toBe('둘째 장');
  });

  it('글을 적는 자리는 body 자리표시자다', () => {
    // sldImg(슬라이드 그림) 자리에 잘못 쓰면 PowerPoint 에서 메모가 안 보인다.
    const file = PptxFile.blank();
    file.setNotes(0, '메모');
    const xml = read(file, 'ppt/notesSlides/notesSlide1.xml');
    const bodyIndex = xml.indexOf('type="body"');
    const imgIndex = xml.indexOf('type="sldImg"');
    expect(bodyIndex).toBeGreaterThan(-1);
    expect(imgIndex).toBeGreaterThan(-1);
    // 메모 글은 body 도형 뒤에 나와야 한다.
    expect(xml.indexOf('메모')).toBeGreaterThan(bodyIndex);
  });
});

describe('메모와 슬라이드 순서', () => {
  it('슬라이드를 지워도 남은 장의 메모가 섞이지 않는다', () => {
    // 파일 이름(notesSlide1, 2, 3)은 순서를 보장하지 않는다. 관계를
    // 따라가지 않고 번호로 맞추면 여기서 틀어진다.
    const file = PptxFile.blank();
    file.addSlide();
    file.addSlide();
    file.setNotes(0, '가');
    file.setNotes(1, '나');
    file.setNotes(2, '다');

    file.removeSlide(1);
    const again = reopen(file);
    expect(again.slideCount).toBe(2);
    expect(again.notes(0)).toBe('가');
    expect(again.notes(1)).toBe('다');
  });

  it('없는 슬라이드의 메모를 읽으면 오류를 낸다', () => {
    expect(() => PptxFile.blank().notes(5)).toThrow();
  });
});

describe('모델화', () => {
  it('toModel 이 슬라이드마다 메모를 싣는다', () => {
    const file = PptxFile.blank();
    file.addSlide();
    file.setNotes(1, '둘째 장 메모');
    const model = reopen(file).toModel();
    expect(model.slides[0]?.notes).toBeUndefined();
    expect(model.slides[1]?.notes).toBe('둘째 장 메모');
  });
});

describe('메모가 본문을 건드리지 않는다', () => {
  it('슬라이드 XML 은 그대로다', () => {
    const file = PptxFile.blank();
    file.addTextBox(0, '본문입니다');
    const before = read(file, 'ppt/slides/slide1.xml');
    file.setNotes(0, '메모를 단다');
    expect(read(file, 'ppt/slides/slide1.xml')).toBe(before);
  });

  it('본문 텍스트 추출에 메모가 섞이지 않는다', () => {
    const file = PptxFile.blank();
    file.addTextBox(0, '화면에 보이는 글');
    file.setNotes(0, '발표자만 보는 글');
    const text = reopen(file).getText();
    expect(text).toContain('화면에 보이는 글');
    expect(text).not.toContain('발표자만 보는 글');
  });
});

describe('남이 만든 파일의 메모', () => {
  it('자리표시자 표시가 없어도 글 담긴 도형을 찾아낸다', () => {
    // 일부 생성기는 p:ph 를 빼먹는다. 그래도 메모가 보여야 한다.
    const file = PptxFile.blank();
    file.setNotes(0, '원래 메모');
    const saved = file.save();

    const entries = unzipSync(saved);
    const part = 'ppt/notesSlides/notesSlide1.xml';
    const stripped = strFromU8(entries[part]!).replace('<p:ph type="body" idx="1"/>', '');
    expect(stripped).not.toContain('type="body"');

    // 다시 묶어서 열어 본다.
    const { zipSync, strToU8 } = require('fflate') as typeof import('fflate');
    entries[part] = strToU8(stripped);
    const rebuilt = PptxFile.open(zipSync(entries));
    expect(rebuilt.notes(0)).toBe('원래 메모');
  });

  it('메모 자리에 아무 도형도 없으면 undefined 다', () => {
    const file = PptxFile.blank();
    file.setNotes(0, '메모');
    const entries = unzipSync(file.save());
    const part = 'ppt/notesSlides/notesSlide1.xml';
    const emptied = strFromU8(entries[part]!).replace(/<p:sp>[\s\S]*<\/p:sp>/, '');
    const { zipSync, strToU8 } = require('fflate') as typeof import('fflate');
    entries[part] = strToU8(emptied);
    expect(PptxFile.open(zipSync(entries)).notes(0)).toBeUndefined();
  });
});

describe('노트 마스터의 모양', () => {
  it('notesStyle 의 수준을 9개 적는다', () => {
    const file = PptxFile.blank();
    file.setNotes(0, '메모');
    const root = reopen(file).pkg.requireXml('ppt/notesMasters/notesMaster1.xml').root;
    const style = firstChild(root, 'p:notesStyle');
    expect(style).toBeDefined();
    expect(childElements(style!)).toHaveLength(9);
    expect(attr(childElements(style!)[0]!, 'marL')).toBe('0');
  });

  it('노트 마스터는 테마를 가리킨다', () => {
    const file = PptxFile.blank();
    file.setNotes(0, '메모');
    expect(read(file, 'ppt/notesMasters/_rels/notesMaster1.xml.rels')).toContain('theme');
  });
});
