"""The terminal view: pixels as half-block characters, plus the keyboard."""

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


def sprite(pet, scale, cols, rows):
    """The pet's pixels as text, trimmed to fit: empty space goes first, then the top of the picture."""
    px = pet.px
    used = [y for y in range(H) if any(px[y])]
    top = min(used) if used else 0
    top -= top % 2                                    # keep pixel pairs aligned for half-block rows
    per_row = 2 if scale == 1 else 1
    keep = min(H - top, rows * per_row)
    start = H - keep if keep < H - top else top       # too short: lose the top, keep the feet
    start -= start % 2 if scale == 1 else 0
    wide = min(W, cols // scale)
    left = (W - wide) // 2
    part = [row[left:left + wide] for row in px[start:]]
    out = []
    if scale == 1:
        for y in range(0, len(part) - 1, 2):
            cells = []
            for up, down in zip(part[y], part[y + 1]):
                if up is None and down is None:
                    cells.append(RESET + " ")
                elif down is None:
                    cells.append(RESET + fg(up) + "▀")
                elif up is None:
                    cells.append(RESET + fg(down) + "▄")
                else:
                    cells.append(fg(up) + bg(down) + "▀")
            out.append("".join(cells) + RESET)
    else:
        for row in part:
            out.append("".join(RESET + " " * scale if c is None else bg(c) + " " * scale for c in row) + RESET)
    return out[-rows:] if rows else []


def block(pet, scale, width, rows, chosen):
    """One pet's column, using at most `rows` lines: detail drops away as the space shrinks."""
    g, now = pet.gpu, time.time()
    filled = round(clamp(pet.pct) * 12)
    bar = fg(level(pet.pct * 100, 70, 90)) + "█" * filled + RESET + DIM + "░" * (12 - filled) + RESET
    vitals = f"{fg(level(g.temp, 70, 82))}{g.temp:.0f}°C{RESET}  {g.power:.0f}W  {g.util:.0f}%" if g.temp else f"{g.util:.0f}% busy"
    if pet.rate > 1:
        vitals += f"  {fg((255, 214, 10))}{pet.rate:.0f} tok/s{RESET}"
    mark = f"{fg((255, 214, 10))}▸{RESET} " if chosen else ""
    name = f"{mark}{BOLD}{pet.name}{RESET} · {g.name} · {age(now - pet.born)}"
    if vlen(name) > width:
        name = f"{mark}{BOLD}{pet.name}{RESET}"
    info = [                                           # most important first
        name,
        pet.label(),
        f"{'VRAM' if g.temp else 'MEM '} {bar} {g.mem_used / 1024:.1f}/{g.mem_total / 1024:.0f}G",
        vitals,
        f"{DIM}ate {human(pet.tokens_today)} tokens today · {human(pet.tokens_total)} ever{RESET}",
    ]
    tall = H // 2 if scale == 1 else H                # sprite rows at full height
    used = [y for y in range(H) if any(pet.px[y])]
    need = (H - (min(used) if used else 0) + 1) // 2 if scale == 1 else H - (min(used) if used else 0)
    want_info = max(1, min(len(info), rows - need))    # the whole pet comes before extra detail
    art_rows = max(0, min(tall, rows - want_info))
    spare = rows - want_info - art_rows
    say = 4 if spare >= 4 else 3 if spare >= 3 else 0
    lines = bubble(pet.line, width, say) if say else []
    lines += [center(row, width) for row in sprite(pet, scale, width, art_rows)]
    lines += [center(clip(text, width), width) for text in info[:want_info]]
    return [clip(line, width) for line in lines]


def render(world, pets, cols, rows):
    if not pets:
        return "\x1b[H" + clip(center("looking for GPUs...", cols), cols) + "\x1b[J"
    if cols < 16 or rows < 4:                          # too small for a picture: one line per pet
        lines = [clip(f"{p.name}: {p.label()}" + (f" {p.rate:.0f} tok/s" if p.rate > 1 else ""), cols) for p in pets][:rows]
        return "\x1b[?2026h\x1b[H" + "\n".join(line + "\x1b[K" for line in lines) + "\x1b[J\x1b[?2026l"
    scale = 1
    for bigger in (2, 3):                              # grow with the window when everything still fits
        if cols >= len(pets) * (W * bigger + 2) and rows >= (H if bigger > 1 else H // 2) * (bigger - 1 if bigger > 2 else 1) + 11:
            scale = bigger
    scale = min(scale, 2)
    footer = rows >= 9
    title = rows >= (H // 2 if scale == 1 else H) + 11
    body = rows - footer - title
    width = min(cols, max(W * scale, 36))
    fit = max(1, min(len(pets), (cols + 2) // (width + 2)))
    first = min(max(0, world.selected - fit + 1), len(pets) - fit)   # keep the chosen pet in view
    shown = pets[first:first + fit]
    blocks = [block(p, scale, width, body, len(pets) > 1 and first + i == world.selected) for i, p in enumerate(shown)]
    tallest = max(len(b) for b in blocks)
    blocks = [[" " * width] * (tallest - len(b)) + b for b in blocks]
    pad = " " * max(0, (cols - (fit * width + (fit - 1) * 2)) // 2)
    lines = [center(f"{BOLD}VRAMagotchi{RESET}{DIM}  a pet that lives on your GPU{RESET}", cols)] if title else []
    lines += [pad + "  ".join(b[i] for b in blocks) for i in range(tallest)]
    if footer:
        keys = "[f] feed  [p] pet  [a] dress up  " + ("[tab] next pet  " if len(pets) > 1 else "") + "[q] quit"
        if world.waiting:
            keys = "[n] hatch a pet for another GPU  " + keys
        if fit < len(pets):
            keys = f"[tab] next pet ({world.selected + 1}/{len(pets)})  [f] feed  [p] pet  [a] dress up  [q] quit"
        if vlen(keys) > cols:
            keys = "f feed · p pet · a dress · q quit" if cols >= 34 else "q quit"
        lines.append(center(f"{DIM}{keys}  {world.note}{RESET}" if vlen(keys) + len(world.note) + 2 <= cols else f"{DIM}{keys}{RESET}", cols))
    lines = [clip(line, cols) for line in lines[:rows]]
    return "\x1b[?2026h\x1b[H" + "\n".join(line + "\x1b[K" for line in lines) + "\x1b[J\x1b[?2026l"


def interactive(world):
    fd = sys.stdin.fileno()
    old = termios.tcgetattr(fd)
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    world.start()
    try:
        tty.setcbreak(fd)
        sys.stdout.write("\x1b[?1049h\x1b[?25l")
        while True:
            started = time.time()
            size = shutil.get_terminal_size((80, 24))
            sys.stdout.write(render(world, world.frame(), size.columns, size.lines))
            sys.stdout.flush()
            wait = max(0.0, 1 / FPS - (time.time() - started))
            if select.select([sys.stdin], [], [], wait)[0]:
                key = os.read(fd, 32).decode(errors="ignore").lower()
                if "q" in key or key == "\x1b":
                    break
                if "\t" in key and world.view:
                    world.selected = (world.selected + 1) % len(world.view)
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
        sys.stdout.write("\x1b[?25h\x1b[?1049l")
        sys.stdout.flush()
        world.save()
