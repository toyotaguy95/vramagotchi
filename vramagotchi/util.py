"""Small helpers shared by the rest of the package."""


def clamp(v, lo=0.0, hi=1.0):
    return max(lo, min(hi, v))


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def shade(c, k):
    return tuple(max(0, min(255, round(v * k))) for v in c)


def human(n):
    n = float(n)
    for unit, size in (("M", 1e6), ("k", 1e3)):
        if n >= size:
            return f"{n / size:.1f}{unit}"
    return f"{n:.0f}"


def age(seconds):
    if seconds >= 86400:
        return f"{seconds / 86400:.0f}d old"
    if seconds >= 3600:
        return f"{seconds / 3600:.0f}h old"
    return "newborn" if seconds < 600 else f"{seconds / 60:.0f}m old"
