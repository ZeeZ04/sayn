"""Draws the Sayn app icon (two lenses: blue for speech, saffron for signs) at all needed sizes."""
from PIL import Image, ImageDraw
import os, sys

OUT = sys.argv[1] if len(sys.argv) > 1 else 'www/icons'
os.makedirs(OUT, exist_ok=True)
BG, BLUE, AMBER, INK = (11, 14, 19), (77, 163, 255), (255, 180, 61), (232, 238, 244)

def icon(size, pad_ratio=0.0, rounded=True):
    S = size * 4  # supersample for smooth edges
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if rounded:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=BG)
    else:
        d.rectangle([0, 0, S, S], fill=BG)
    inner = S * (1 - 2 * pad_ratio)
    ox = oy = S * pad_ratio
    u = inner / 100
    w = max(2, int(5.2 * u))
    def lens(x0, color):
        box = [ox + x0 * u, oy + 33 * u, ox + (x0 + 36) * u, oy + 67 * u]
        d.rounded_rectangle(box, radius=int(14 * u), outline=color, width=w)
    lens(9, BLUE); lens(55, AMBER)
    d.arc([ox + 42 * u, oy + 36 * u, ox + 58 * u, oy + 52 * u], start=200, end=340, fill=INK, width=w)
    # caption bars in the left lens, a dot in the right
    d.rounded_rectangle([ox + 17 * u, oy + 50 * u, ox + 37 * u, oy + 54 * u], radius=int(2 * u), fill=INK)
    d.rounded_rectangle([ox + 17 * u, oy + 57 * u, ox + 31 * u, oy + 61 * u], radius=int(2 * u), fill=BLUE)
    r = 3.6 * u
    for cx, cy in [(73, 58), (66, 46), (73, 43), (80, 46)]:
        d.ellipse([ox + cx * u - r, oy + cy * u - r, ox + cx * u + r, oy + cy * u + r], fill=AMBER)
    return im.resize((size, size), Image.LANCZOS)

icon(192).save(f'{OUT}/icon-192.png')
icon(512).save(f'{OUT}/icon-512.png')
icon(512, pad_ratio=0.12, rounded=False).save(f'{OUT}/maskable-512.png')
icon(180, rounded=False).convert('RGB').save(f'{OUT}/apple-touch-icon.png')
icon(1024, rounded=False).convert('RGB').save(f'{OUT}/icon-1024.png')
print('icons written to', OUT)
