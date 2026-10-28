"""상품 사진 한 장 -> 규격별 광고 소재 묶음."""

from __future__ import annotations

import json
from dataclasses import dataclass, asdict
from pathlib import Path

from PIL import Image

from . import render, spec as spec_mod
from .creative import Creative, Product, analyze, write_copy
from .gemini import Gemini

SCENE_PROMPT = """\
Place this exact product in a clean commercial photography scene: {scene}.
Keep the product's shape, color, texture, pattern and logo EXACTLY as in the
source image - do not redesign or restyle the product itself.
Soft studio lighting, shallow depth of field, uncluttered composition,
generous empty space in the upper area for text overlay.
Absolutely no text, no letters, no numbers, no logos, no watermarks anywhere.
"""


@dataclass
class Batch:
    product: Product
    creatives: list[Creative]
    files: list[str]
    warnings: list[str]
    cost_krw: float

    def manifest(self) -> str:
        return json.dumps(
            {
                "product": asdict(self.product),
                "creatives": [asdict(c) for c in self.creatives],
                "files": self.files,
                "warnings": self.warnings,
                "cost_krw": round(self.cost_krw, 2),
            },
            ensure_ascii=False,
            indent=2,
        )


def run(
    photo: Path,
    name: str,
    out_dir: Path,
    *,
    count: int = 8,
    specs: list[str] | None = None,
    layouts: list[str] | None = None,
    price: str = "",
    benefit: str = "",
    scenes: int = 0,
    gemini: Gemini | None = None,
) -> Batch:
    """사진 1장에서 소재 묶음을 만든다.

    scenes > 0 이면 배경 장면도 생성한다. 글자는 생성 모델에 맡기지 않고
    항상 코드로 합성한다.
    """
    photo = Path(photo)
    if not photo.exists():
        raise FileNotFoundError(f"상품 사진이 없습니다: {photo}")

    gemini = gemini or Gemini()
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    product = analyze(photo, name, gemini)
    creatives = write_copy(product, gemini, count=count, price=price, benefit=benefit)
    if not creatives:
        raise RuntimeError("생성된 문구가 모두 걸러졌습니다. 상품 정보를 확인하십시오.")

    backgrounds: list[Image.Image] = [Image.open(photo)]
    for i in range(scenes):
        try:
            raw = gemini.image(
                SCENE_PROMPT.format(scene=product.scene_hint or "minimal studio backdrop"),
                source=photo,
            )
            scene_path = out_dir / f"_scene{i + 1}.png"
            scene_path.write_bytes(raw)
            backgrounds.append(Image.open(scene_path))
        except Exception as exc:  # 배경 생성 실패가 전체를 막지 않는다.
            print(f"  배경 {i + 1} 생성 건너뜀: {exc}")

    targets = spec_mod.resolve(specs)
    layout_cycle = layouts or list(render.LAYOUTS)

    files: list[str] = []
    warnings: list[str] = []
    for idx, creative in enumerate(creatives):
        background = backgrounds[idx % len(backgrounds)]
        layout = layout_cycle[idx % len(layout_cycle)]
        for target in targets:
            # 세로로 긴 규격은 중앙 배치가 안전하다.
            chosen = "center_hero" if target.key == "story" else layout
            result = render.compose(background, creative, target, layout=chosen)
            stem = f"{idx + 1:02d}_{creative.angle or 'ad'}_{target.key}_{chosen}"
            path = result.save(out_dir / f"{stem}.jpg")
            files.append(str(path))
            warnings.extend(f"{stem}: {w}" for w in result.warnings)

    (out_dir / "manifest.json").write_text(
        Batch(product, creatives, files, warnings, gemini.usage.krw()).manifest(),
        encoding="utf-8",
    )
    return Batch(product, creatives, files, warnings, gemini.usage.krw())
