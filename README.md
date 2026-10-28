# gongmun

공공 제출문서 자동 생성 엔진.

입찰공고를 넣으면 요건 체크리스트와 제출문서 초안을 **개방형 문서 포맷**으로
출력한다. 범용 AI 는 텍스트만 내놓지만, 한국에서 실제로 제출되는 것은
`.hwpx` / `.docx` 파일이다. 이 저장소는 그 변환 구간을 담당한다.

## 설치

```bash
pip install -e ".[llm,dev]"
```

## 사용

API 키 없이 두 포맷 출력물을 확인:

```bash
gongmun demo --out out/sample
# out/sample.hwpx, out/sample.docx
```

공고문에서 요건 체크리스트 생성:

```bash
export ANTHROPIC_API_KEY=...
gongmun checklist 공고문.txt --out out/checklist --format both
```

요금제 설계용 건당 원가·마진 계산:

```bash
gongmun cost --price 199000 --volume 20
```

나라장터 연동에는 공공데이터포털에서 '나라장터 입찰공고정보서비스'
활용신청 후 받은 키가 필요하다:

```bash
export G2B_SERVICE_KEY=...
```

## 구조

AI 는 중간표현(IR) 하나만 만들고, writer 가 포맷을 책임진다.

```
공고문 ──> 요건 추출(Haiku) ──> IR ──┬──> HWPX writer
                                      └──> DOCX writer
```

## 포맷 정책

- **HWPX** — KS X 6101(OWPML) 국가표준. 공개 규격만 보고 생성한다.
- **DOCX** — ECMA-376 / ISO 29500 공개 표준.

바이너리 `.hwp 5.0` 역공학, 상용 소프트웨어 중계, 타사 상표 사용은 하지 않는다.
상세는 `docs/02-unit-economics.md` 의 경계 표를 따른다.

## ⚠️ HWPX 출력 상태

자동 테스트는 **패키지 구조와 내용 왕복까지만** 보장한다. 실제 워드프로세서에서
열리는지는 아직 사람이 확인하지 않았다. 확인 항목은
`docs/01-architecture.md` 에 있고, 그때까지 **DOCX 가 기본 출력**이다.

## 테스트

```bash
python -m pytest tests -q
```

## 문서

| 파일 | 내용 |
|---|---|
| `docs/00-strategy.md` | 왜 오피스 제품이 아니라 엔진인가, 아이템 선별 기준, 90일 순서 |
| `docs/01-architecture.md` | 모듈 구조, HWPX 패키지 구성, 검증 범위와 미확인 항목 |
| `docs/02-unit-economics.md` | 건당 원가·마진, 원가 절감 수단, 합법/위반 경계 |
