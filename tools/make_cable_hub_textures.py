"""Create a four-way symmetric cable hub for both power states."""
from pathlib import Path
from PIL import Image

OUTPUT = Path(__file__).resolve().parents[1] / 'starstone_rp/textures/blocks'
OUTPUT.mkdir(parents=True, exist_ok=True)

for state, base, rim, core in (
    ('off', (9, 22, 47, 255), (23, 73, 126, 255), (36, 118, 181, 255)),
    ('on', (7, 39, 77, 255), (14, 137, 222, 255), (93, 241, 255, 255)),
):
    image = Image.new('RGBA', (32, 32), base)
    # All four rotations give the same image. The arms use their own texture.
    for y in range(6):
        for x in range(6):
            edge = x in (0, 5) or y in (0, 5)
            image.putpixel((13 + x, 13 + y), rim if edge else core)
    image.save(OUTPUT / f'starstone_cable_hub_{state}.png')
