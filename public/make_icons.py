"""Generate PWA icons for AERIS terminal."""
from PIL import Image, ImageDraw
import os

def make_icon(size, path):
    img = Image.new("RGB", (size, size), "#0a0e13")
    draw = ImageDraw.Draw(img)
    pad = int(size * 0.06)
    w = max(1, size // 64)
    draw.ellipse([pad, pad, size - pad, size - pad], outline="#00d9ff", width=w)
    pad2 = int(size * 0.20)
    draw.ellipse([pad2, pad2, size - pad2, size - pad2], outline="#00d9ff", width=max(1, size // 96))
    cx, cy = size // 2, size // 2
    r = int(size * 0.22)
    off = int(size * 0.04)
    draw.ellipse([cx - r, cy - r - off, cx + r, cy + r - off], fill="#00d9ff")
    dr = int(size * 0.07)
    dot_off = int(size * 0.02)
    draw.ellipse([cx - dr, cy - dr + dot_off, cx + dr, cy + dr + dot_off], fill="#ff4d6d")
    img.save(path, "PNG")
    print(f"Saved {path}")

base = os.path.dirname(os.path.abspath(__file__))
make_icon(192, os.path.join(base, "icon-192.png"))
make_icon(512, os.path.join(base, "icon-512.png"))
print("Done.")
