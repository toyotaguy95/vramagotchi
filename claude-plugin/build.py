#!/usr/bin/env python3
"""The plugin pet's pictures, drawn pixel by pixel at their real size (20 x 12 pixels, six text rows).

A pet is put together from parts: a body for its stage of life, a face for its mood, something it wears,
and things floating around it. The plugin does the putting together while it runs; this file only holds
the parts. Edit the pictures, then run from the repository root:

    python3 claude-plugin/build.py                 writes the parts into the plugin
    python3 claude-plugin/build.py sheet.png       also saves a picture of every stage, mood and item
"""
import json
import struct
import sys
import zlib
from pathlib import Path

COLORS = {
    "O": (112, 58, 44), "B": (226, 136, 100), "L": (255, 238, 220), "E": (38, 30, 52), "W": (255, 255, 255),
    "P": (255, 150, 160), "M": (120, 30, 54), "T": (246, 122, 142), "y": (255, 214, 10), "c": (64, 224, 208),
    "v": (170, 130, 255), "Z": (170, 205, 255), "G": (176, 176, 190), "g": (96, 96, 112), "S": (130, 205, 255),
    "D": (176, 74, 58), "j": (110, 200, 90), "F": (255, 120, 40), "R": (226, 60, 70), "K": (60, 60, 76),
}
# Other coats: each one swaps some of the colours above.
COATS = {
    "fainted": {"B": (176, 176, 190), "O": (96, 96, 112), "L": (214, 214, 224), "P": (176, 176, 190), "D": (140, 140, 156)},
    "shiny": {"B": (112, 196, 255), "O": (40, 70, 140), "D": (70, 120, 220), "P": (255, 170, 210)},
    "legend": {"L": (255, 232, 150), "D": (255, 196, 40)},
}

# Bodies, youngest first. The face goes in the four rows starting at "face", columns 3 to 16.
BODIES = {
    "baby": {"face": 5, "lift": 1, "art": """
....................
....................
.........O..........
....OOOOOOOOOOOO....
...OBBBBBBBBBBBBO...
..OBBBBBBBBBBBBBBO..
..OBBBBBBBBBBBBBBO..
..OBBBBBBBBBBBBBBO..
..OBBBBBBBBBBBBBBO..
...OBBLLLLLLLLBBO...
....OOOOOOOOOOOO....
....................
"""},
    "kid": {"face": 4, "lift": 0, "art": """
....OO........OO....
...OBBO......OBBO...
...OBBBOOOOOOBBBO...
..OBBBBBBBBBBBBBBO..
..OBBBBBBBBBBBBBBO..
..OBBBBBBBBBBBBBBO..
..OBBBBBBBBBBBBBBO..
..OBBBBBBBBBBBBBBO..
..OBBBLLLLLLLLBBBO..
...OBBLLLLLLLLBBO...
...OOBBBBBBBBBBOO...
....OO.OOOOOO.OO....
"""},
    "teen": {"face": 4, "lift": 0, "art": """
..O..............O..
..OBO..........OBO..
..OBBOOOOOOOOOOBBO..
..OBBBBBBBBBBBBBBO..
..OBBBBBBBBBBBBBBO..
..OBBBBBBBBBBBBBBO.L
..OBBBBBBBBBBBBBBO.O
..OBBBBBBBBBBBBBBO.O
..OBBBLLLLLLLLBBBO.O
...OBBLLLLLLLLBBOOO.
...OOBBBBBBBBBBOO...
....OO.OOOOOO.OO....
"""},
    "adult": {"face": 4, "lift": 0, "art": """
...L............L...
...LL..........LL...
...OLOOOOOOOOOOLO...
D.OBBBBBBBBBBBBBBO.D
DDOBBBBBBBBBBBBBBODD
DDOBBBBBBBBBBBBBBODD
.DOBBBBBBBBBBBBBBOD.
..OBBBBBBBBBBBBBBO..
..OBBBLLLLLLLLBBBO.D
...OBBLLLLLLLLBBOOD.
...OOBBBBBBBBBBOO...
....OO.OOOOOO.OO....
"""},
}
BODIES["legend"] = dict(BODIES["adult"], coat="legend")

