import { describe, expect, it } from 'vitest';
import { PptxFile } from '@jamo/pptx';
import { hwpunit } from '@jamo/core';
import { buildThemedDeck, PNG_BYTES } from './fixtures/themed-deck.js';

const deck = (): PptxFile => PptxFile.open(buildThemedDeck());

describe('테마 색 해석', () => {
  it('clrMap 이 뒤집힌 이름을 따라간다', () => {
    const file = deck();
    const theme = file.themeFor(file.masterPartOf(file.layoutPartOf(0)));
    // 이 테마는 bg1 → dk2 → #1A2236 (짙은 남색). 흔한 어두운 테마의 모습이다.
    expect(theme.map.get('bg1')).toBe('dk2');
    expect(theme.scheme.get('dk2')).toBe('#1A2236');
    expect(theme.scheme.get('accent1')).toBe('#C9A227');
  });

  it('테마 글꼴을 읽는다 (한글은 ea 가 실제로 보이는 글꼴)', () => {
    const file = deck();
    const theme = file.themeFor(file.masterPartOf(file.layoutPartOf(0)));
    expect(theme.majorFont).toBe('나눔스퀘어');
    expect(theme.minorFont).toBe('본고딕');
  });

  it('sysClr 의 lastClr 을 쓴다', () => {
    const file = deck();
    const theme = file.themeFor(file.masterPartOf(file.layoutPartOf(0)));
    expect(theme.scheme.get('lt1')).toBe('#FFFFFF');
    expect(theme.scheme.get('dk1')).toBe('#000000');
  });
});

describe('배경', () => {
  it('마스터의 bgRef 를 테마까지 따라가 실제 색을 낸다', () => {
    const slide = deck().toModel().slides[0]!;
    // 슬라이드·레이아웃에는 배경이 없다. 마스터의 bgRef → bg1 → dk2 → #1A2236.
    expect(slide.background?.type).toBe('solid');
    expect(slide.background?.color).toBe('#1A2236');
  });
});

describe('레이아웃·마스터에서 물려받기', () => {
  it('슬라이드가 비워 둔 글자 서식을 마스터에서 가져온다', () => {
    const slide = deck().toModel().slides[0]!;
    const title = slide.shapes.find((s) => s.placeholder === 'title')!;
    const style = title.paragraphs[0]!.runs[0]!.style!;
    // 슬라이드의 rPr 은 비어 있다. 44pt·굵게·금색·나눔스퀘어는 전부 물려받은 값이다.
    expect(style.fontSize).toBe(44);
    expect(style.bold).toBe(true);
    expect(style.color).toBe('#C9A227');
    expect(style.fontFamily).toBe('나눔스퀘어');
  });

  it('슬라이드에 자리가 없으면 레이아웃의 자리를 쓴다', () => {
    const slide = deck().toModel().slides[0]!;
    const title = slide.shapes.find((s) => s.placeholder === 'title')!;
    expect(title.frame).toBeDefined();
    expect(hwpunit.toEmu(title.frame!.x)).toBeCloseTo(838200, -3);
    expect(hwpunit.toEmu(title.frame!.width)).toBeCloseTo(10515600, -3);
  });

  it('세로 정렬도 레이아웃에서 물려받는다', () => {
    const slide = deck().toModel().slides[0]!;
    const title = slide.shapes.find((s) => s.placeholder === 'title')!;
    expect(title.anchor).toBe('middle');
  });

  it('레이아웃의 장식 도형이 함께 그려진다', () => {
    const slide = deck().toModel().slides[0]!;
    const band = slide.shapes.find((s) => s.name === '레이아웃 장식 띠');
    expect(band).toBeDefined();
    expect(band!.fill?.color).toBe('#C9A227');
    // 장식은 슬라이드 내용보다 아래에 깔려야 한다.
    const title = slide.shapes.find((s) => s.placeholder === 'title')!;
    expect(band!.zIndex!).toBeLessThan(title.zIndex!);
  });
});

