"""나라장터 입찰공고 OpenAPI 클라이언트.

공공데이터포털(data.go.kr)에서 '나라장터 입찰공고정보서비스' 활용신청을
하고 발급받은 인증키를 쓴다. 서비스별로 승인이 따로 필요하다.

공식 OpenAPI 만 호출한다. 나라장터 내부 비공식 엔드포인트를 모사하거나
화면을 크롤링하지 않는다 - 이용약관 위반이고 사업 리스크다.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timedelta

import requests

BASE_URL = "https://apis.data.go.kr/1230000/ad/BidPublicInfoService"

# 업무구분별 오퍼레이션
OPERATIONS = {
    "물품": "getBidPblancListInfoThng",
    "용역": "getBidPblancListInfoServc",
    "공사": "getBidPblancListInfoCnstwk",
    "외자": "getBidPblancListInfoFrgcpt",
}


class G2BError(RuntimeError):
    pass


@dataclass(frozen=True)
class Notice:
    """입찰공고 한 건. API 필드명이 바뀌어도 이 모델만 고치면 된다."""

    bid_no: str
    title: str
    agency: str
    kind: str
    posted_at: str
    deadline: str
    budget: str
    detail_url: str

    @classmethod
    def from_api(cls, row: dict, kind: str) -> Notice:
        def pick(*keys: str) -> str:
            for key in keys:
                value = row.get(key)
                if value not in (None, ""):
                    return str(value).strip()
            return ""

        return cls(
            bid_no=pick("bidNtceNo"),
            title=pick("bidNtceNm"),
            agency=pick("dminsttNm", "ntceInsttNm"),
            kind=kind,
            posted_at=pick("bidNtceDt"),
            deadline=pick("bidClseDt", "opengDt"),
            budget=pick("asignBdgtAmt", "presmptPrce"),
            detail_url=pick("bidNtceDtlUrl"),
        )


class G2BClient:
    def __init__(self, service_key: str | None = None, timeout: int = 20):
        self.service_key = service_key or os.environ.get("G2B_SERVICE_KEY", "")
        if not self.service_key:
            raise G2BError(
                "인증키가 없습니다. data.go.kr 에서 '나라장터 입찰공고정보서비스' "
                "활용신청 후 G2B_SERVICE_KEY 환경변수를 설정하세요."
            )
        self.timeout = timeout

    def search(
        self,
        kind: str = "용역",
        *,
        keyword: str | None = None,
        days: int = 7,
        rows: int = 50,
        page: int = 1,
    ) -> list[Notice]:
        """최근 `days` 일 공고를 조회한다."""
        if kind not in OPERATIONS:
            raise G2BError(f"업무구분은 {list(OPERATIONS)} 중 하나입니다: {kind}")

        end = datetime.now()
        start = end - timedelta(days=days)
        params = {
            "serviceKey": self.service_key,
            "pageNo": page,
            "numOfRows": rows,
            "type": "json",
            "inqryDiv": "1",
            "inqryBgnDt": start.strftime("%Y%m%d0000"),
            "inqryEndDt": end.strftime("%Y%m%d2359"),
        }
        if keyword:
            params["bidNtceNm"] = keyword

        url = f"{BASE_URL}/{OPERATIONS[kind]}"
        try:
            resp = requests.get(url, params=params, timeout=self.timeout)
            resp.raise_for_status()
            payload = resp.json()
        except requests.RequestException as exc:
            raise G2BError(f"나라장터 API 호출 실패: {exc}") from exc
        except ValueError as exc:
            # 인증키 오류 시 XML 에러 문서가 돌아온다.
            raise G2BError(
                f"JSON 이 아닌 응답입니다. 인증키/승인 상태를 확인하세요: "
                f"{resp.text[:200]}"
            ) from exc

        body = payload.get("response", {}).get("body", {})
        items = body.get("items") or []
        if isinstance(items, dict):
            items = items.get("item", [])
        return [Notice.from_api(row, kind) for row in items]
