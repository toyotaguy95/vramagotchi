"""Draws a pet as a small grid of colored pixels. Every display starts from this grid."""

import colorsys
import math
import random
import time

from .pet import STAGES
from .util import clamp, lerp, shade

W, H = 36, 30                 # canvas in pixels
GROUND = 26                   # lowest row of the body; feet hang just below
FPS = 10

EYE, WHITE, GLINT = (34, 28, 52), (252, 252, 252), (124, 128, 204)
MOUTH, TONGUE, NOSE, BLUSH, SWEAT = (120, 30, 60), (245, 120, 140), (250, 140, 165), (255, 118, 150), (130, 205, 255)
CANDY = [(255, 214, 10), (64, 224, 208), (255, 105, 180), (170, 130, 255), (255, 140, 0), (255, 255, 255)]

PAL = {
    "y": (255, 214, 64), "Y": (214, 150, 30), "r": (236, 72, 82), "R": (176, 40, 60), "b": (92, 150, 240),
    "s": (170, 205, 255), "w": WHITE, "k": (42, 40, 56), "e": (156, 158, 176), "E": (94, 96, 114),
    "p": (255, 110, 156), "P": (214, 62, 112), "u": (146, 96, 226), "U": (98, 58, 172), "g": (126, 204, 96),
    "G": (62, 146, 76), "n": (240, 214, 170), "c": (130, 196, 250), "#": EYE, "W": WHITE, "o": GLINT,
    "M": MOUTH, "T": TONGUE, "O": (255, 140, 20),
}

EYES = {                      # 3 wide, 4 tall
    "open": ["WW#", "WW#", "###", "##o"],
    "blink": ["...", "...", "###", "..."],
    "happy": ["...", ".#.", "#.#", "..."],
    "sleep": ["...", "...", "#.#", ".#."],
    "x": ["#.#", ".#.", "#.#", "..."],
    "gt": ["##.", "..#", "##.", "..."],
    "lt": [".##", "#..", ".##", "..."],
    "set": ["###", "W##", "###", "##o"],
    "teary": ["WW#", "WW#", "###", "#WW"],
}
MOUTHS = {                    # 4 wide
    "smile": ["#..#", ".##."],
    "flat": [".##."],
    "grit": ["####"],
    "open": ["MMMM", "MTTM", ".MM."],
    "wavy": ["#.#.", ".#.#"],
    "out": ["####", "..TT"],
    "frown": [".##.", "#..#"],
}
HATS = {                      # even widths so they sit centred; bottom row overlaps the top of the head
    "crown": ["y...yy...y", "yy.yyyy.yy", "yyyyyyyyyy", "yryybbyyry", "YYYYYYYYYY"],
    "wizard": [".....uu.....", ".....uu.....", "....uuuu....", "....uyuu....", "...uuuuuu...", "...uuuyuu...",
               "..uuuuuuuu..", "UUUUUUUUUUUU"],
    "tophat": ["..kkkkkk..", "..kEkkkk..", "..kEkkkk..", "..kkkkkk..", "..rrrrrr..", "kkkkkkkkkk"],
    "nightcap": ["..........ww", ".......bbsww", ".....bbssb..", "....bssbb...", "...bbssbbb..", "..bssbbssbb.",
                 ".wwwwwwwwww."],
    "icepack": ["...ww...", "..cccc..", ".ccwccc.", ".cccccc.", "..cccc.."],
    "propeller": [".eeeeeeeeee.", ".....kk.....", "...rryybb...", "..rrryybbb..", ".kkkkkkkkkk."],
    "propeller2": ["....eEEe....", ".....kk.....", "...rryybb...", "..rrryybbb..", ".kkkkkkkkkk."],
    "halo": [".yyyyyyyy.", "yY......Yy", ".yyyyyyyy.", "..........", ".........."],        # floats above the head
    "star": ["....yy....", "...yyyy...", "yyyyyyyyyy", ".yyyWWyyy.", "..yyyyyy..", ".yyy..yyy.", ".y......y.",
             ".........."],
    "flame": ["....r...", "...rr...", "..rOOr..", ".rOOOrr.", ".rOyyOr.", ".rOywOr.", "..rrrr.."],
}
BITS = {
    "bow": ["pp...pp", "ppp.ppp", "pppPppp", "ppp.ppp", "pp...pp"],
    "flower": [".ppp.", "ppypp", "pyyyp", "ppypp", ".ppp."],
    "bandage": ["n...n", ".n.n.", "..n..", ".n.n.", "n...n"],
    "ghost": [".www.", "wwwww", "w#w#w", "wwwww", "wwwww", "w.w.w"],
    "heart": [".r.r.", "rrrrr", ".rrr.", "..r.."],
    "z": ["ssss", "..s.", ".s..", "ssss"],
    "Z": ["sssss", "...s.", "..s..", ".s...", "sssss"],
    "star": [".y.", "yWy", ".y."],
    "sprout": [".gg..gg.", "gGGggGGg", ".gGGGGg.", "..gGGg..", "...GG...", "...GG..."],
}
for _name, _rows in {**EYES, **MOUTHS, **HATS, **BITS}.items():
    assert len({len(r) for r in _rows}) == 1, f"ragged pixel map: {_name}"


