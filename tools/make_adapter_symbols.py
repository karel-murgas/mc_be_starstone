"""Render distinct pixel-art Redstone→Starstone and Starstone→Redstone adapters."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1] / 'starstone_rp/textures'
INK = (7, 13, 28, 255)
EDGE = (42, 66, 91, 255)
METAL = (20, 35, 54, 255)
RED = (238, 55, 63, 255)
RED_DARK = (126, 25, 39, 255)
BLUE = (45, 215, 247, 255)
BLUE_DARK = (22, 94, 150, 255)
WHITE = (233, 250, 255, 255)

def render(input_adapter, item):
    image = Image.new('RGBA', (32, 32))
    draw = ImageDraw.Draw(image)
    left = RED if input_adapter else BLUE
    right = BLUE if input_adapter else RED
    left_dark = RED_DARK if input_adapter else BLUE_DARK
    right_dark = BLUE_DARK if input_adapter else RED_DARK
    if item:
        draw.polygon([(3, 14), (8, 9), (24, 9), (29, 14), (29, 19),
                      (24, 24), (8, 24), (3, 19)], fill=INK, outline=EDGE)
        draw.rectangle((6, 14, 11, 19), fill=left_dark)
        draw.rectangle((7, 15, 11, 18), fill=left)
        draw.rectangle((21, 14, 26, 19), fill=right_dark)
        draw.rectangle((21, 15, 25, 18), fill=right)
        draw.rectangle((12, 12, 20, 21), fill=METAL, outline=EDGE)
        draw.rectangle((13, 15, 17, 18), fill=left)
        draw.polygon([(17, 13), (22, 17), (17, 21)], fill=right)
        draw.point((18, 17), fill=WHITE)
        draw.line((9, 22, 23, 22), fill=EDGE)
    else:
        draw.rectangle((5, 5, 26, 26), fill=INK, outline=EDGE)
        draw.rectangle((8, 8, 23, 23), fill=METAL, outline=EDGE)
        draw.rectangle((10, 14, 13, 18), fill=left_dark)
        draw.rectangle((11, 15, 13, 17), fill=left)
        draw.rectangle((20, 14, 23, 18), fill=right_dark)
        draw.rectangle((20, 15, 22, 17), fill=right)
        draw.rectangle((14, 15, 17, 17), fill=left)
        draw.polygon([(17, 12), (21, 16), (17, 20)], fill=right)
        draw.point((18, 16), fill=WHITE)
        draw.line((10, 10, 22, 10), fill=EDGE)
        draw.line((10, 22, 22, 22), fill=EDGE)
        # Both adapters sample the output atlas for their red arms.
        if not input_adapter:
            draw.point((18, 15), fill=RED)
    return image

for input_adapter, name in ((True, 'input'), (False, 'output')):
    for item, folder in ((True, 'items'), (False, 'blocks')):
        target = ROOT / folder / f'starstone_redstone_{name}.png'
        target.parent.mkdir(parents=True, exist_ok=True)
        render(input_adapter, item).save(target)
