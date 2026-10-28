"""한글 폰트 탐색.

상업적 이용이 가능한 폰트만 기본값으로 둔다. 라이선스가 불확실한 폰트를
자동으로 쓰지 않는다 - 고객에게 판매할 소재에 들어가므로 라이선스가 곧
법적 리스크다.
"""

from __future__ import annotations

import glob
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from PIL import ImageFont

# (경로 패턴, 컬렉션 내 한국어 페이스 index, 라이선스)
CANDIDATES = [
    ("/usr/share/fonts/**/NotoSansCJK-Black.ttc", 1, "SIL OFL 1.1"),
    ("/usr/share/fonts/**/NotoSansCJK-Bold.ttc", 1, "SIL OFL 1.1"),
    ("/usr/share/fonts/**/NotoSansCJK-Medium.ttc", 1, "SIL OFL 1.1"),
    ("/usr/share/fonts/**/NotoSansCJK-Regular.ttc", 1, "SIL OFL 1.1"),
    ("/usr/share/fonts/**/NanumGothicExtraBold*", 0, "SIL OFL 1.1"),
    ("/usr/share/fonts/**/NanumGothicBold*", 0, "SIL OFL 1.1"),
    ("/usr/share/fonts/**/NanumGothic.ttf", 0, "SIL OFL 1.1"),
    ("/usr/share/fonts/**/Pretendard*Black*", 0, "SIL OFL 1.1"),
    ("/usr/share/fonts/**/Pretendard*Bold*", 0, "SIL OFL 1.1"),
]

PROBE = "한글 가격 특가 1,900원 ABC"


@dataclass(frozen=True)
class FontFace:
    path: str
    index: int
    license: str

    def load(self, size: int) -> ImageFont.FreeTypeFont:
        return ImageFont.truetype(self.path, size, index=self.index)


class FontMissing(RuntimeError):
    pass


def _renders_hangul(face: FontFace) -> bool:
    try:
        font = face.load(40)
    except OSError:
        return False
    box = font.getbbox(PROBE)
    # 글리프가 없으면 폭이 비정상적으로 좁거나 0 이 된다.
    return box[2] - box[0] > 200


@lru_cache(maxsize=4)
def _discover() -> tuple[FontFace, ...]:
    found: list[FontFace] = []
    for pattern, index, license_name in CANDIDATES:
        for path in sorted(glob.glob(pattern, recursive=True)):
            face = FontFace(path, index, license_name)
            if _renders_hangul(face):
                found.append(face)
    return tuple(found)


def available() -> list[FontFace]:
    return list(_discover())


def pick(weight: str = "bold") -> FontFace:
    """제목용(bold) / 본문용(regular) 한글 폰트를 고른다."""
    faces = _discover()
    if not faces:
        raise FontMissing(
            "상업적 이용이 가능한 한글 폰트를 찾지 못했습니다.\n"
            "  Debian/Ubuntu: apt-get install fonts-noto-cjk\n"
            "  또는 나눔고딕·Pretendard(SIL OFL)를 설치하십시오."
        )
    heavy = ("Black", "ExtraBold", "Bold")
    if weight == "bold":
        for face in faces:
            if any(w in Path(face.path).name for w in heavy):
                return face
        return faces[0]
    for face in faces:
        if not any(w in Path(face.path).name for w in heavy):
            return face
    return faces[-1]
