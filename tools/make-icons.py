#!/usr/bin/env python3
"""Generate questlog's PNG icons with no image libraries — just zlib.

Draws a rounded square with a violet gradient, three ascending bars and a
spark, supersampled 3x for smooth edges.

    python3 tools/make-icons.py
"""
import math
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "icons"
SS = 3  # supersampling factor


def lerp(a, b, t):
    return a + (b - a) * t


def inside_rrect(x, y, x0, y0, x1, y1, r):
    if not (x0 <= x <= x1 and y0 <= y <= y1):
        return False
    dx = max(x0 + r - x, 0.0, x - (x1 - r))
    dy = max(y0 + r - y, 0.0, y - (y1 - r))
    if dx == 0.0 or dy == 0.0:
        return True
    return dx * dx + dy * dy <= r * r


def inside_star(x, y, cx, cy, radius):
    u = abs(x - cx) / radius
    v = abs(y - cy) / radius
    if u > 1 or v > 1:
        return False
    return math.sqrt(u) + math.sqrt(v) <= 1.0


def render(size, *, glyph_scale=1.0, corner=0.22, bleed=False):
    """Return RGBA bytes for one icon."""
    top = (0x8B, 0x6D, 0xFF)
    bottom = (0x4C, 0x2F, 0xD0)
    bar_color = (0xFF, 0xFF, 0xFF)
    spark_color = (0x34, 0xE6, 0xF0)

    n = size * SS
    radius = 0.0 if bleed else corner * n
    inset = 0.0 if bleed else 0.02 * n

    # Glyph geometry, in supersampled units, centred in the icon.
    box = n * 0.56 * glyph_scale
    cx, cy = n / 2, n / 2 + n * 0.03 * glyph_scale
    bar_w = box * 0.22
    gap = box * 0.13
    heights = (0.42, 0.66, 1.0)
    total_w = 3 * bar_w + 2 * gap
    left = cx - total_w / 2
    base = cy + box / 2
    bar_r = bar_w * 0.32

    spark_r = box * 0.20
    spark_cx = cx + total_w / 2 + spark_r * 0.35
    spark_cy = cy - box / 2 - spark_r * 0.15

    pixels = bytearray()
    samples = SS * SS
    for py in range(size):
        row = bytearray()
        for px in range(size):
            r_acc = g_acc = b_acc = a_acc = 0.0
            for sy in range(SS):
                y = py * SS + sy + 0.5
                for sx in range(SS):
                    x = px * SS + sx + 0.5
                    if not inside_rrect(x, y, inset, inset, n - inset, n - inset, radius):
                        continue
                    t = y / n
                    cr = lerp(top[0], bottom[0], t)
                    cg = lerp(top[1], bottom[1], t)
                    cb = lerp(top[2], bottom[2], t)
                    # a soft diagonal highlight
                    sheen = max(0.0, 1.0 - ((x + y) / (2 * n)) * 1.6) * 26
                    cr, cg, cb = cr + sheen, cg + sheen * 0.6, cb + sheen

                    for index, height in enumerate(heights):
                        bx0 = left + index * (bar_w + gap)
                        by0 = base - box * height
                        if inside_rrect(x, y, bx0, by0, bx0 + bar_w, base, bar_r):
                            cr, cg, cb = bar_color
                            break
                    else:
                        if inside_star(x, y, spark_cx, spark_cy, spark_r):
                            cr, cg, cb = spark_color

                    r_acc += cr
                    g_acc += cg
                    b_acc += cb
                    a_acc += 255.0
            if a_acc == 0:
                row += bytes((0, 0, 0, 0))
            else:
                cover = a_acc / (samples * 255.0)
                row += bytes((
                    min(255, int(r_acc / (a_acc / 255.0))),
                    min(255, int(g_acc / (a_acc / 255.0))),
                    min(255, int(b_acc / (a_acc / 255.0))),
                    int(round(cover * 255)),
                ))
        pixels += b"\x00" + row
    return bytes(pixels)


def write_png(path, size, raw):
    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", header)
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))
    path.write_bytes(png)
    return len(png)


def main():
    OUT.mkdir(exist_ok=True)
    jobs = [
        ("icon-192.png", 192, {}),
        ("icon-512.png", 512, {}),
        ("icon-maskable-512.png", 512, {"glyph_scale": 0.66, "bleed": True}),
        ("apple-touch-icon.png", 180, {"corner": 0.0}),
    ]
    for name, size, opts in jobs:
        raw = render(size, **opts)
        written = write_png(OUT / name, size, raw)
        print(f"{name:26} {size:>4}px  {written / 1024:6.1f} KB")


if __name__ == "__main__":
    main()