FACES = {
    "open": """
BBWWEBBBBWWEBB
BBWEEBBBBWEEBB
BPEEEBMMBEEEPB
""",
    "blink": """
BBBBBBBBBBBBBB
BBEEEBBBBEEEBB
BPBBBBMMBBBBPB
""",
    "happy": """
BBBEBBBBBBEBBB
BBEBEBBBBEBEBB
BPBBBMMMMBBBPB
BBBBBMTTMBBBBB
""",
    "chew": """
BBWWEBBBBWWEBB
BBWEEBBBBWEEBB
BPEEEMMMMEEEPB
""",
    "asleep": """
BBBBBBBBBBBBBB
BBEBEBBBBEBEBB
BPBEBBMMBBEBPB
""",
    "full": """
BBWWEBBBBWWEBB
BBWEEBBBBWEEBB
BPEEEMMMMEEEPB
BBLLLLLLLLLLBB
""",
    "out": """
BBEBEBBBBEBEBB
BBBEBBBBBBEBBB
BBEBEBMMBEBEBB
BBBBBBTTBBBBBB
""",
}

# Things floating around the pet. Drawn over everything, never moved.
FLOATS = {
    "tokensA": """
....................
....................
....................
....................
y..................c
....................
.c................v.
....................
v..................y
""",
    "tokensB": """
....................
....................
....................
....................
...................v
c...................
..................y.
.y..................
..................c.
""",
    "zzzA": """
.................ZZZ
..................Z.
.................ZZZ
""",
    "zzzB": """
....................
..................ZZ
..................ZZ
""",
    "sweat": """
....................
....................
....................
...................S
...................S
""",
    "sparkA": """
y..................W
....................
....................
....................
....................
....................
....................
....................
....................
....................
....................
W..................y
""",
    "sparkB": """
....................
.W................y.
....................
....................
....................
....................
....................
....................
....................
....................
.y................W.
""",
    "heartsA": """
R.R..............R.R
RRR..............RRR
.R................R.
""",
    "heartsB": """
....................
R.R..............R.R
.R................R.
""",
}

# Things a pet wears, drawn for the kid's head. Smaller bodies wear them lower.
ITEMS = {
    "headphones": """
....................
.......KKKKKK.......
....................
....................
.KK..............KK.
.Kc..............cK.
.KK..............KK.
""",
    "wizard": """
.........vv.........
........vyvv........
......vvvvvvvv......
""",
    "crown": """
.......y.yy.y.......
.......yRyycy.......
""",
    "tophat": """
........KKKK........
........RRRR........
......KKKKKKKK......
""",
    "bandage": """
....................
....................
....................
...........WWW......
...........WRW......
""",
    "sweatband": """
....................
....................
....................
...RRRRRRWWRRRRR....
""",
    "bow": """
............R...R...
............RRyRR...
............R...R...
""",
    "flower": """
....P...............
...PyP..............
....P...............
""",
    "sprout": """
........jj.j........
.........jj.........
.........j..........
""",
    "propeller": """
......cccKRRR.......
........yyyy........
.......RRRRRR.......
""",
    "halo": """
.......yyyyyy.......
....................
""",
    "flame": """
..........F.........
.........FyF........
........FFyFF.......
""",
    "star": """
.........yy.........
.......yyWWyy.......
.........yy.........
""",
    # Not something to collect: only the pet in first place on the leaderboard wears it.
    "champion": """
......y..yy..y......
......yy.yy.yy......
......yRyccyRy......
""",
}

EGG = """
....................
.........OO.........
.......OOLLOO.......
......OLLLLLLO......
.....OLLBBLLLLO.....
.....OLLBBLLLBO.....
....OLLLLLLLLLLO....
....OLLLLLBBLLLO....
....OLLBLLBBLLLO....
....OLLLLLLLLLLO....
.....OLLLLLLLLO.....
......OOOOOOOO......
"""
CRACKED = """
....................
.........OO.........
.......OOLLOO.......
......OLLLLLLO......
.....OLLBBLLLLO.....
.....OLOBLLOLBO.....
....OOLOLOOLOLOO....
....OLLOLLBBOLLO....
....OLLBLLBBLLLO....
....OLLLLLLLLLLO....
.....OLLLLLLLLO.....
......OOOOOOOO......
"""

STAGES = ("baby", "kid", "teen", "adult", "legend")
WIDTH, HEIGHT = 20, 12


def rows(picture, width=WIDTH):
    out = picture.strip("\n").split("\n")
    assert all(len(r) == width for r in out), [len(r) for r in out]
    return out


def lean(picture, by):
    """The same picture pushed sideways, for an egg that rocks."""
    return [("." * by + r)[:WIDTH] if by > 0 else (r[-by:] + "." * -by) for r in rows(picture)]