def rnd(v):
    return int(math.floor(v + 0.5))


def draw_egg(pet, frame, now):
    """An egg in the pet's colours: it wobbles while it waits, then cracks open."""
    px = [[None] * W for _ in range(H)]
    shell, spot, rim = (250, 244, 226), pet.color, (112, 96, 120)
    since = now - pet.hatch_start if pet.hatch_start else None
    wobble = math.sin(frame * 1.9) * 1.6 if since is not None else (math.sin(frame * 0.9) * 1.2 if frame % 30 < 8 else 0)
    cx, cy, rx, ry = (W - 1) / 2 + wobble, GROUND - 7.5, 7.0, 9.0

    def inside(x, y):
        dy = (y - cy) / (ry if y > cy else ry * 1.12)        # a little pointier on top
        return ((x - cx) / rx) ** 2 + dy ** 2 <= 1.0

    for y in range(H):
        for x in range(W):
            if not inside(x, y):
                continue
            whole = inside(x - 1, y) and inside(x + 1, y) and inside(x, y - 1) and inside(x, y + 1)
            dots = (math.hypot(x - cx + 3, y - cy + 4) < 2.2 or math.hypot(x - cx - 3.5, y - cy - 1) < 2.0
                    or math.hypot(x - cx + 1, y - cy - 5) < 1.7)
            px[y][x] = rim if not whole else spot if dots else shade(shell, 0.9) if (x - cx) / rx + (y - cy) / ry > 0.7 else shell
    if since is not None:
        reach = int(clamp(since / 1.6) * 15)                 # the crack creeps across
        for i in range(reach):
            x, y = rnd(cx - 7 + i), rnd(cy - 1 + (1 if i % 4 < 2 else -1))
            if 0 <= x < W and 0 <= y < H and px[y][x] is not None:
                px[y][x] = rim
        if since > 1.7:
            for i, (x, y) in enumerate(((3, 5), (30, 4), (5, 20), (29, 19), (10, 1), (24, 1))):
                if (frame + i) % 2 == 0:
                    for dx, dy in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)):
                        px[y + dy][x + dx] = PAL["y"]
    return px


