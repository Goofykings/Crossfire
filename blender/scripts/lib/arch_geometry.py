"""One segmental arch profile for visible soffits and conservative collision slices."""
import math


def profile(lo, hi, spring, apex, segments=12):
    rise = apex - spring
    if rise < 1e-6:
        return [(lo, apex), (hi, apex)]
    radius = ((hi - lo) ** 2 / 4 + rise ** 2) / (2 * rise)
    center, cy = (lo + hi) / 2, apex - radius
    a, b = math.atan2(spring - cy, lo - center), math.atan2(spring - cy, hi - center)
    return [(center + radius * math.cos(a + (b - a) * i / segments),
             cy + radius * math.sin(a + (b - a) * i / segments)) for i in range(segments + 1)]


def slices(lo, hi, spring, apex, top, segments=12):
    # Sample the same exported planar soffits; conservative error is < 3 cm.
    points = profile(lo, hi, spring, apex, segments)
    for (a, ya), (b, yb) in zip(points, points[1:]):
        for i in range(8):
            x0, x1 = a + (b-a)*i/8, a + (b-a)*(i+1)/8
            y = min(ya+(yb-ya)*i/8, ya+(yb-ya)*(i+1)/8)
            if top > y + 1e-6:
                # Collision exports quantize to 0.1 mm. Overlap neighbours by
                # that amount so rays cannot slip through a rounding seam.
                yield x0-.0001, x1+.0001, y, top
