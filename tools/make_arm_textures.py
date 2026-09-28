"""Create the arm textures sampled by cable, inner corner, bridge and adapters.

* starstone_cable_arm_{off,on}: copies of the cable textures whose conductor
  strip (UV 19,14 size 5x4) is made opaque and symmetric. The source strip's
  fourth row is almost fully transparent, so alpha_test cut one edge away.
* starstone_redstone_arm_{off,on}: flat red fills for the adapters' redstone
  arms (sampled as a single pixel), dark when no redstone signal is present.

The source cable textures are left unchanged.
"""
from pathlib import Path
from PIL import Image

BLOCKS = Path(__file__).resolve().parents[1] / 'starstone_rp/textures/blocks'
STRIP_X, STRIP_Y, STRIP_W, STRIP_H = 19, 14, 5, 4

for state in ('off', 'on'):
    image = Image.open(BLOCKS / f'starstone_cable_{state}.png').convert('RGBA')
    pixels = image.load()
    for x in range(STRIP_X, STRIP_X + STRIP_W):
        top = pixels[x, STRIP_Y]
        # Mirror the top edge onto the missing bottom edge, then make the
        # whole strip opaque so it survives alpha_test on every face.
        pixels[x, STRIP_Y + STRIP_H - 1] = top
        for y in range(STRIP_Y, STRIP_Y + STRIP_H):
            r, g, b, _ = pixels[x, y]
            pixels[x, y] = (r, g, b, 255)
    image.save(BLOCKS / f'starstone_cable_arm_{state}.png')

# The lit colour is the adapter texture's existing red pixel (18,15).
for state, colour in (('off', (86, 16, 20, 255)), ('on', (238, 55, 63, 255))):
    Image.new('RGBA', (32, 32), colour).save(BLOCKS / f'starstone_redstone_arm_{state}.png')
