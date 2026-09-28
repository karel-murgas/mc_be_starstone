"""Export the generated Compressed Dust concept as a crisp 32 px inventory sprite."""

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]  # this mod's repo root
SOURCE = ROOT / "art_source/compressed_dust_generated.png"
DESTINATION = ROOT / "starstone_rp/textures/items/starstone_compressed_dust.png"

source = Image.open(SOURCE).convert("RGBA")
alpha = source.getchannel("A")
bounds = alpha.point(lambda value: 255 if value >= 32 else 0).getbbox()
if bounds is None:
    raise ValueError("Generated source has no visible sprite")

sprite = source.crop(bounds).resize((27, 23), Image.Resampling.NEAREST)
sprite.putalpha(sprite.getchannel("A").point(lambda value: 255 if value >= 128 else 0))
canvas = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
canvas.alpha_composite(sprite, (2, 5))
DESTINATION.parent.mkdir(parents=True, exist_ok=True)
canvas.save(DESTINATION)
