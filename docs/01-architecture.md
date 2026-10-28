# 아키텍처

## 설계 원칙

**AI 는 중간표현(IR) 하나만 만든다.** 출력 포맷은 writer 가 책임진다.
포맷이 늘어나도 생성 로직은 바뀌지 않고, 두 포맷의 결과가 다르면
writer 쪽 문제로 범위가 좁혀진다.

```
나라장터 OpenAPI ──┐
                   ├─> 요건 추출 (Haiku) ──> 체크리스트 IR ──┐
공고문 텍스트 ─────┘                                          │
                                                              ├─> HWPX writer
                   ┌─> 제안서 작성 (Opus) ──> 제안서 IR ─────┤
체크리스트 + 서식 ─┘                                          └─> DOCX writer
```

## 모듈

| 경로 | 책임 |
|---|---|
| `ir.py` | 문서 중간표현. `Document` / `Heading` / `Paragraph` / `Table` / `PageBreak` |
| `writers/hwpx.py` | IR → HWPX(OWPML). ZIP + XML 패키지를 직접 구성 |
| `writers/docx_writer.py` | IR → DOCX. 검증 가능한 대조군 |
| `g2b/client.py` | 나라장터 입찰공고 OpenAPI 클라이언트 |
| `llm/client.py` | 모델 라우팅 · 프롬프트 캐싱 · 원가 집계 |
| `llm/requirements.py` | 공고문 → 요건 체크리스트 (무료 미끼 제품) |
| `cli.py` | `demo` / `checklist` / `cost` |

## HWPX 를 직접 쓰는 이유

HWPX 는 KS X 6101(OWPML)로 공개된 국가표준이고, 물리 구조는 ZIP 안의
XML 묶음이다. 공개 규격만 보고 문서를 **생성**하는 것은 합법이며,
이 저장소는 그 범위에서만 동작한다.

하지 않는 것:
- 바이너리 `.hwp 5.0` 포맷 역공학
- 특정 제품의 코드·UI·상표 모방
- 상용 소프트웨어를 서버에서 구동해 API 로 중계

## 패키지 구조

```
mimetype                  application/hwp+zip  (첫 엔트리, 무압축)
version.xml
settings.xml
Contents/content.hpf      패키지 매니페스트
Contents/header.xml       글꼴·문자속성·단락속성·스타일
Contents/section0.xml     본문
META-INF/container.xml
META-INF/manifest.xml
Preview/PrvText.txt       평문 미리보기
```

단위: 좌표는 HWPUNIT(1/7200 인치), 글자 크기는 1/100 pt.

## 자동 검증 범위

`tests/test_hwpx.py` 가 보장하는 것:

- `mimetype` 이 첫 엔트리이고 무압축이며 값이 정확하다
- 필수 엔트리가 모두 있고 ZIP CRC 가 정상이다
- 모든 XML 파트가 적합하다(well-formed)
- 제목·본문·표 데이터가 왕복한다
- 표의 행·열 수와 칸 주소가 IR 과 일치하고 중복이 없다
- 단락 id 가 유일하다
- 본문이 참조하는 모든 스타일·문자속성·단락속성 id 가 header 에 선언되어 있다
- 쪽나눔이 표시되고 용지가 A4 로 선언된다

## ⚠️ 사람이 확인해야 하는 것

**자동 검증은 패키지 구조까지만 보장한다.** 아래는 실제 워드프로세서에서
열어 눈으로 확인해야 하며, 확인 전에는 고객에게 HWPX 출력을 약속하지 않는다.

- [ ] 한글에서 경고 없이 열린다
- [ ] 제목 수준별 글꼴 크기·굵기가 의도대로 보인다
- [ ] 표 테두리가 그려지고 머리행이 구분된다
- [ ] 쪽나눔 위치가 맞는다
- [ ] 한글에서 저장 후 다시 열어도 깨지지 않는다
- [ ] 한컴독스(웹)에서도 열린다

이 체크리스트가 끝날 때까지 DOCX 가 기본 출력이다. `--format both` 로
두 포맷을 같이 뽑아 내용을 비교하는 것이 현재 작업 방식이다.

## 다음 단계

1. 위 수동 검증 수행 → 결과를 이 문서에 기록
2. 서식(별지 제○호) 템플릿을 IR 로 읽어 빈칸만 채우는 경로 추가
3. 제안서 작성 단계(`draft`) 구현 — 체크리스트를 입력으로 받는다
4. 누락 요건 점검 단계(`review`) 구현 — 제출 전 마지막 관문
