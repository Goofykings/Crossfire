"""Locate the sun in an equirectangular Radiance .hdr (RGBE) panorama.

Usage: python -I tools/find_sun.py public/assets/env/sky_1k.hdr

Prints the sun's pixel, its azimuth/elevation and the direction vector in panorama space
(u = 0..1 left to right, v = 0..1 top to bottom). The runtime maps panorama directions the same
way Babylon's panorama-to-cubemap conversion does; see Environment.ts.
"""
import math
import sys


def read_hdr(path):
    data = open(path, "rb").read()
    pos = 0
    while True:
        end = data.index(b"\n", pos)
        line = data[pos:end]
        pos = end + 1
        if line.strip() == b"":
            break
    end = data.index(b"\n", pos)
    res = data[pos:end].split()
    pos = end + 1
    height, width = int(res[1]), int(res[3])
    pixels = []
    for _ in range(height):
        if data[pos] == 2 and data[pos + 1] == 2:
            pos += 4
            chans = []
            for _c in range(4):
                row = []
                while len(row) < width:
                    count = data[pos]
                    pos += 1
                    if count > 128:
                        count -= 128
                        row.extend([data[pos]] * count)
                        pos += 1
                    else:
                        row.extend(data[pos:pos + count])
                        pos += count
                chans.append(row)
            scan = []
            for x in range(width):
                r, g, b, e = chans[0][x], chans[1][x], chans[2][x], chans[3][x]
                f = math.ldexp(1.0, e - 136) if e else 0.0
                scan.append((r * f, g * f, b * f))
        else:
            scan = []
            for x in range(width):
                r, g, b, e = data[pos:pos + 4]
                pos += 4
                f = math.ldexp(1.0, e - 136) if e else 0.0
                scan.append((r * f, g * f, b * f))
        pixels.append(scan)
    return width, height, pixels


def main():
    w, h, px = read_hdr(sys.argv[1])
    best, bx, by = -1.0, 0, 0
    for y in range(h // 2):
        for x in range(w):
            r, g, b = px[y][x]
            lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
            if lum > best:
                best, bx, by = lum, x, y
    # luminance-weighted centroid of the sun disk for sub-pixel accuracy
    sx = sy = sw = 0.0
    for y in range(max(0, by - 6), min(h, by + 7)):
        for x in range(bx - 6, bx + 7):
            r, g, b = px[y][x % w]
            lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
            if lum > best * 0.2:
                sx += x * lum
                sy += y * lum
                sw += lum
    u = (sx / sw + 0.5) / w
    v = (sy / sw + 0.5) / h
    elevation = (0.5 - v) * 180
    print(f"size {w}x{h} peak {best:.1f} at ({bx},{by}); u={u:.4f} v={v:.4f} elevation={elevation:.1f} deg")


if __name__ == "__main__":
    main()
