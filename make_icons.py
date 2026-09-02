from PIL import Image, ImageDraw
import math

def draw_mark(size, bg, ring, dot, maskable=False):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = int(size * (0.16 if maskable else 0.06))
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * 0.22), fill=bg)

    cx, cy = size / 2, size / 2
    R = (size - 2 * pad) / 2

    d.ellipse([cx - R, cy - R, cx + R, cy + R], outline=ring, width=max(2, int(size * 0.018)))

    # three nodes: top, bottom-left, bottom-right (mirrors the in-app mark)
    node_r = R * 0.19
    top = (cx, cy - R * 0.5)
    bl = (cx - R * 0.46, cy + R * 0.5)
    br = (cx + R * 0.46, cy + R * 0.5)

    line_w = max(2, int(size * 0.014))
    d.line([top, bl], fill=ring, width=line_w)
    d.line([top, br], fill=ring, width=line_w)
    d.line([bl, br], fill=ring, width=line_w)

    for (x, y) in (top, bl, br):
        d.ellipse([x - node_r, y - node_r, x + node_r, y + node_r], fill=dot)

    return img

bg = (18, 20, 28, 255)      # --bg dark
ring = (232, 163, 61, 90)   # accent, faint ring
dot = (232, 163, 61, 255)   # accent, solid nodes

draw_mark(192, bg, ring, dot).save("public/icons/icon-192.png")
draw_mark(512, bg, ring, dot).save("public/icons/icon-512.png")
draw_mark(512, bg, ring, dot, maskable=True).save("public/icons/icon-maskable-512.png")
print("icons written")
