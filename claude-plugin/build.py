#!/usr/bin/env python3
"""Turns the hand-drawn pet below into the plugin's frames.

The strip above the prompt is small, so this pet is drawn pixel by pixel at its real size
(20 x 12 pixels, six text rows) instead of being shrunk from the big one. Edit the pictures,
then run from the repository root:  python3 claude-plugin/build.py
"""
import base64
import json
import struct
from pathlib import Path

COLORS = {
    "O": (112, 58, 44), "B": (226, 136, 100), "L": (255, 238, 220), "E": (38, 30, 52), "W": (255, 255, 255),
    "P": (255, 150, 160), "M": (120, 30, 54), "T": (246, 122, 142), "y": (255, 214, 10), "c": (64, 224, 208),
    "v": (170, 130, 255), "Z": (170, 205, 255), "G": (176, 176, 190), "g": (96, 96, 112), "S": (130, 205, 255),
}

OPEN = """
....OO........OO....
...OBBO......OBBO...
...OBBBOOOOOOBBBO...
..OBBBBBBBBBBBBBBO..
..OBBWWEBBBBWWEBBO..
..OBBWEEBBBBWEEBBO..
..OBPEEEBMMBEEEPBO..
..OBBBBBLLLLBBBBBO..
..OBBBLLLLLLLLBBBO..
...OBBLLLLLLLLBBO...
...OOBBBBBBBBBBOO...
....OO.OOOOOO.OO....
"""
BLINK = OPEN.replace("..OBBWWEBBBBWWEBBO..", "..OBBBBBBBBBBBBBBO..").replace("..OBBWEEBBBBWEEBBO..", "..OBBEEEBBBBEEEBBO..").replace("..OBPEEEBMMBEEEPBO..", "..OBPBBBBMMBBBBPBO..")
CHEW_A = """
....OO........OO....
...OBBO......OBBO...
...OBBBOOOOOOBBBO...
..OBBBBBBBBBBBBBBO..
y.OBBBEBBBBBBEBBBO.c
..OBBEBEBBBBEBEBBO..
.cOBPBBBMMMMBBBPBOv.
..OBBBBBMTTMBBBBBO..
v.OBBBLLLLLLLLBBBO.y
...OBBLLLLLLLLBBO...
...OOBBBBBBBBBBOO...
....OO.OOOOOO.OO....
"""
CHEW_B = """
....OO........OO....
...OBBO......OBBO...
...OBBBOOOOOOBBBO...
..OBBBBBBBBBBBBBBO..
..OBBWWEBBBBWWEBBO.v
c.OBBWEEBBBBWEEBBO..
..OBPEEEMMMMEEEPBOy.
.yOBBBBBLLLLBBBBBO..
..OBBBLLLLLLLLBBBOc.
...OBBLLLLLLLLBBO...
...OOBBBBBBBBBBOO...
....OO.OOOOOO.OO....
"""
SLEEP_A = """
....OO........OO.ZZZ
...OBBO......OBBO.Z.
...OBBBOOOOOOBBBOZZZ
..OBBBBBBBBBBBBBBO..
..OBBBBBBBBBBBBBBO..
..OBBEBEBBBBEBEBBO..
..OBPBEBBMMBBEBPBO..
..OBBBBBLLLLBBBBBO..
..OBBBLLLLLLLLBBBO..
...OBBLLLLLLLLBBO...
...OOBBBBBBBBBBOO...
....OOOOOOOOOOOO....
"""
SLEEP_B = SLEEP_A.replace("....OO........OO.ZZZ", "....OO........OO....").replace("...OBBO......OBBO.Z.", "...OBBO......OBBO.ZZ").replace("...OBBBOOOOOOBBBOZZZ", "...OBBBOOOOOOBBBO.ZZ")
STUFFED = """
....OO........OO....
...OBBO......OBBO...
..OOBBBOOOOOOBBBOO..
.OBBBBBBBBBBBBBBBBO.
.OBBBWWEBBBBWWEBBBOS
.OBBBWEEBBBBWEEBBBO.
.OBBPEEEMMMMEEEPBBO.
.OBBBBLLLLLLLLBBBBO.
.OBBBLLLLLLLLLLBBBO.
.OBBBLLLLLLLLLLBBBO.
..OOBBBBBBBBBBBBOO..
....OO.OOOOOO.OO....
"""
FAINT = """
....................
....................
....................
....gg........gg....
...gGGgggggggGGGg...
..gGGGGGGGGGGGGGGg..
.gGGEGEGGGGGGEGEGGg.
.gGGGEGGGMMGGGEGGGg.
.gGGEGEGGLLTGEGEGGg.
.gGGGLLLLLLLLLLGGGg.
..ggGGGGGGGGGGGGgg..
....gggggggggggg....
"""
FRAMES = {
    "idle": [OPEN, OPEN, OPEN, OPEN, OPEN, BLINK],
    "eating": [CHEW_A, CHEW_B],
    "sleeping": [SLEEP_A, SLEEP_A, SLEEP_B, SLEEP_B],
    "stuffed": [STUFFED, STUFFED, STUFFED, STUFFED.replace(".OBBBBBBBBBBBBBBBBO.\n.OBBBWWEBBBBWWEBBBOS", ".OBBBBBBBBBBBBBBBBOS\n.OBBBWWEBBBBWWEBBBO.")],
    "fainted": [FAINT],
}
DEFAULT = 0x01000000


def grid(picture):
    rows = [r for r in picture.strip("\n").split("\n")]
    assert len(rows) == 12 and all(len(r) == 20 for r in rows), [len(r) for r in rows]
    return [[COLORS.get(ch) for ch in row] for row in rows]


def cells(picture):
    px, words = grid(picture), []
    rgb = lambda c: (c[0] << 16) | (c[1] << 8) | c[2]
    for y in range(0, 12, 2):
        for up, down in zip(px[y], px[y + 1]):
            if up is None and down is None:
                words += [0x20, DEFAULT, DEFAULT]
            elif down is None:
                words += [0x2580, rgb(up), DEFAULT]
            elif up is None:
                words += [0x2584, rgb(down), DEFAULT]
            else:
                words += [0x2580, rgb(up), rgb(down)]
    return base64.b64encode(struct.pack(f"<{len(words)}I", *words)).decode()


if __name__ == "__main__":
    out = {mood: [cells(p) for p in pictures] for mood, pictures in FRAMES.items()}
    target = Path(__file__).resolve().parent / "vramagotchi" / "hooks" / "register.tsx"
    source = target.read_text()
    start, end = source.index("// FRAMES-START"), source.index("// FRAMES-END")
    target.write_text(source[:start] + "// FRAMES-START (written by claude-plugin/build.py)\nconst FRAMES: Record<Mood, string[]> = "
                      + json.dumps(out, indent=2) + "\n" + source[end:])
    print("frames written:", {k: len(v) for k, v in out.items()})
