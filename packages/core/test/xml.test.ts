import { describe, expect, it } from 'vitest';
import {
  attr,
  childElements,
  decodeEntities,
  escapeAttr,
  escapeText,
  parseXml,
  serializeXml,
  setAttr,
  textContent,
  hwpunit,
  charHeight,
  emu,
  twip,
} from '@jamo/core';

const SAMPLE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"><hp:p id="1" paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="0"><hp:t>안녕하세요 &amp; 반갑습니다</hp:t></hp:run><hp:linesegarray><hp:lineseg textpos="0"/></hp:linesegarray></hp:p><hp:p id="2"><hp:run charPrIDRef="1"><hp:t></hp:t></hp:run></hp:p></hs:sec>`;

describe('XML 라운드트립', () => {
  it('파싱 후 다시 쓰면 바이트가 같다', () => {
    const doc = parseXml(SAMPLE);
    expect(serializeXml(doc)).toBe(SAMPLE);
  });

  it('`<a/>` 와 `<a></a>` 를 구분해 보존한다', () => {
    const src = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><r><a/><b></b></r>`;
    expect(serializeXml(parseXml(src))).toBe(src);
  });

  it('속성 순서를 보존한다', () => {
    const doc = parseXml(SAMPLE);
    const p = childElements(doc.root, 'hp:p')[0]!;
    expect(p.attrs.map((a) => a.name)).toEqual(['id', 'paraPrIDRef', 'styleIDRef']);
  });

  it('기존 속성을 수정해도 자리가 바뀌지 않는다', () => {
    const doc = parseXml(SAMPLE);
    const p = childElements(doc.root, 'hp:p')[0]!;
    setAttr(p, 'paraPrIDRef', '7');
    expect(p.attrs.map((a) => a.name)).toEqual(['id', 'paraPrIDRef', 'styleIDRef']);
    expect(attr(p, 'paraPrIDRef')).toBe('7');
  });

  it('한글 텍스트와 엔티티를 제대로 읽는다', () => {
    const doc = parseXml(SAMPLE);
    const p = childElements(doc.root, 'hp:p')[0]!;
    expect(textContent(p)).toBe('안녕하세요 & 반갑습니다');
  });

  it('주석·CDATA·PI 를 보존한다', () => {
    const src = `<?xml version="1.0"?><r><!--메모--><![CDATA[<raw>]]><?php x?></r>`;
    expect(serializeXml(parseXml(src))).toBe(src);
  });

  it('BOM 을 조용히 떼어낸다', () => {
    const doc = parseXml(`﻿<?xml version="1.0"?><r/>`);
    expect(doc.root.name).toBe('r');
  });

  it('닫히지 않은 태그는 오류를 낸다', () => {
    expect(() => parseXml('<a><b></a>')).toThrow(/닫으려/);
  });
});

describe('엔티티', () => {
  it('숫자 참조를 해석한다', () => {
    expect(decodeEntities('&#54620;&#xAE00;')).toBe('한글');
  });
  it('모르는 엔티티는 원문 그대로 둔다', () => {
    expect(decodeEntities('&nbsp;')).toBe('&nbsp;');
  });
  it('텍스트/속성 이스케이프가 왕복한다', () => {
    expect(escapeText('a<b>&c')).toBe('a&lt;b&gt;&amp;c');
    expect(escapeAttr('a"b\tc')).toBe('a&quot;b&#9;c');
  });
});

describe('단위 변환', () => {
  it('A4 폭 210mm 는 59528 HWPUNIT', () => {
    expect(hwpunit.fromMm(210)).toBe(59528);
  });
  it('HWPUNIT ↔ pt', () => {
    expect(hwpunit.toPoint(7200)).toBe(72);
    expect(hwpunit.fromPoint(10)).toBe(1000);
  });
  it('charPr height 1000 은 10pt', () => {
    expect(charHeight.toPoint(1000)).toBe(10);
    expect(charHeight.fromPoint(11)).toBe(1100);
  });
  it('EMU/twip 왕복', () => {
    expect(emu.fromPoint(72)).toBe(914400);
    expect(twip.fromPoint(72)).toBe(1440);
    expect(hwpunit.toTwip(7200)).toBe(1440);
  });
});