def draw(pet, frame, now=None):
    """Returns an H x W grid of RGB tuples (None = see-through) and moves the pet's particles on one step."""
    now = now or time.time()
    if pet.egg:
        return draw_egg(pet, frame, now)
    g, mood, sp = pet.gpu, pet.mood, pet.species
    happy = now < pet.petted_until
    px = [[None] * W for _ in range(H)]
    mask = [[False] * W for _ in range(H)]

    def put(x, y, c):
        x, y = rnd(x), rnd(y)
        if 0 <= x < W and 0 <= y < H:
            px[y][x] = c

    def stamp(rows, x0, y0, clip=False):
        for dy, row in enumerate(rows):
            for dx, ch in enumerate(row):
                x, y = x0 + dx, y0 + dy
                if ch != "." and 0 <= x < W and 0 <= y < H and (not clip or mask[y][x]):
                    px[y][x] = PAL[ch]

    def region(test, x0, y0, x1, y1):
        return [(x, y) for y in range(max(0, math.floor(y0)), min(H, math.ceil(y1) + 1))
                for x in range(max(0, math.floor(x0)), min(W, math.ceil(x1) + 1)) if test(x, y)]

    def oval(ox, oy, a, b):
        return region(lambda x, y: ((x - ox) / a) ** 2 + ((y - oy) / b) ** 2 <= 1.0, ox - a, oy - b, ox + a, oy + b)

    def tri(ax, ay, bx, by, qx, qy):
        def side(x, y, x1, y1, x2, y2):
            return (x - x2) * (y1 - y2) - (x1 - x2) * (y - y2)

        def test(x, y):
            d1, d2, d3 = side(x, y, ax, ay, bx, by), side(x, y, bx, by, qx, qy), side(x, y, qx, qy, ax, ay)
            return not ((d1 < 0 or d2 < 0 or d3 < 0) and (d1 > 0 or d2 > 0 or d3 > 0))
        return region(test, min(ax, bx, qx), min(ay, by, qy), max(ax, bx, qx), max(ay, by, qy))

    # ── colours: the body warms toward red with the card, and goes pale when it faints ──
    coat = pet.color
    if pet.shiny:                    # a shiny pet's coat drifts slowly through every colour
        coat = tuple(rnd(v * 255) for v in colorsys.hsv_to_rgb(now * 0.04 % 1, 0.5, 1.0))
    base = lerp(coat, (240, 70, 60), clamp((g.temp - 62) / 28) * 0.75)
    if mood == "fainted":
        base = lerp(base, (168, 168, 182), 0.65)
    dark, light = shade(base, 0.82), lerp(base, WHITE, 0.55)
    edge = lerp(shade(base, 0.48), (52, 32, 84), 0.3)
    cream, pink = lerp(base, (255, 249, 236), 0.78), lerp(base, BLUSH, 0.6)

    # ── shape: wider with more VRAM in use, and a little bounce depending on mood ──
    cx = (W - 1) / 2
    rx = 8.5 + clamp((pet.pct - 0.08) / 0.9) * 4.5
    breath = math.sin(frame / FPS * 2 * math.pi / 3.2)
    beat = frame % 4 < 2
    asleep = mood in ("sleeping", "fainted")
    if mood == "fainted":
        rx, ry = rx + 2.5, 4.6
    elif mood == "sleeping":
        rx, ry = rx + 0.8, 7.0 + (0.5 if breath > 0 else 0)
    elif happy:
        ry = 8.0 + (1.0 if beat else 0)
    elif mood in ("eating", "working", "overheating"):
        ry = 8.0 + (0.6 if beat else 0)
    else:
        ry = 8.0 + (0.5 if breath > 0.3 else 0)
    grown = STAGES[pet.stage][2]     # a young pet is drawn smaller
    rx, ry = rx * grown, ry * grown
    cy = GROUND + 0.5 - ry
    top = cy - ry
    head = math.ceil(top)            # first row of the body

    def in_body(x, y):
        dx, dy = abs(x - cx) / rx, (y - cy) / ry
        p = 3.4 if dy > 0 else 2.5
        return dx ** p + abs(dy) ** p <= 1.0

    parts = [region(in_body, cx - rx, top, cx + rx, GROUND)]
    inner = []                       # (pixels, colour) painted inside the outline afterwards
    for side in (-1, 1):
        if sp == "cat":
            ex = cx + side * rx * 0.60
            parts.append(tri(ex - 2.9, top + 2.4, ex + 2.9, top + 2.4, ex + side * 0.9, top - 3.6))
            inner.append((tri(ex - 1.2, top + 1.6, ex + 1.2, top + 1.6, ex + side * 0.7, top - 1.4), pink))
        elif sp == "bear":
            ex = cx + side * rx * 0.66
            parts.append(oval(ex, top + 0.9, 2.7, 2.7))
            inner.append((oval(ex, top + 1.0, 1.2, 1.2), cream))
        elif sp == "bunny":
            ex, tall = cx + side * (rx * 0.42 + 0.4), 2.6 if asleep else 4.8
            parts.append(oval(ex, top + 1.0 - tall, 1.9, tall + 0.6))
            inner.append((oval(ex, top + 0.8 - tall, 0.75, tall - 0.9), pink))
        elif sp == "robot":                      # a bolt on each side of its head
            ex = cx + side * (rx + 0.8)
            bolt = region(lambda x, y, ex=ex: abs(x - ex) <= 1.3 and abs(y - (cy - 1.5)) <= 2.2, ex - 2, cy - 4, ex + 2, cy + 1)
            parts.append(bolt)
            inner.append((bolt, PAL["e"]))
        elif sp == "axolotl":                    # three gills fanning out from each cheek
            for k in range(3):
                gill = oval(cx + side * (rx + 1.6 - 0.5 * k), top + 3.0 + k * 2.4, 2.4, 1.0)
                parts.append(gill)
                inner.append((gill, lerp(base, (255, 90, 140), 0.6)))
        elif sp == "dragon" and pet.stage < 3:   # a dragon has horns from the start; every adult gets them later
            hx = cx + side * rx * 0.5
            horn = tri(hx - 1.6, top + 1.6, hx + 1.6, top + 1.6, hx + side * 1.2, top - 3.2)
            parts.append(horn)
            inner.append((horn, cream))
    if sp == "mushroom":                         # a red cap with white spots, wider than the body
        cap = [p for p in oval(cx, top + 2.4, rx + 2.4, 4.8) if p[1] <= top + 2.6]
        parts.append(cap)
        inner.append((cap, PAL["r"]))
        for dx, dy, r in ((-0.55, 0.6, 1.5), (0.08, -1.4, 1.6), (0.62, 0.9, 1.3)):
            inner.append(([p for p in oval(cx + dx * rx, top + dy, r, r * 0.8) if p in set(cap)], WHITE))
    elif sp == "duck":                           # a tuft of feathers
        parts.append(oval(cx + 0.5, top - 0.4, 1.3, 1.9))
    if pet.stage >= 3:               # grown-ups get horns and little wings; a legend's are gold
        trim = PAL["y"] if pet.stage >= 4 else cream
        for side in (-1, 1):
            hx = cx + side * rx * 0.24
            parts.append(tri(hx - 1.7, top + 1.6, hx + 1.7, top + 1.6, hx + side * 1.3, top - 3.6))
            inner.append((tri(hx - 1.7, top + 1.6, hx + 1.7, top + 1.6, hx + side * 1.3, top - 3.6), trim))
            if not asleep:
                wx, flap = cx + side * (rx + 0.4), (1 if beat and mood in ("eating", "working") else 0)
                wing = tri(wx - side, cy - 1, wx + side * 5.5, cy - 7 - flap, wx + side * 4.5, cy + 2)
                parts.append(wing)
                inner.append(([p for p in wing if not in_body(*p)], PAL["y"] if pet.stage >= 4 else shade(base, 0.66)))
    if mood != "fainted":
        if sp in ("cat", "dragon"):
            sway = 0 if asleep else math.sin(frame / FPS * math.pi) * 0.8
            for i in range(8):       # a tail curling up the right side
                t = i / 7
                parts.append(oval(cx + rx - 1.0 + 3.0 * math.sin(t * 2.2) + sway * t, GROUND - 1.2 - 5.6 * t, 1.5, 1.5))
        elif sp == "bear":
            parts.append(oval(cx + rx - 0.2, GROUND - 2.2, 1.5, 1.5))
        elif sp == "bunny":
            parts.append(oval(cx + rx + 0.7, GROUND - 2.4, 2.1, 2.1))
            inner.append((oval(cx + rx + 0.7, GROUND - 2.4, 1.3, 1.3), WHITE))

    if mood == "fainted":
        arms = [GROUND - 0.5] * 2
    elif mood == "sleeping":
        arms = [cy + ry * 0.55] * 2
    elif happy:
        arms = [cy - ry * 0.25 - (1 if beat else 0)] * 2
    elif mood == "eating":
        arms = [cy + ry * 0.05 - (1 if beat else 0), cy + ry * 0.05 - (0 if beat else 1)]
    elif mood == "working":
        arms = [cy + (-1.5 if beat else 1.5), cy + (1.5 if beat else -1.5)]
    else:
        arms = []
    for side, ay in zip((-1, 1), arms):
        parts.append(oval(cx + side * (rx - 0.3), ay, 2.3, 2.1))
    if not asleep and sp != "ghost":             # a ghost has no feet
        hop = mood == "working"
        for side, lifted in ((-1, hop and beat), (1, hop and not beat)):
            if not lifted:
                parts.append(oval(cx + side * rx * 0.42, GROUND + 0.7, 2.0, 1.3))

    for part in parts:
        for x, y in part:
            mask[y][x] = True
    if sp == "ghost" and mood != "fainted":      # a rippling hem where feet would be
        for x in range(W):
            if (x + frame // 5) % 4 < 2:
                mask[GROUND][x] = False
                if (x + frame // 5) % 4 == 0:
                    mask[GROUND - 1][x] = False
    for y in range(H):
        for x in range(W):
            if not mask[y][x]:
                continue
            whole = 0 < x < W - 1 and 0 < y < H - 1 and mask[y][x - 1] and mask[y][x + 1] and mask[y - 1][x] and mask[y + 1][x]
            px[y][x] = (dark if (x - cx) / rx * 0.55 + (y - cy) / ry > 0.62 else base) if whole else edge
    for pixels, color in inner + [(oval(cx, cy + ry * 0.45, rx * 0.58, ry * 0.50), cream)]:
        for x, y in pixels:
            if mask[y][x] and px[y][x] != edge:
                px[y][x] = shade(color, 0.92) if px[y][x] == dark else color
    hx, hy = rnd(cx - rx * 0.52), rnd(cy - ry * 0.66)
    for x, y in ((hx, hy), (hx + 1, hy), (hx, hy + 1)):
        if 0 <= y < H and 0 <= x < W and px[y][x] == base:
            px[y][x] = light

    look = pet.outfit(now)
    if sp == "sprout" and not look["head"] and mood != "fainted":
        lean = 0 if asleep else rnd(math.sin(frame / FPS * 2 * math.pi / 2.6) * 0.8)
        stamp(BITS["sprout"], 14 + lean, head - 5)
    if sp == "cactus":
        for dx, dy in ((-0.62, -0.55), (0.6, -0.6), (-0.8, 0.15), (0.8, 0.1), (-0.5, 0.75), (0.55, 0.72), (0.0, -0.86)):
            x, y = rnd(cx + dx * rx), rnd(cy + dy * ry)       # spines
            if 0 <= y < H and 0 <= x < W and mask[y][x] and px[y][x] != edge:
                px[y][x] = edge
        if not look["head"] and mood != "fainted":
            stamp(BITS["flower"], 16, head - 4)
    if sp == "robot" and not look["head"] and mood != "fainted":
        for k in range(1, 4):                                  # an antenna with a light on top
            put(cx + 0.5, head - k, PAL["E"])
        for dx, dy in ((0, 0), (1, 0), (0, -1), (1, -1)):
            put(cx + dx, head - 4 + dy, PAL["r"] if frame % 10 < 6 else PAL["R"])

    # ── face ──
    xc = int(cx)                     # the face is centred between columns xc and xc+1
    gap = max(2, rnd(rx * 0.28))
    ey = rnd(cy - ry * 0.30)
    hungry = pet.hungry_hours(now) >= 2 and mood in ("idle", "sleeping")
    glance = 0
    if mood == "idle" and not happy:
        glance = -1 if 40 <= frame % 90 < 52 else 1 if 60 <= frame % 90 < 72 else 0
    if mood == "fainted":
        eyes = ("x", "x")
    elif mood == "sleeping":
        eyes = ("sleep", "sleep")
    elif happy or mood == "eating" and frame % 8 < 4:
        eyes = ("happy", "happy")
    elif mood == "overheating":
        eyes = ("gt", "lt")
    elif frame % 41 < 2:
        eyes = ("blink", "blink")
    elif mood == "working":
        eyes = ("set", "set")
    elif hungry:
        eyes = ("teary", "teary")
    else:
        eyes = ("open", "open")
    left, right = xc - gap - 2 + glance, xc + 1 + gap + glance
    if mood == "sleeping":           # closed eyes are wider arcs than an eye stamp allows
        for x0 in (left - 1, right):
            for dx, dy in ((0, 2), (1, 3), (2, 3), (3, 2)):
                put(x0 + dx, ey + dy, EYE)
    else:
        stamp(EYES[eyes[0]], left, ey)
        stamp(EYES[eyes[1]], right, ey)
    if pet.sweating and mood not in ("overheating", "fainted", "sleeping"):
        for x, y in ((left, ey - 1), (left + 1, ey - 2), (right + 2, ey - 1), (right + 1, ey - 2)):   # worried brows
            put(x, y, EYE)
    if mood not in ("fainted", "overheating"):
        wide = 1 if happy or mood == "eating" else 0
        for x in list(range(left - 1 - wide, left + 1)) + list(range(right + 2, right + 4 + wide)):
            if mask[ey + 4][x] and px[ey + 4][x] != edge:
                px[ey + 4][x] = pink
    my = ey + 4
    if sp not in ("sprout", "duck", "robot", "ghost") and mood != "fainted":
        put(xc, my - 1, NOSE)
        put(xc + 1, my - 1, NOSE)
    if mood == "fainted":
        mouth = "out"
    elif mood == "overheating":
        mouth = "wavy"
    elif mood == "eating":
        mouth = "open" if beat else "smile"
    elif happy:
        mouth = "open"
    elif mood == "working":
        mouth = "grit"
    elif mood == "sleeping" or pet.stuffed:
        mouth = "flat"
    elif hungry:
        mouth = "frown"
    else:
        mouth = "smile"
    if sp == "duck" and mood != "fainted":       # a bill instead of a mouth; it opens to eat
        stamp(["OOOO", "MTTM", "OOOO"] if mouth == "open" else ["OOOO", "OOOO", ".OO."], xc - 1, my - 1)
    else:
        stamp(MOUTHS[mouth], xc - 1, my)

    # ── things it wears ──
    if look["band"]:
        for dy, color in ((-3, PAL["r"]), (-2, PAL["R"])):
            for x in range(W):
                if mask[ey + dy][x] and px[ey + dy][x] != edge and in_body(x, ey + dy):
                    px[ey + dy][x] = color
    if look["face"] == "glasses":
        for x0 in (left, right):
            for x in range(x0 - 1, x0 + 4):
                for y in range(ey - 1, ey + 5):
                    rim = x in (x0 - 1, x0 + 3) or y in (ey - 1, ey + 4)
                    corner = x in (x0 - 1, x0 + 3) and y in (ey - 1, ey + 4)
                    if rim and not corner:
                        put(x, y, PAL["k"])
        for x in list(range(left + 4, right - 1)) + list(range(rnd(cx - rx) + 1, left - 1)) + list(range(right + 4, rnd(cx + rx))):
            put(x, ey + 1, PAL["k"])
    elif look["face"] == "shades":
        for x0 in (left, right):
            for x in range(x0 - 1, x0 + 4):
                for y in range(ey, ey + 4):
                    put(x, y, PAL["k"])
            put(x0, ey + 1, WHITE)
        for x in range(rnd(cx - rx) + 1, rnd(cx + rx)):
            put(x, ey, PAL["k"])
    if look["deco"] == "bow":
        stamp(BITS["bow"], rnd(cx - rx * 0.30) - 6 if look["head"] else rnd(cx + rx * 0.30), head - 3)
    elif look["deco"] == "flower":
        stamp(BITS["flower"], rnd(cx - rx * 0.30) - 5, head - 3)
    elif look["deco"] == "bandage":
        stamp(BITS["bandage"], rnd(cx - rx * 0.55), head + 1, clip=True)
    hat = look["head"]
    if hat == "headphones":
        for x in range(rnd(cx - rx * 0.86), rnd(cx + rx * 0.86) + 1):
            y = next((y for y in range(H) if in_body(x, y)), None)
            if y is not None:
                put(x, y - 1, PAL["E"])
                put(x, y, PAL["k"])
        for side in (-1, 1):
            for x, y in oval(cx + side * (rx + 0.4), ey + 1.5, 2.2, 3.2):
                put(x, y, PAL["r"])
            for x, y in oval(cx + side * (rx + 0.4), ey + 1.5, 1.0, 1.8):
                put(x, y, PAL["R"])
    elif hat:
        if hat == "propeller" and frame % (2 if g.util > 20 else 6) < (1 if g.util > 20 else 3):
            hat = "propeller2"
        rows = HATS[hat]
        stamp(rows, 18 - len(rows[0]) // 2, head + 2 - len(rows))

    # ── things that move around it ──
    mouth_at = (cx, my + 1)
    if mood in ("eating", "overheating") and pet.rate > 1:
        want = min(3.0, pet.rate / 30)
        for _ in range(int(want) + (random.random() < want % 1)):
            side = random.choice((-1, 1))
            pet.particles.append([cx + side * (W / 2 + 1), mouth_at[1] + random.uniform(-7, 3), random.choice(CANDY)])
    flying = []
    for p in pet.particles:
        dx, dy = mouth_at[0] - p[0], mouth_at[1] - p[1]
        dist = math.hypot(dx, dy)
        if dist > 2.6:
            p[0] += dx / dist * 2.6
            p[1] += dy / dist * 2.6
            flying.append(p)
            for ox, oy in ((0, 0), (1, 0), (0, 1), (1, 1)):
                put(p[0] + ox, p[1] + oy, p[2])
    pet.particles = flying
    pet.drops = [[x + vx, y + 1, vx, life - 1] for x, y, vx, life in pet.drops if life > 1]
    if pet.sweating and mood != "fainted":
        if frame % 5 == 0:
            side = random.choice((-1, 1))
            pet.drops.append([cx + side * (rx - 1), top + 2, side * 0.5, 7])
        for x, y, _, _ in pet.drops:
            put(x, y, SWEAT)
            put(x, y - 1, SWEAT)
    if mood == "overheating":
        for x in range(rnd(cx - rx * 0.7), rnd(cx + rx * 0.7) + 1):
            tall = rnd(2.2 + 1.8 * math.sin(x * 1.3 + frame * 0.9) + random.random())
            for k in range(max(0, tall)):
                put(x, head - 1 - k, ((255, 232, 96), (255, 160, 20), (255, 84, 20), (236, 56, 30))[min(3, k * 4 // max(1, tall))])
    if mood == "sleeping":
        step = frame // 6 % 4
        if step >= 1:
            stamp(BITS["z"], min(W - 10, rnd(cx + rx) - 1), head - 3)
        if step >= 2:
            stamp(BITS["Z"], min(W - 5, rnd(cx + rx) + 3), head - 9)
    if mood == "fainted":
        stamp(BITS["ghost"], 16 + rnd(math.sin(frame / FPS * 1.6) * 2), head - 9 + rnd(math.sin(frame / FPS * 2.4)))
    if happy:
        rise = (now - (pet.petted_until - 2.5)) * 3
        stamp(BITS["heart"], rnd(cx - 7), rnd(head - 4 - rise))
        stamp(BITS["heart"], rnd(cx + 4), rnd(head - 2 - rise))
    spots = ((2, 6), (31, 4), (4, 20), (30, 18), (9, 1), (25, 0))
    if now < pet.sparkle_until:
        for i, (x, y) in enumerate(spots):
            if (frame // 3 + i) % 3 == 0:
                stamp(BITS["star"], x, y)
    elif (pet.shiny or pet.stage >= 4) and mood != "fainted" and frame % 12 < 4:     # a glint now and then
        stamp(BITS["star"], *spots[frame // 12 % len(spots)])
    return px
