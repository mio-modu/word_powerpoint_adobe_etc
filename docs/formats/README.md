# 포맷 노트

구현하면서 정리한 내용입니다. 공개 명세를 읽고 구현한 것이며, 각 명세의 출처는
아래와 같습니다.

| 포맷 | 명세 | 성격 |
|---|---|---|
| HWPX (OWPML) | **KS X 6101** 한글 문서 개방형 표준 | 국가표준, 공개 |
| HWP 5.0 바이너리 | 한글과컴퓨터 공개 파일 형식 문서 | 제조사 공개 |
| DOCX / PPTX | **ECMA-376**, **ISO/IEC 29500** | 국제표준, 공개 |
| CFB (OLE2) | **MS-CFB** | 마이크로소프트 공개 명세 |

전부 공개된 명세라, 남의 프로그램을 뜯어보는 역공학 과정이 필요하지 않았습니다.

## 파일

- [`hwpx.md`](hwpx.md) — HWPX 패키지 구조와 본문 XML
- [`hwp5.md`](hwp5.md) — CFB 컨테이너와 HWP 5.0 레코드 스트림
- [`ooxml.md`](ooxml.md) — OPC 패키지, WordprocessingML, PresentationML