def parts():
    return {
        "colors": COLORS,
        "coats": COATS,
        "bodies": {name: {"face": b["face"], "lift": b["lift"], "coat": b.get("coat"), "art": rows(b["art"])} for name, b in BODIES.items()},
        "faces": {name: rows(p, 14) for name, p in FACES.items()},
        "floats": {name: rows(p) for name, p in FLOATS.items()},
        "items": {name: rows(p) for name, p in ITEMS.items()},
        "egg": [rows(EGG), lean(EGG, 1), rows(EGG), lean(EGG, -1)],
        "cracked": [rows(CRACKED), lean(CRACKED, 1), rows(CRACKED), lean(CRACKED, -1)],
    }


def compose(art, stage, face, item=None, floats=(), coats=()):
    """The same steps the plugin takes, kept here so the sheet shows what the plugin will draw."""
    body = art["bodies"][stage]
    px = [list(r) for r in body["art"]]
    for dy, line in enumerate(art["faces"][face]):
        px[body["face"] + dy][3:17] = line
    for name in ([item] if item else []):
        for y, line in enumerate(art["items"][name]):
            for x, ch in enumerate(line):
                if ch != "." and y + body["lift"] < HEIGHT:
                    px[y + body["lift"]][x] = ch
    for name in floats:
        for y, line in enumerate(art["floats"][name]):
            for x, ch in enumerate(line):
                if ch != ".":
                    px[y][x] = ch
    palette = dict(art["colors"])
    for coat in [body["coat"], *coats]:
        palette.update(art["coats"].get(coat) or {})
    return [[palette.get(ch) for ch in r] for r in px]


def png(path, tiles, across, zoom=8, gap=2):
    down = -(-len(tiles) // across)
    w, h = across * (WIDTH + gap) * zoom, down * (HEIGHT + gap) * zoom
    back = (24, 24, 30)
    canvas = [[back] * w for _ in range(h)]
    for i, tile in enumerate(tiles):
        ox, oy = (i % across) * (WIDTH + gap) * zoom + zoom, (i // across) * (HEIGHT + gap) * zoom + zoom
        for y, row in enumerate(tile):
            for x, c in enumerate(row):
                if c:
                    for yy in range(zoom):
                        canvas[oy + y * zoom + yy][ox + x * zoom:ox + (x + 1) * zoom] = [tuple(c)] * zoom
    raw = b"".join(b"\0" + bytes(v for px in row for v in px) for row in canvas)
    chunk = lambda kind, data: struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    Path(path).write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
                           + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def sheet(art, path):
    plain = lambda picture: [[art["colors"].get(ch) for ch in r] for r in picture]
    tiles = [plain(art["egg"][0]), plain(art["egg"][1]), plain(art["cracked"][0]), plain(art["cracked"][3]),
             compose(art, "kid", "open", coats=["shiny"]), compose(art, "adult", "open", coats=["shiny"]), [], []]
    for stage in STAGES:
        tiles += [compose(art, stage, "open"), compose(art, stage, "blink"), compose(art, stage, "happy", floats=["tokensA"]),
                  compose(art, stage, "asleep", floats=["zzzA"]), compose(art, stage, "full", floats=["sweat"]),
                  compose(art, stage, "out", coats=["fainted"]), compose(art, stage, "happy", floats=["sparkA", "sparkB"]),
                  compose(art, stage, "happy", floats=["heartsA"])]
    names = list(art["items"])
    tiles += [compose(art, "kid", "open", item=n) for n in names]
    tiles += [[]] * (-len(tiles) % 8)
    tiles += [compose(art, "baby", "open", item=n) for n in names]
    tiles += [[]] * (-len(tiles) % 8)
    tiles += [compose(art, "adult", "open", item=n) for n in names]
    png(path, tiles, 8)


if __name__ == "__main__":
    art = parts()
    here = Path(__file__).resolve().parent
    # The plugin draws the pets, and so does the leaderboard's web page: both get the same parts.
    for target, declare in ((here / "vramagotchi" / "hooks" / "register.tsx", "const ART: Art = "),
                            (here.parent / "leaderboard" / "web" / "index.html", "const ART = ")):
        source = target.read_text()
        start, end = source.index("// ART-START"), source.index("// ART-END")
        target.write_text(source[:start] + "// ART-START (written by claude-plugin/build.py)\n" + declare + json.dumps(art) + "\n" + source[end:])
    print("parts written:", {k: len(v) for k, v in art.items()})
    if len(sys.argv) > 1:
        sheet(art, sys.argv[1])
        print("sheet saved:", sys.argv[1])
