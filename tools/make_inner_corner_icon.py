"""Export the generated two-face cable bend as a crisp inventory sprite."""

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]  # this mod's repo root
SOURCE = ROOT / "art_source/inner_corner_item_generated.png"
DESTINATION = ROOT / "starstone_rp/textures/items/starstone_inner_corner.png"

source = Image.open(SOURCE).convert("RGBA")
bounds = source.getchannel("A").point(lambda value: 255 if value >= 32 else 0).getbbox()
if bounds is None:
    raise ValueError("Generated corner source has no visible sprite")
sprite = source.crop(bounds).resize((29, 16), Image.Resampling.NEAREST)
sprite.putalpha(sprite.getchannel("A").point(lambda value: 255 if value >= 128 else 0))
canvas = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
canvas.alpha_composite(sprite, (1, 8))
canvas.save(DESTINATION)
