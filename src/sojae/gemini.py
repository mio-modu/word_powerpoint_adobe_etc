"""Gemini 호출기. 토큰과 원가를 항상 집계한다.

구독제가 아니라 종량제로 파는 사업이므로 건당 원가를 모르면 요금제를
정할 수 없다. 모든 호출이 사용량을 누적한다.
"""

from __future__ import annotations

import base64
import json
import os
import random
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

BASE = "https://generativelanguage.googleapis.com/v1beta"

# 1M 토큰당 USD. 공개 요금은 바뀌므로 반드시 공급자 페이지에서 재확인한다.
# 이 표는 원가 감각용 기본값이다.
PRICING = {
    "gemini-3.8-flash": {"input": 0.30, "output": 2.50},
    "gemini-3.1-flash-lite": {"input": 0.10, "output": 0.40},
    "gemini-3.1-pro-preview": {"input": 1.25, "output": 10.00},
    "gemini-3.1-flash-image": {"input": 0.30, "output": 30.00},
}

ROUTES = {
    "vision": "gemini-3.8-flash",       # 상품 사진 분석
    "copy": "gemini-3.8-flash",         # 후크 카피 생성
    "image": "gemini-3.1-flash-image",  # 배경·씬 생성
}

DEFAULT_KRW_PER_USD = 1_380.0


class GeminiError(RuntimeError):
    pass


@dataclass
class Usage:
    calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    images: int = 0
    by_model: dict[str, int] = field(default_factory=dict)

    @property
    def usd(self) -> float:
        return self._usd

    _usd: float = 0.0

    def add(self, model: str, payload: dict) -> None:
        meta = payload.get("usageMetadata", {}) or {}
        inp = meta.get("promptTokenCount", 0) or 0
        out = meta.get("candidatesTokenCount", 0) or 0
        price = PRICING.get(model, {"input": 0.0, "output": 0.0})

        self.calls += 1
        self.input_tokens += inp
        self.output_tokens += out
        self.by_model[model] = self.by_model.get(model, 0) + 1
        self._usd += (inp * price["input"] + out * price["output"]) / 1_000_000

    def krw(self, rate: float = DEFAULT_KRW_PER_USD) -> float:
        return self._usd * rate

    def report(self, rate: float = DEFAULT_KRW_PER_USD) -> str:
        models = ", ".join(f"{m}×{n}" for m, n in self.by_model.items())
        return (
            f"호출 {self.calls}회 ({models})\n"
            f"입력 {self.input_tokens:,} / 출력 {self.output_tokens:,} 토큰"
            + (f" / 이미지 {self.images}장" if self.images else "")
            + f"\n원가 ${self._usd:.4f} ≈ {self.krw(rate):,.1f}원"
        )


class Gemini:
    def __init__(self, api_key: str | None = None, usage: Usage | None = None):
        # 프록시가 인증을 주입하는 환경에서는 키가 없어도 동작한다.
        self.api_key = api_key or os.environ.get("GEMINI_API_KEY")
        self.usage = usage or Usage()

    def _post(
        self, model: str, body: dict, timeout: int = 180, attempts: int = 4
    ) -> dict:
        """한 번 호출한다. 일시적 장애(429, 5xx, 연결 끊김)는 되물린다.

        한 묶음에 수십 장을 만드는 제품이라 중간 한 번의 502 로 전체가
        날아가면 안 된다. 영구 오류(4xx)는 즉시 올린다.
        """
        url = f"{BASE}/models/{model}:generateContent"
        payload_bytes = json.dumps(body).encode("utf-8")
        last: Exception | None = None

        for attempt in range(attempts):
            request = urllib.request.Request(
                url,
                data=payload_bytes,
                headers={
                    "Content-Type": "application/json",
                    "x-goog-api-key": self.api_key or "injected-by-proxy",
                },
            )
            try:
                with urllib.request.urlopen(request, timeout=timeout) as resp:
                    payload = json.loads(resp.read().decode("utf-8"))
                self.usage.add(model, payload)
                return payload
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode("utf-8", "replace")[:400]
                last = GeminiError(f"Gemini {exc.code}: {detail}")
                if exc.code != 429 and exc.code < 500:
                    raise last from exc
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
                last = GeminiError(f"Gemini 연결 실패: {exc}")

            if attempt < attempts - 1:
                # 지수 백오프 + 지터. 여러 요청이 같은 순간에 몰리지 않게 한다.
                time.sleep(2 ** attempt + random.random())

        raise last or GeminiError("Gemini 호출 실패")

    # ------------------------------------------------------------- 텍스트
    def text(
        self,
        task: str,
        prompt: str,
        *,
        image: Path | None = None,
        schema: dict | None = None,
        model: str | None = None,
        temperature: float = 0.9,
    ) -> str:
        model = model or ROUTES.get(task)
        if model is None:
            raise ValueError(f"알 수 없는 작업: {task}")

        parts: list[dict] = []
        if image is not None:
            data = Path(image).read_bytes()
            parts.append(
                {
                    "inline_data": {
                        "mime_type": _mime(image),
                        "data": base64.b64encode(data).decode("ascii"),
                    }
                }
            )
        parts.append({"text": prompt})

        config: dict = {"temperature": temperature}
        if schema is not None:
            config["responseMimeType"] = "application/json"
            config["responseSchema"] = schema

        payload = self._post(
            model, {"contents": [{"parts": parts}], "generationConfig": config}
        )
        return _first_text(payload)

    def json(self, task: str, prompt: str, schema: dict, **kwargs) -> dict | list:
        raw = self.text(task, prompt, schema=schema, **kwargs)
        try:
            return json.loads(raw)
        except json.JSONDecodeError as exc:
            raise GeminiError(f"JSON 파싱 실패: {raw[:300]}") from exc

    # ------------------------------------------------------------- 이미지
    def image(self, prompt: str, *, source: Path | None = None) -> bytes:
        """배경·씬 이미지를 생성한다. 글자는 넣지 않는다 - 글자는 typo 가 올린다."""
        model = ROUTES["image"]
        parts: list[dict] = []
        if source is not None:
            parts.append(
                {
                    "inline_data": {
                        "mime_type": _mime(source),
                        "data": base64.b64encode(Path(source).read_bytes()).decode(
                            "ascii"
                        ),
                    }
                }
            )
        parts.append({"text": prompt})

        payload = self._post(model, {"contents": [{"parts": parts}]})
        for part in _parts(payload):
            blob = part.get("inlineData") or part.get("inline_data")
            if blob and blob.get("data"):
                self.usage.images += 1
                return base64.b64decode(blob["data"])
        raise GeminiError(f"이미지가 반환되지 않았습니다: {str(payload)[:300]}")


def _mime(path: Path) -> str:
    suffix = Path(path).suffix.lower()
    return {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
    }.get(suffix, "image/png")


def _parts(payload: dict) -> list[dict]:
    candidates = payload.get("candidates") or []
    if not candidates:
        raise GeminiError(f"응답에 후보가 없습니다: {str(payload)[:300]}")
    return candidates[0].get("content", {}).get("parts", []) or []


def _first_text(payload: dict) -> str:
    chunks = [p["text"] for p in _parts(payload) if "text" in p]
    if not chunks:
        raise GeminiError(f"텍스트가 없습니다: {str(payload)[:300]}")
    return "".join(chunks).strip()
