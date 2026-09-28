"""Create exact-pixel inactive variants of the generator and conduit end."""

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1] / "starstone_rp/textures/blocks"


def darken_energy(source_name: str, target_name: str) -> None:
    image = Image.open(ROOT / source_name).convert("RGBA")
    pixels = image.load()
    for y in range(image.height):
        for x in range(image.width):
            red, green, blue, alpha = pixels[x, y]
            # Preserve the gunmetal frame. Blue/cyan/white energy pixels become
            # muted navy while keeping exactly the source pixel layout/alpha.
            if alpha and blue >= red and blue >= green * 0.8 and blue > 70:
                pixels[x, y] = (
                    min(50, 8 + round(red * 0.18)),
                    min(65, 19 + round(green * 0.18)),
                    min(105, 35 + round(blue * 0.27)),
                    alpha,
                )
    image.save(ROOT / target_name)


darken_energy("starstone_generator.png", "starstone_generator_off.png")
darken_energy("starstone_conduit_end.png", "starstone_conduit_end_off.png")
