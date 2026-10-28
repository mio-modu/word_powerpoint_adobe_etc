"""광고 플랫폼별 소재 규격.

규격은 자주 바뀐다. 코드 곳곳에 숫자를 흩지 않고 이 표만 고치면 되게 둔다.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Spec:
    """한 소재 규격."""

    key: str
    label: str
    width: int
    height: int
    # 플랫폼 UI 가 가리거나 잘라내는 바깥 영역 비율(상, 하)
    safe_top: float = 0.0
    safe_bottom: float = 0.0
    max_bytes: int | None = None

    @property
    def ratio(self) -> float:
        return self.width / self.height

    @property
    def size(self) -> tuple[int, int]:
        return (self.width, self.height)

    def safe_box(self) -> tuple[int, int, int, int]:
        """텍스트를 놓아도 안전한 영역 (left, top, right, bottom)."""
        return (
            0,
            round(self.height * self.safe_top),
            self.width,
            round(self.height * (1 - self.safe_bottom)),
        )


SPECS: dict[str, Spec] = {
    "square": Spec("square", "정사각 1:1 (피드 공용)", 1080, 1080),
    "portrait": Spec("portrait", "세로 4:5 (피드 최대 노출)", 1080, 1350),
    "story": Spec(
        "story",
        "스토리·릴스 9:16",
        1080,
        1920,
        safe_top=0.14,
        safe_bottom=0.20,
    ),
    "wide": Spec("wide", "가로 1.91:1 (배너)", 1200, 628),
    "thumb": Spec("thumb", "오픈마켓 썸네일", 1000, 1000),
}

DEFAULT_SPECS = ("square", "portrait", "story")


def get(key: str) -> Spec:
    try:
        return SPECS[key]
    except KeyError:
        raise KeyError(
            f"알 수 없는 규격입니다: {key} (가능: {', '.join(SPECS)})"
        ) from None


def resolve(keys: list[str] | None) -> list[Spec]:
    return [get(k) for k in (keys or list(DEFAULT_SPECS))]
