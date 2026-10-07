"""The terminal view: pixels as half-block characters, plus the keyboard."""

import math
import os
import re
import select
import shutil
import signal
import sys
import textwrap
import time

from .art import FPS, H, W
from .util import age, clamp, human

try:
    import termios
    import tty
except ImportError:          # native Windows
    termios = tty = None

RESET, BOLD, DIM = "\x1b[0m", "\x1b[1m", "\x1b[2m"
ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
TRUECOLOR = True


def to256(c):
    r, g, b = (round(v / 255 * 5) for v in c)
    return 16 + 36 * r + 6 * g + b


def fg(c):
    return f"\x1b[38;2;{c[0]};{c[1]};{c[2]}m" if TRUECOLOR else f"\x1b[38;5;{to256(c)}m"


def bg(c):
    return f"\x1b[48;2;{c[0]};{c[1]};{c[2]}m" if TRUECOLOR else f"\x1b[48;5;{to256(c)}m"


def vlen(s):
    return len(ANSI.sub("", s))


def center(s, width):
    extra = max(0, width - vlen(s))
    return " " * (extra // 2) + s + " " * (extra - extra // 2)


def bubble(text, width, tall):
    """A speech bubble `tall` rows high (3 or 4), blank when there is nothing to say."""
    if not text:
        return [" " * width] * tall
    lines = textwrap.wrap(text, width - 4)
    if len(lines) > tall - 2:
        lines = lines[:tall - 2]
        lines[-1] = lines[-1][:width - 5] + "…"
    box = max(len(line) for line in lines) + 4
    mid = (box - 2) // 2
    out = [DIM + "╭" + "─" * (box - 2) + "╮" + RESET]
    out += [DIM + "│ " + RESET + line.ljust(box - 4) + DIM + " │" + RESET for line in lines]
    out.append(DIM + "╰" + "─" * mid + "┬" + "─" * (box - 3 - mid) + "╯" + RESET)
    return [center(line, width) for line in [""] * (tall - len(out)) + out]


def level(value, warn, bad):
    return (240, 80, 70) if value >= bad else (245, 200, 60) if value >= warn else (120, 200, 90)


def clip(line, width):
    """Cut a line to `width` visible columns without breaking colour codes."""
    out, seen, i = [], 0, 0
    while i < len(line) and seen < width:
        m = ANSI.match(line, i)
        if m:
            out.append(m.group())
            i = m.end()
        else:
            out.append(line[i])
            seen, i = seen + 1, i + 1
    return "".join(out) + RESET


SCALES = (3, 2, 1, 0.5)        # whole-number steps only, so pixels always stay square and lined up


def scaled(px, k):
    """The pixel grid at scale k: blown up for big windows, or halved for small ones."""
    if k >= 1:
        k = int(k)
        return [[c for c in row for _ in range(k)] for row in px for _ in range(k)]
    out = []
    for y in range(0, H - 1, 2):
        line = []
        for x in range(0, W - 1, 2):
            cell = [c for c in (px[y][x], px[y][x + 1], px[y + 1][x], px[y + 1][x + 1]) if c is not None]
            # keep the block if at least half of it is filled; the most common colour wins, darker on a tie
            line.append(max(set(cell), key=lambda c: (cell.count(c), -sum(c))) if len(cell) >= 2 else None)
        out.append(line)
    return out


def art_rows(k):
    return math.ceil(H * k / 2)


def sprite(pet, k):
    grid = scaled(pet.still if k < 1 and pet.still else pet.px, k)
    if len(grid) % 2:
        grid.append([None] * len(grid[0]))
    out = []
    for y in range(0, len(grid), 2):
        cells = []
        for up, down in zip(grid[y], grid[y + 1]):
            if up is None and down is None:
                cells.append(RESET + " ")
            elif down is None:
                cells.append(RESET + fg(up) + "▀")
            elif up is None:
                cells.append(RESET + fg(down) + "▄")
            else:
                cells.append(fg(up) + bg(down) + "▀")
        out.append("".join(cells) + RESET)
    return out


def block(pet, k, width, rows, chosen):
    """One pet's column in at most `rows` lines. The pet is never cropped; text drops away first."""
    g, now = pet.gpu, time.time()
    filled = round(clamp(pet.pct) * 12)
    bar = fg(level(pet.pct * 100, 70, 90)) + "█" * filled + RESET + DIM + "░" * (12 - filled) + RESET
    vitals = f"{fg(level(g.temp, 70, 82))}{g.temp:.0f}°C{RESET}  {g.power:.0f}W  {g.util:.0f}%" if g.temp else f"{g.util:.0f}% busy"
    if g.kind == "claude":
        vitals = "writing" if g.util else "quiet"
    if pet.rate > 1:
        vitals += f"  {fg((255, 214, 10))}{'~' if pet.approx else ''}{pet.rate:.0f} tok/s{RESET}"
    mark = f"{fg((255, 214, 10))}▸{RESET} " if chosen else ""
    name = f"{mark}{BOLD}{'✦ ' if pet.shiny else ''}{pet.name}{RESET} · {pet.stage_name} · {g.name} · {age(now - pet.born)}"
    if pet.egg:
        name = f"{mark}{BOLD}???{RESET} · {g.name}"
    if vlen(name) > width:
        name = f"{mark}{BOLD}{'???' if pet.egg else pet.name}{RESET}" + ("" if pet.egg else f" · {pet.stage_name}")
    info = [                                           # most important first
        name,
        pet.label(),
        f"CTX  {bar} {g.mem_used / 1000:.0f}k/{g.mem_total / 1000:.0f}k" if g.kind == "claude" else
        f"{'VRAM' if g.temp else 'MEM '} {bar} {g.mem_used / 1024:.1f}/{g.mem_total / 1024:.0f}G",
        vitals,
        f"{DIM}ate {'~' if pet.approx else ''}{human(pet.tokens_today)} tokens today · {human(pet.tokens_total)} ever · {pet.growth()}{RESET}",
    ]
    # The number of lines depends only on the window size, never on what the pet is doing,
    # so nothing shifts when a speech bubble or a longer status comes and goes.
    want_info = max(1, min(len(info), rows - art_rows(k)))
    spare = rows - want_info - art_rows(k)
    say = 4 if spare >= 4 else 3 if spare >= 3 else 0
    lines = bubble(pet.line, width, say) if say and width >= 20 else []
    lines += [center(row, width) for row in sprite(pet, k)]
    lines += [center(clip(text, width), width) for text in info[:want_info]]
    return [clip(line, width) for line in lines]


def render(world, pets, cols, rows):
    if not pets:
        return "\x1b[H" + clip(center("looking for GPUs...", cols), cols) + "\x1b[J"
    footer = 1 if rows >= 10 else 0
    body = rows - footer

    def across(k):                                     # how many pets fit side by side at this scale
        width = min(cols, max(int(W * k), 36 if k >= 1 else 22))
        return width, (cols + 2) // (width + 2) if cols >= W * k and body >= art_rows(k) + 1 else 0

    k = next((k for k in SCALES if across(k)[1] >= len(pets)), None) or next((k for k in SCALES if across(k)[1] >= 1), None)
    if k is None:                                      # too small for a picture: one line per pet
        lines = [clip(f"{p.name}: {p.label()}" + (f" {p.rate:.0f} tok/s" if p.rate > 1 else ""), cols) for p in pets][:rows]
        return "\x1b[?2026h\x1b[H" + "\n".join(line + "\x1b[K" for line in lines) + "\x1b[J\x1b[?2026l"
    width, fit = across(k)
    fit = min(fit, len(pets))
    title = 1 if body >= art_rows(k) + 10 else 0
    first = min(max(0, world.selected - fit + 1), len(pets) - fit)   # keep the chosen pet in view
    shown = pets[first:first + fit]
    blocks = [block(p, k, width, body - title, len(pets) > 1 and first + i == world.selected) for i, p in enumerate(shown)]
    tallest = max(len(b) for b in blocks)
    blocks = [[" " * width] * (tallest - len(b)) + b for b in blocks]
    pad = " " * max(0, (cols - (fit * width + (fit - 1) * 2)) // 2)
    lines = [center(f"{BOLD}VRAMagotchi{RESET}{DIM}  a pet that lives on your GPU{RESET}", cols)] if title else []
    lines += [pad + "  ".join(b[i] for b in blocks) for i in range(tallest)]
    if footer:
        keys = "[f] feed  [p] pet  [a] dress up  " + ("[tab] next pet  " if len(pets) > 1 else "") + "[q] quit"
        if world.waiting:
            keys = f"[n] hatch a pet for {'Claude Code' if world.waiting[0].kind == 'claude' else 'another GPU'}  " + keys
        if any(p.egg and not p.hatch_start for p in pets):
            keys = "[h] hatch your egg   [q] quit"
        elif fit < len(pets):
            keys = f"[tab] next pet ({world.selected + 1}/{len(pets)})  [f] feed  [p] pet  [a] dress up  [q] quit"
        if vlen(keys) > cols:
            keys = ("h hatch · q quit" if "hatch your egg" in keys else "f feed · p pet · a dress · q quit") if cols >= 34 else "q quit"
        lines.append(center(f"{DIM}{keys}  {world.note}{RESET}" if vlen(keys) + len(world.note) + 2 <= cols else f"{DIM}{keys}{RESET}", cols))
    lines = [clip(line, cols) for line in lines[:rows]]
    return "\x1b[?2026h\x1b[H" + "\n".join(line + "\x1b[K" for line in lines) + "\x1b[J\x1b[?2026l"


def interactive(world):
    fd = sys.stdin.fileno()
    old = termios.tcgetattr(fd)
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    if hasattr(signal, "SIGWINCH"):
        signal.signal(signal.SIGWINCH, lambda *_: None)    # wakes the loop so a resize redraws at once
    world.start()
    try:
        tty.setcbreak(fd)
        sys.stdout.write("\x1b[?1049h\x1b[?25l\x1b[?7l")     # own screen, no cursor, no line wrapping
        last_size = None
        while True:
            started = time.time()
            size = shutil.get_terminal_size((80, 24))
            if size != last_size:                          # window resized: wipe leftovers before redrawing
                sys.stdout.write("\x1b[0m\x1b[2J")
                last_size = size
            sys.stdout.write(render(world, world.frame(), size.columns, size.lines))
            sys.stdout.flush()
            wait = max(0.0, 1 / FPS - (time.time() - started))
            if select.select([sys.stdin], [], [], wait)[0]:
                key = os.read(fd, 32).decode(errors="ignore").lower()
                if "q" in key or key == "\x1b":
                    break
                if "\t" in key and world.view:
                    world.selected = (world.selected + 1) % len(world.view)
                if "h" in key:
                    world.crack()
                if "n" in key:
                    world.hatch()
                if "f" in key:
                    world.feed()
                if "p" in key:
                    world.stroke()
                if "a" in key:
                    world.dress()
    except KeyboardInterrupt:
        pass
    finally:
        world.stop.set()
        termios.tcsetattr(fd, termios.TCSADRAIN, old)
        sys.stdout.write("\x1b[?7h\x1b[?25h\x1b[?1049l")
        sys.stdout.flush()
        world.save()
