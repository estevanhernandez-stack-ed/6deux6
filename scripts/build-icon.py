"""6deux6 app icon — navy field, cyan/magenta glow, up-arrow ship-it motif.
Run: python scripts/build-icon.py  ->  assets/icon-1024.png"""
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

S = 1024
NAVY = (15, 31, 49)
CYAN = (23, 212, 250)
MAGENTA = (242, 47, 137)

OUT = Path(__file__).resolve().parent.parent / "assets"
OUT.mkdir(exist_ok=True)


def radial_glow(size, cx, cy, color, max_alpha, radius):
    arr = np.zeros((size, size, 4), dtype=np.uint8)
    yy, xx = np.indices((size, size))
    dist = np.sqrt((xx - cx * size) ** 2 + (yy - cy * size) ** 2)
    falloff = np.clip(1 - dist / (radius * size), 0, 1) ** 2
    arr[..., 0], arr[..., 1], arr[..., 2] = color
    arr[..., 3] = (falloff * max_alpha).astype(np.uint8)
    return Image.fromarray(arr, "RGBA")


def arrow_layer(color, width_scale=1.0):
    """Up-arrow: shaft swoosh + head, drawn as polygons."""
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    w = int(56 * width_scale)
    # curved shaft: straight segments approximating the brand swoosh
    d.line([(300, 780), (460, 640), (560, 460), (620, 300)], fill=color + (255,), width=w, joint="curve")
    # arrowhead
    d.polygon([(620 - 90, 330), (620 + 60, 330 - 40), (660, 180)], fill=color + (255,))
    return layer


canvas = Image.new("RGBA", (S, S), NAVY + (255,))
canvas.alpha_composite(radial_glow(S, 0.32, 0.70, CYAN, 90, 0.55))
canvas.alpha_composite(radial_glow(S, 0.70, 0.30, MAGENTA, 80, 0.55))

# magenta echo arrow behind, offset — the "trail"
echo = arrow_layer(MAGENTA, 1.0)
echo = echo.transform((S, S), Image.AFFINE, (1, 0, 60, 0, 1, 40))
echo_blur = echo.filter(ImageFilter.GaussianBlur(6))
canvas.alpha_composite(echo_blur)

# cyan lead arrow with soft glow
lead = arrow_layer(CYAN, 1.0)
glow = lead.filter(ImageFilter.GaussianBlur(18))
canvas.alpha_composite(glow)
canvas.alpha_composite(lead)

out = OUT / "icon-1024.png"
canvas.convert("RGB").save(out, "PNG", optimize=True)
print(f"wrote {out}")
