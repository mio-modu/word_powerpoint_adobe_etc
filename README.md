# 소재공장 (sojae)

상품 사진 한 장에서 **플랫폼 규격별 한글 광고 소재**를 대량으로 만든다.

## 왜 필요한가

이미지 생성 모델은 **한글 글자를 정확히 그리지 못한다.** 그래서 광고 소재를
생성 모델에만 맡기면 글자가 깨져 쓸 수 없다. 이 엔진은 역할을 나눈다.

> **배경은 생성 모델에, 한글은 코드에.**

여기에 수량(셀러 한 명의 상품 수십~수백 개), 규격(플랫폼별 비율과 세이프존),
표시광고법 가드가 붙는다. 셋 다 채팅창에서는 처리할 수 없는 일이다.

## 측정된 원가

| 항목 | 값 |
|---|---|
| 상품 분석 + 문구 6종 | 약 2.8원 |
| 소재 18장 출력 | 추가 비용 0 (로컬 합성) |
| **소재 1장당** | **약 0.16원** |

합성이 전부 로컬이라 규격과 레이아웃을 늘려도 API 비용이 늘지 않는다.

## 설치

```bash
pip install -e .
apt-get install fonts-noto-cjk     # 한글 폰트 (SIL OFL, 상업적 이용 가능)
export GEMINI_API_KEY=...          # 인증을 주입하는 환경에서는 생략 가능
```

## 사용

```bash
sojae doctor                      # 폰트·연결 점검
sojae specs                       # 규격·레이아웃 목록
sojae make 사진.jpg "보온 텀블러 500ml" \
    --out out --count 8 \
    --specs square portrait story \
    --price "19,900원" --benefit "2개 구매 시 1개 추가"
```

결과는 `out/` 에 쌓이고, `out/manifest.json` 에 상품 분석·문구·파일 목록·원가가
남는다.

## 구조

| 경로 | 책임 |
|---|---|
| `typo.py` | **핵심.** 한글 조판 — 어절 줄바꿈, 금칙 처리, 크기 맞춤, 대비 판정 |
| `render.py` | 레이아웃 4종 합성, 세이프존, 글자 면적 경고 |
| `spec.py` | 플랫폼 규격표 |
| `creative.py` | 문구 생성 + 표시광고법 가드 |
| `palette.py` | 상품 사진에서 강조색 추출 |
| `gemini.py` | 모델 라우팅 · 재시도 · 원가 집계 |
| `pipeline.py` | 사진 1장 → 소재 묶음 |

## 테스트

```bash
python -m pytest tests -q
```

## 문서

| 파일 | 내용 |
|---|---|
| `docs/04-ad-engine.md` | **이 제품.** 설계 근거, 타이포 규칙, 원가, 판매 전 확인사항 |
| `docs/03-demand-validation.md` | 후보 8개 수요 검증과 탈락 사유 |
| `docs/00-strategy.md` | 아이템 선별 기준과 90일 순서 |
| `docs/02-unit-economics.md` | 원가 절감 수단, 합법/위반 경계 |

## 같은 저장소의 문서 엔진 (`gongmun`)

공공 제출문서 자동화는 수요 검증에서 탈락했으나(`docs/03-demand-validation.md`),
중간표현(IR)과 HWPX·DOCX writer 는 남겨 두었다. 소재 묶음의 납품 보고서처럼
문서 출력이 필요할 때 재사용한다.

```bash
gongmun demo --out out/sample
```

## ⚠️ 판매 전 확인

- 폰트 라이선스가 상업적 이용을 허용하는지 (기본값 Noto Sans CJK 는 가능)
- 상품 사진의 권리를 고객이 보유하는지
- EU 판매 소재는 AI 생성 표기 의무 (AI Act 제50조)
- `gemini.PRICING` 은 원가 감각용 기본값 — 공급자 페이지에서 재확인
