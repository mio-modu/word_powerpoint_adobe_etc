# HWPX (OWPML)

ZIP 안에 XML이 들어 있는 구조입니다. ODF·EPUB과 같은 OCF 계열이라 규칙을 공유합니다.

## 패키지 구조

```
mimetype                  ← 맨 앞, 무압축. 내용은 "application/hwp+zip"
version.xml
META-INF/container.xml    ← Contents/content.hpf 를 가리킴
META-INF/manifest.xml
Contents/content.hpf      ← 패키지 목록 + 읽는 순서(spine)
Contents/header.xml       ← 글꼴·글자모양·문단모양·스타일 표
Contents/section0.xml     ← 본문
settings.xml
Preview/PrvText.txt       ← 미리보기 (선택)
BinData/…                 ← 이미지 등 (선택)
```

`mimetype`이 **ZIP의 첫 항목이면서 무압축**이어야 하는 이유는, 파일 앞부분 몇십
바이트만 읽고 종류를 판별하는 도구들이 그걸 전제로 동작하기 때문입니다.

## 네임스페이스

| 접두사 | URI |
|---|---|
| `hh` | `http://www.hancom.co.kr/hwpml/2011/head` |
| `hp` | `http://www.hancom.co.kr/hwpml/2011/paragraph` |
| `hs` | `http://www.hancom.co.kr/hwpml/2011/section` |
| `hc` | `http://www.hancom.co.kr/hwpml/2011/core` |
| `hv` | `http://www.hancom.co.kr/hwpml/2011/version` |
| `opf` | `http://www.idpf.org/2007/opf/` |
| `ocf` | `urn:oasis:names:tc:opendocument:xmlns:container` |
| `odf` | `urn:oasis:names:tc:opendocument:xmlns:manifest:1.0` |

## 본문

```xml
<hs:sec>
  <hp:p id="0" paraPrIDRef="0" styleIDRef="0">
    <hp:run charPrIDRef="0">
      <hp:secPr>…</hp:secPr>   <!-- 첫 문단에만. 용지 설정 -->
      <hp:ctrl><hp:colPr …/></hp:ctrl>
      <hp:t>실제 글자</hp:t>
    </hp:run>
    <hp:linesegarray><hp:lineseg …/></hp:linesegarray>
  </hp:p>
</hs:sec>
```

서식은 본문에 직접 쓰지 않고 **번호로만** 가리킵니다. `charPrIDRef="3"`을 풀려면
`header.xml`의 `hh:charProperties`를 봐야 합니다. 이 표를 읽지 않으면 화면에 서식이
하나도 나타나지 않습니다.

## 걸리는 지점

**`version.xml`의 속성명 오타.** `targetApplication`이 아니라 `tagetApplication`입니다.
스펙 자체의 오타이고, 바로잡으면 한글이 읽지 못합니다.

```xml
<hv:HCFVersion xmlns:hv="…" tagetApplication="WORDPROCESSOR" major="5" minor="0" … />
```

**bold/italic은 값이 아니라 요소의 존재로 표현됩니다.**

```xml
<hh:charPr id="1" height="1100" …>
  <hh:fontRef hangul="0" latin="0" … />
  <hh:bold/>      <!-- 있으면 굵게 -->
  <hh:italic/>
  <hh:underline type="BOTTOM" shape="SOLID" color="#000000"/>
</hh:charPr>
```

**`hp:switch` 호환 블록.** 한글 2016 이후 파일은 `paraPr`의 여백·줄간격을
`hp:switch` 안에 두 벌(`hp:case` / `hp:default`) 넣어 둡니다. `hp:case` 쪽이 신버전
해석입니다. 이걸 모르면 여백을 못 찾습니다.

**첫 문단에 용지 설정이 들어 있습니다.** 섹션 첫 문단의 첫 런 안에 `hp:secPr`가
있습니다. 그 문단을 통째로 지우면 용지 설정이 사라집니다.

## 단위

- 길이는 **HWPUNIT = 1/7200인치**. A4 폭 210mm = 59528.
- `charPr/@height`는 **1/100 pt**. `1000` = 10pt. (7200/72 = 100이라 숫자는 같습니다.)