describe('그림', () => {
  it('그림 도형이 파트를 가리킨다', () => {
    const file = deck();
    const slide = file.toModel().slides[0]!;
    const pic = slide.shapes.find((s) => s.image !== undefined)!;
    expect(pic.image!.part).toBe('ppt/media/image1.png');
    expect(pic.geometry).toBe('ellipse');
  });

  it('그림 바이트를 꺼낼 수 있다', () => {
    const file = deck();
    const bytes = file.partBytes('ppt/media/image1.png');
    expect(bytes).toEqual(PNG_BYTES);
  });
});

describe('그룹 좌표 변환', () => {
  it('그룹 안 도형의 자리를 바깥 기준으로 편다', () => {
    const slide = deck().toModel().slides[0]!;
    const card = slide.shapes.find((s) => s.name === '카드')!;
    // 그룹: 바깥 (1000000, 3000000) 크기 2000000×1000000,
    //       안쪽 원점 (0,0) 크기 1000000×500000 → 배율 2배.
    // 카드는 안쪽 (100000, 100000) → 바깥 1000000 + 100000*2 = 1200000
    expect(hwpunit.toEmu(card.frame!.x)).toBeCloseTo(1200000, -3);
    expect(hwpunit.toEmu(card.frame!.y)).toBeCloseTo(3200000, -3);
    expect(hwpunit.toEmu(card.frame!.width)).toBeCloseTo(800000, -3);
  });

  it('둥근 사각형의 반경을 읽는다', () => {
    const slide = deck().toModel().slides[0]!;
    const card = slide.shapes.find((s) => s.name === '카드')!;
    expect(card.geometry).toBe('roundRect');
    expect(card.cornerRadius).toBeCloseTo(0.2, 3);
    expect(card.fill?.color).toBe('#FF8800');
  });
});

describe('슬라이드 안의 표', () => {
  it('표를 격자로 읽는다', () => {
    const slide = deck().toModel().slides[0]!;
    const frame = slide.shapes.find((s) => s.table !== undefined)!;
    const table = frame.table!;
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]!.cells).toHaveLength(2);
    expect(table.rows[0]!.cells[0]!.paragraphs[0]!.runs[0]!.text).toBe('항목');
  });

  it('칸 배경색을 읽는다', () => {
    const slide = deck().toModel().slides[0]!;
    const table = slide.shapes.find((s) => s.table !== undefined)!.table!;
    expect(table.rows[0]!.cells[0]!.shade).toBe('#223344');
    expect(table.rows[0]!.cells[1]!.shade).toBeUndefined();
  });

  it('가로로 합쳐진 칸은 하나로 센다', () => {
    const slide = deck().toModel().slides[0]!;
    const table = slide.shapes.find((s) => s.table !== undefined)!.table!;
    // hMerge 로 덮인 칸은 주인 칸이 따로 있으므로 격자에 또 넣지 않는다.
    expect(table.rows[1]!.cells).toHaveLength(1);
    expect(table.rows[1]!.cells[0]!.colSpan).toBe(2);
    expect(table.rows[1]!.cells[0]!.paragraphs[0]!.runs[0]!.text).toBe('합쳐진 칸');
  });
});

describe('본문 추출은 그대로 동작한다', () => {
  it('글자를 모두 찾는다', () => {
    const text = deck().getText();
    expect(text).toContain('영광을 만나기 위한 준비');
    expect(text).toContain('카드');
    expect(text).toContain('항목');
  });

  it('저장했다 다시 열어도 같다', () => {
    const file = deck();
    const again = PptxFile.open(file.save());
    expect(again.toModel().slides[0]!.background?.color).toBe('#1A2236');
    const title = again.toModel().slides[0]!.shapes.find((s) => s.placeholder === 'title')!;
    expect(title.paragraphs[0]!.runs[0]!.style?.fontSize).toBe(44);
  });
});
