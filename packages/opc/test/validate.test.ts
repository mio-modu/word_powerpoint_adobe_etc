import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { validatePackage } from '@jamo/opc';
import { PptxFile } from '@jamo/pptx';
import { DocxFile } from '@jamo/docx';

/**
 * 검사기가 실제로 잡는지 확인한다.
 *
 * "문제 없음" 만 돌려주는 검사기는 아무 쓸모가 없다. 그래서 멀쩡한 파일을
 * 한 군데씩 일부러 망가뜨려 보고, 그때마다 짚어내는지 본다.
 */

const deck = (): Uint8Array => {
  const file = PptxFile.blank({ title: '검사용' });
  file.addTitleSlide('둘째 장', ['내용']);
  file.setNotes(0, '메모');
  return file.save();
};

/** ZIP 안의 한 파트를 고쳐 다시 묶는다. */
function patch(data: Uint8Array, part: string, edit: (xml: string) => string): Uint8Array {
  const entries = unzipSync(data);
  entries[part] = strToU8(edit(strFromU8(entries[part]!)));
  return zipSync(entries);
}

function drop(data: Uint8Array, part: string): Uint8Array {
  const entries = unzipSync(data);
  delete entries[part];
  return zipSync(entries);
}

const errors = (data: Uint8Array): string[] =>
  validatePackage(data)
    .filter((f) => f.kind === 'error')
    .map((f) => `${f.where}: ${f.what}`);

describe('멀쩡한 파일', () => {
  it('우리가 만든 PPTX 는 통과한다', () => {
    expect(errors(deck())).toEqual([]);
  });

  it('우리가 만든 DOCX 도 통과한다', () => {
    const doc = DocxFile.blank({ text: '문단 하나' });
    expect(errors(doc.save())).toEqual([]);
  });

  it('메모를 단 뒤에도 통과한다', () => {
    const file = PptxFile.blank();
    file.addSlide();
    file.setNotes(0, '첫 장');
    file.setNotes(1, '둘째 장');
    expect(errors(file.save())).toEqual([]);
  });
});

describe('망가뜨리면 잡아낸다', () => {
  it('[Content_Types].xml 이 없으면', () => {
    const found = errors(drop(deck(), '[Content_Types].xml'));
    expect(found.join(' ')).toContain('[Content_Types].xml');
  });

  it('슬라이드의 형식 선언이 빠지면', () => {
    // .xml 에 Default 가 걸려 있어 "형식은 있는" 상태가 된다. 그래도
    // 슬라이드 자리에는 presentationml.slide 가 와야 한다.
    const broken = patch(deck(), '[Content_Types].xml', (xml) =>
      xml.replace(/<Override[^>]*slide1\.xml"[^>]*\/>/, ''),
    );
    expect(errors(broken).join(' ')).toContain('슬라이드 자리인데 형식이 다릅니다');
  });

  it('형식 선언이 엉뚱한 것으로 바뀌면', () => {
    const broken = patch(deck(), '[Content_Types].xml', (xml) =>
      xml.replace(
        'presentationml.notesSlide+xml',
        'presentationml.slide+xml',
      ),
    );
    expect(errors(broken).join(' ')).toContain('슬라이드 노트 자리인데 형식이 다릅니다');
  });

  it('관계가 없는 파트를 가리키면', () => {
    const broken = patch(deck(), 'ppt/_rels/presentation.xml.rels', (xml) =>
      xml.replace('slides/slide1.xml', 'slides/sldX.xml'),
    );
    expect(errors(broken).join(' ')).toContain('없는 파트를 가리킵니다');
  });

  it('본문이 쓰는 r:id 가 관계에 없으면', () => {
    const broken = patch(deck(), 'ppt/_rels/presentation.xml.rels', (xml) =>
      // 슬라이드 관계의 Id 를 바꿔 본문과 어긋나게 만든다.
      xml.replace(/Id="rId2"/, 'Id="rId99"'),
    );
    expect(errors(broken).join(' ')).toContain('그 관계가 없습니다');
  });

  it('같은 Id 가 두 번 나오면', () => {
    const broken = patch(deck(), 'ppt/_rels/presentation.xml.rels', (xml) =>
      xml.replace(/Id="rId3"/, 'Id="rId2"'),
    );
    expect(errors(broken).join(' ')).toContain('같은 Id 가 두 번');
  });

  it('presentation.xml 의 자식 순서가 어긋나면', () => {
    // sldSz 가 sldIdLst 보다 앞에 오면 스키마 위반이다.
    const broken = patch(deck(), 'ppt/presentation.xml', (xml) => {
      const size = /<p:sldSz[^>]*\/>/.exec(xml)![0];
      return xml.replace(size, '').replace('<p:sldIdLst>', `${size}<p:sldIdLst>`);
    });
    expect(errors(broken).join(' ')).toContain('자식 순서가 어긋납니다');
  });

  it('슬라이드에 레이아웃 관계가 없으면', () => {
    const broken = drop(deck(), 'ppt/slides/_rels/slide1.xml.rels');
    expect(errors(broken).join(' ')).toContain('레이아웃 관계가 없습니다');
  });

  it('sldIdLst 가 슬라이드가 아닌 것을 가리키면', () => {
    const broken = patch(deck(), 'ppt/_rels/presentation.xml.rels', (xml) =>
      xml.replace('slides/slide1.xml', 'theme/theme1.xml'),
    );
    expect(errors(broken).join(' ')).toContain('슬라이드가 아닙니다');
  });

  it('ZIP 이 아니면', () => {
    expect(errors(strToU8('이건 ZIP 이 아닙니다')).join(' ')).toContain('열 수 없습니다');
  });
});

describe('상대 경로 풀이', () => {
  it('../ 로 올라가는 Target 을 제대로 따라간다', () => {
    // 노트 파트는 ../slides/slide1.xml 처럼 올라갔다 내려오는 경로를 쓴다.
    const file = PptxFile.blank();
    file.setNotes(0, '메모');
    const rels = strFromU8(unzipSync(file.save())['ppt/notesSlides/_rels/notesSlide1.xml.rels']!);
    expect(rels).toContain('..');
    // 그런데도 통과해야 한다 — 경로를 못 풀면 여기서 거짓 오류가 난다.
    expect(errors(file.save())).toEqual([]);
  });
});
