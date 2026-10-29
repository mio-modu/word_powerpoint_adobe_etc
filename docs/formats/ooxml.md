# OOXML (DOCX / PPTX)

ECMA-376 / ISO/IEC 29500. ZIP 안의 XML이고, 패키지 규약(OPC)을 공유합니다.

## OPC: 두 가지 뼈대

### `[Content_Types].xml`

모든 파트의 MIME 타입을 선언합니다. 확장자 기본값(`Default`)과 파트별
재정의(`Override`)가 있고, **`Default`가 `Override`보다 앞에** 와야 합니다.

```xml
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="…wordprocessingml.document.main+xml"/>
</Types>
```

### `_rels` 관계 그래프

파트 사이의 연결입니다. 파트 `a/b/c.xml`의 관계는 `a/b/_rels/c.xml.rels`에,
패키지 루트의 관계는 `_rels/.rels`에 있습니다.

**`Target`은 출처 파트의 디렉터리 기준 상대 경로입니다.**

```xml
<!-- ppt/slides/_rels/slide1.xml.rels -->
<Relationship Id="rId1" Type="…/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
```

이 계산을 틀리면 파트를 못 찾습니다. 가장 흔한 버그 지점입니다.

## DOCX (WordprocessingML)

```
word/document.xml          본문
word/styles.xml            스타일
word/_rels/document.xml.rels
docProps/core.xml          제목·작성자
```

```xml
<w:p>
  <w:pPr><w:pStyle w:val="Heading1"/><w:jc w:val="center"/></w:pPr>
  <w:r>
    <w:rPr><w:b/><w:sz w:val="28"/></w:rPr>
    <w:t xml:space="preserve">  보고서  </w:t>
  </w:r>
</w:p>
```

**걸리는 지점:**

- `<w:b/>`는 굵게지만 `<w:b w:val="0"/>`은 **굵게 해제**입니다. 요소 존재만 보면
  해제를 굵게로 읽습니다.
- 앞뒤 공백이 있으면 `xml:space="preserve"`가 **반드시** 있어야 합니다. 없으면
  Word가 공백을 버립니다.
- `w:sectPr`(용지 설정)는 `w:body`의 **마지막 자식**이어야 합니다. 뒤에 문단을
  붙이면 Word가 "복구가 필요한 파일"로 봅니다.
- `w:pPr` 자식의 순서가 스키마로 정해져 있습니다. `w:pStyle`이 가장 앞입니다.
- 길이 단위는 **twip = 1/1440인치**. `w:sz`만 **half-point**입니다.

## PPTX (PresentationML)

```
ppt/presentation.xml
ppt/slides/slide1.xml
ppt/slideMasters/slideMaster1.xml
ppt/slideLayouts/slideLayout1.xml
ppt/theme/theme1.xml
```

마스터·레이아웃·테마가 **없으면 PowerPoint가 열지 않습니다.** 빈 덱을 만드는 데도
보일러플레이트가 꽤 필요합니다.

**걸리는 지점:**

- 슬라이드의 **진짜 순서는 `p:sldIdLst`** 이고, 파일 이름(slide1, slide2…)은 순서를
  보장하지 않습니다. 슬라이드를 지우거나 옮기면 어긋납니다. 항상
  `sldIdLst → r:id → 관계` 순으로 따라가야 합니다.
- 테마의 `fillStyleLst` / `lnStyleLst` / `effectStyleLst` / `bgFillStyleLst`는
  **각각 항목이 3개**여야 합니다. 개수가 맞지 않으면 파일을 거부합니다.
- `p:sldIdLst`는 `p:sldSz`보다 **앞에** 와야 합니다.
- `p:spTree`는 `p:nvGrpSpPr`와 `p:grpSpPr`로 시작해야 합니다.
- 도형 좌표 단위는 **EMU = 1/914400인치**. 글자 크기 `sz`는 **1/100 pt**입니다.
- 16:9 슬라이드 = 12192000 × 6858000 EMU.
