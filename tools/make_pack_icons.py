"""Export the generated Starstone pack emblem for both paired add-on packs."""

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]  # this mod's repo root
SOURCE = ROOT / "art_source/starstone_pack_emblem_generated.png"
image = Image.open(SOURCE).convert("RGBA")
side = min(image.size)
left = (image.width - side) // 2
top = (image.height - side) // 2
icon = image.crop((left, top, left + side, top + side)).resize((256, 256), Image.Resampling.NEAREST)
for pack in ("starstone_bp", "starstone_rp"):
    icon.save(ROOT / pack / "pack_icon.png")
