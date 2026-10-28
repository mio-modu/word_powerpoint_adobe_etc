"""원가가 보이는 Claude API 래퍼.

구독제 대신 API 를 쓰는 사업의 핵심은 '건당 원가를 항상 아는 것'이다.
모든 호출이 토큰과 비용을 누적하므로, 요금제를 설계할 때 추측하지 않는다.

원가 절감 수단 세 가지가 전부 이 모듈에 들어 있다.
  1) 모델 라우팅 - 분류/추출은 Haiku, 최종 생성만 Opus
  2) 프롬프트 캐싱 - 서식·규정·과거자료는 캐시 읽기 단가로
  3) effort 조절 - 쉬운 단계는 낮은 effort
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

# 1M 토큰당 USD. 요금이 바뀌면 이 표만 고친다.
PRICING = {
    "claude-opus-5-5": {"input": 4.00, "output": 20.00, "cache_read": 0.20,
                        "cache_write": 5.00},
    "claude-sonnet-5-5": {"input": 2.00, "output": 10.00, "cache_read": 0.20,
                          "cache_write": 2.50},
    "claude-haiku-5-5": {"input": 0.10, "output": 0.50, "cache_read": 0.01,
                         "cache_write": 0.125},
}

# 작업 성격에 맞는 모델. 비싼 모델은 꼭 필요한 단계에만 쓴다.
ROUTES = {
    "extract": "claude-haiku-5-5",    # 공고문에서 요건 뽑기
    "classify": "claude-haiku-5-5",   # 서식 분류, 적합성 판정
    "draft": "claude-opus-5-5",       # 제안서 본문 작성
    "review": "claude-sonnet-5-5",    # 누락 요건 점검
}

DEFAULT_KRW_PER_USD = 1_380.0


@dataclass
class Usage:
    """누적 토큰과 비용. 요금제 설계의 근거가 된다."""

    calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    usd: float = 0.0
    by_model: dict[str, int] = field(default_factory=dict)

    def add(self, model: str, usage) -> None:
        price = PRICING.get(model)
        if price is None:
            raise ValueError(f"요금표에 없는 모델입니다: {model}")

        plain_in = getattr(usage, "input_tokens", 0) or 0
        out = getattr(usage, "output_tokens", 0) or 0
        cache_read = getattr(usage, "cache_read_input_tokens", 0) or 0
        cache_write = getattr(usage, "cache_creation_input_tokens", 0) or 0

        self.calls += 1
        self.input_tokens += plain_in
        self.output_tokens += out
        self.cache_read_tokens += cache_read
        self.cache_write_tokens += cache_write
        self.by_model[model] = self.by_model.get(model, 0) + 1
        self.usd += (
            plain_in * price["input"]
            + out * price["output"]
            + cache_read * price["cache_read"]
            + cache_write * price["cache_write"]
        ) / 1_000_000

    def krw(self, rate: float = DEFAULT_KRW_PER_USD) -> float:
        return self.usd * rate

    def report(self, rate: float = DEFAULT_KRW_PER_USD) -> str:
        cached = self.cache_read_tokens
        billable = self.input_tokens + cached
        hit = f"{cached / billable * 100:.0f}%" if billable else "-"
        return (
            f"호출 {self.calls}회 ({', '.join(f'{m.split(chr(45))[1]}×{n}' for m, n in self.by_model.items())})\n"
            f"입력 {self.input_tokens:,} / 캐시읽기 {cached:,} (적중 {hit}) / 출력 {self.output_tokens:,}\n"
            f"원가 ${self.usd:.4f} ≈ {self.krw(rate):,.0f}원"
        )


class LLM:
    """라우팅·캐싱·원가집계를 한 곳에 모은 호출기."""

    def __init__(self, api_key: str | None = None, usage: Usage | None = None):
        self.api_key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        self.usage = usage or Usage()
        self._client = None

    @property
    def client(self):
        if self._client is None:
            try:
                from anthropic import Anthropic
            except ImportError as exc:  # pragma: no cover
                raise RuntimeError(
                    "anthropic 패키지가 필요합니다: pip install 'gongmun[llm]'"
                ) from exc
            self._client = Anthropic(api_key=self.api_key)
        return self._client

    def complete(
        self,
        task: str,
        *,
        system: str | list[dict],
        messages: list[dict],
        cached_context: str | None = None,
        effort: str = "medium",
        max_tokens: int = 16_000,
        model: str | None = None,
    ) -> tuple[str, Usage]:
        """한 번 호출하고 (본문, 누적사용량) 을 돌려준다.

        `cached_context` 는 서식·규정·과거 제안서처럼 매 호출 동일한 큰
        덩어리다. 캐시 구간 뒤에 변하는 내용을 놓아야 적중률이 유지된다.
        """
        model = model or ROUTES.get(task)
        if model is None:
            raise ValueError(f"알 수 없는 작업입니다: {task} (가능: {list(ROUTES)})")

        system_blocks: list[dict] = []
        if isinstance(system, str):
            system_blocks.append({"type": "text", "text": system})
        else:
            system_blocks.extend(system)

        # 캐시 구간은 안정적인 내용 '뒤'에 끊는다.
        if cached_context:
            system_blocks.append(
                {
                    "type": "text",
                    "text": cached_context,
                    "cache_control": {"type": "ephemeral"},
                }
            )

        response = self.client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=system_blocks,
            messages=messages,
            output_config={"effort": effort},
        )

        if response.stop_reason == "refusal":
            raise RuntimeError(
                f"모델이 요청을 거절했습니다: {response.stop_details}"
            )

        self.usage.add(model, response.usage)
        text = "".join(
            block.text for block in response.content
            if getattr(block, "type", None) == "text"
        )
        return text, self.usage


def estimate_unit_cost(
    *,
    cached_tokens: int,
    fresh_input_tokens: int,
    output_tokens: int,
    model: str = "claude-opus-5-5",
    rate: float = DEFAULT_KRW_PER_USD,
) -> dict[str, float]:
    """요금제를 설계할 때 쓰는 건당 원가 계산기.

    실제 호출 없이 토큰 가정만으로 마진을 미리 본다.
    """
    price = PRICING[model]
    usd = (
        cached_tokens * price["cache_read"]
        + fresh_input_tokens * price["input"]
        + output_tokens * price["output"]
    ) / 1_000_000
    naive = (
        (cached_tokens + fresh_input_tokens) * price["input"]
        + output_tokens * price["output"]
    ) / 1_000_000
    return {
        "usd": round(usd, 4),
        "krw": round(usd * rate, 1),
        "usd_without_cache": round(naive, 4),
        "saved_pct": round((1 - usd / naive) * 100, 1) if naive else 0.0,
    }
