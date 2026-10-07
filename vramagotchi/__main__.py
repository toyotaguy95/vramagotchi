"""Command line entry point:  python3 -m vramagotchi"""

import argparse
import os
import shutil
import signal
import sys
import time

from . import term
from .art import FPS, H, W
from .sources import AppleSilicon, ClaudeCode, Demo, NvidiaSmi, find_llm
from .world import World


def snapshot(world, png, advance, frames=60):
    """Run a few seconds without a terminal, then print one frame (and optionally save the sprites as an image)."""
    pets, now = [], time.time()
    for frame in range(frames):
        if advance:
            advance()
        world.sample_once()
        pets = world.frame(now + frame / FPS)
    size = shutil.get_terminal_size((100, 44))
    out = term.render(world, pets, size.columns, size.lines)
    print(out.replace("\x1b[?2026h\x1b[H", "").replace("\x1b[J\x1b[?2026l", ""))
    if png:
        from PIL import Image
        zoom, gap = 10, 2
        img = Image.new("RGB", ((W + gap) * len(pets) * zoom, H * zoom), (24, 24, 30))
        for i, pet in enumerate(pets):
            for y, row in enumerate(pet.px):
                for x, c in enumerate(row):
                    if c:
                        img.paste(c, ((i * (W + gap) + x) * zoom, y * zoom, (i * (W + gap) + x + 1) * zoom, (y + 1) * zoom))
        img.save(png)


def main():
    ap = argparse.ArgumentParser(prog="vramagotchi", description="A pet that lives on your GPU.")
    ap.add_argument("--demo", action="store_true", help="simulated cards, no GPU needed")
    ap.add_argument("--llm", action="append", metavar="URL", help="llama.cpp server to count tokens from (default: look on localhost:8080 and :8000)")
    ap.add_argument("--web", nargs="?", const=8377, type=int, metavar="PORT", help="also show the pets on a web page (default port 8377)")
    ap.add_argument("--host", default="127.0.0.1", help="address the web page listens on (default: this machine only)")
    ap.add_argument("--serve", action="store_true", help="no terminal view: just run the web page and/or cooler screen")
    ap.add_argument("--lcd", action="store_true", help="show a pet on an NZXT Kraken Z cooler screen (needs liquidctl and Pillow)")
    ap.add_argument("--lcd-pet", type=int, metavar="N", help="which card's pet goes on the cooler screen (default: the one running your model)")
    ap.add_argument("--lcd-remove", action="store_true", help="take the pet off the cooler screen and exit")
    ap.add_argument("--no-claude", action="store_true", help="don't offer a pet for Claude Code")
    ap.add_argument("--256", dest="low_color", action="store_true", help="use 256 colors if your terminal shows garbage")
    ap.add_argument("--snapshot", action="store_true", help="print one frame and exit")
    ap.add_argument("--at", type=float, help=argparse.SUPPRESS)      # demo clock position, for snapshots
    ap.add_argument("--wear", help=argparse.SUPPRESS)                # comma-separated items for snapshots
    ap.add_argument("--species", help=argparse.SUPPRESS)             # comma-separated species for snapshots
    ap.add_argument("--png", help=argparse.SUPPRESS)                 # save the sprites as an image (needs Pillow)
    args = ap.parse_args()
    term.TRUECOLOR = not args.low_color

    if args.lcd_remove:
        from . import lcd
        sys.exit(lcd.remove())

    advance = None
    if args.demo:
        if args.at is not None:
            virtual = [args.at - 6.0]
            source = Demo(lambda: virtual[0])
            advance = lambda: virtual.__setitem__(0, virtual[0] + 1 / FPS)
        else:
            t0 = time.time()
            source = Demo(lambda: time.time() - t0)
        world = World(source, persist=False)
    else:
        if shutil.which("nvidia-smi"):
            source = NvidiaSmi()
        elif sys.platform == "darwin":
            source = AppleSilicon()
        else:
            sys.exit("No supported GPU found (NVIDIA or a Mac). Try:  python3 -m vramagotchi --demo")
        urls = args.llm or [os.environ.get("VRAMAGOTCHI_LLM") or "http://127.0.0.1:8080", "http://127.0.0.1:8000"]
        claude = ClaudeCode()
        world = World(source, find_llm(urls), persist=not (args.snapshot or args.png), urls=urls,
                      extras=[claude] if claude.available() and not args.no_claude else [])

    if args.snapshot or args.png:
        if args.wear or args.species:
            world.sample_once()
            pets = world.frame()
            for pet, item in zip(pets, (args.wear or "").split(",") if args.wear else []):
                pet.unlocked, pet.wearing = list(pet.unlocked) + [item], item or None
            for pet, kind in zip(pets, (args.species or "").split(",") if args.species else []):
                pet.species = kind
        return snapshot(world, args.png, advance)

    if args.web:
        from . import web
        url = web.start(world, args.host, args.web)
        world.note = url
    screen = None
    if args.lcd:
        from . import lcd
        screen = lcd.start(world, args.lcd_pet)
    if args.serve:
        if not (args.web or args.lcd):
            sys.exit("--serve needs --web and/or --lcd")
        world.start()
        signal.signal(signal.SIGTERM, lambda *_: world.stop.set())      # stop cleanly when run as a service
        print(f"VRAMagotchi running{' at ' + world.note if args.web else ''}. Ctrl-C to stop.", flush=True)
        try:
            world.run()
        except KeyboardInterrupt:
            pass
        finally:
            world.stop.set()
            world.save()
    elif term.termios is None or not sys.stdin.isatty():
        sys.exit("VRAMagotchi needs an interactive terminal (Linux, macOS or WSL). Use --snapshot, or --serve with --web.")
    else:
        term.interactive(world)
    if screen:
        screen.join(timeout=8)       # let it tuck the pet in on the cooler before leaving


if __name__ == "__main__":
    main()
