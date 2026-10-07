"""Puts a pet on an NZXT Kraken Z cooler screen (320x320, round) using liquidctl.

That screen cannot be streamed to: it plays images stored in the cooler's own memory. So every mood
is drawn once as a short looping GIF and stored in its own slot. After that, following the pet's mood
only means telling the cooler which slot to play, and that writes nothing to its memory. The slots are
rewritten only when the pet's look changes (a new name or accessory), so the cooler's memory is not worn
by everyday use. The price is that the pet on the cooler keeps a middling belly whatever the VRAM is.

Needs liquidctl (for the cooler) and Pillow (to draw the GIFs).
"""

import copy
import dataclasses
import json
import tempfile
import threading
import time
from pathlib import Path

from .art import H, W, draw
from .world import state_path

MOODS = ("sleeping", "idle", "eating", "working", "overheating", "fainted")
SIZE, ZOOM = 320, 7
LOOP = 32                      # frames per GIF: one full breath at ten frames a second


def find_cooler():
    try:
        from liquidctl import find_liquidctl_devices
    except ImportError:
        return None
    return next((d for d in find_liquidctl_devices() if hasattr(d, "_send_data") and hasattr(d, "bulk_device")), None)


def puppet(pet, mood):
    """A copy of the pet posed in the given mood, for drawing ahead of time."""
    p = copy.copy(pet)
    g = dataclasses.replace(pet.gpu)
    g.util = {"working": 95, "eating": 90, "overheating": 100}.get(mood, 0)
    g.temp = {"overheating": 88, "working": 66, "eating": 58}.get(mood, 38)
    g.mem_used = g.mem_total * (0.995 if mood == "fainted" else 0.5)   # a middling belly: the stored pictures can't follow VRAM
    p.gpu, p.mood, p.rate = g, mood, 49.0 if mood == "eating" else 0.0
    p.particles, p.drops, p.line = [], [], ""
    p.petted_until = p.sparkle_until = p.hot_until = 0.0
    p.last_fed = time.time()
    return p


def frames(pet, mood):
    from PIL import Image, ImageDraw, ImageFont
    actor, now, out = puppet(pet, mood), time.time(), []
    for f in range(LOOP):          # let tokens and sweat get going before the first kept frame
        draw(actor, f, now)
    name_font, mood_font = ImageFont.load_default(size=24), ImageFont.load_default(size=15)
    label = {"idle": "chilling", "working": "working out", "overheating": "TOO HOT", "fainted": "out of memory"}.get(mood, mood)
    left, top = (SIZE - W * ZOOM) // 2, 34
    for f in range(LOOP, LOOP * 2):
        img = Image.new("RGB", (SIZE, SIZE), (10, 10, 14))
        pen = ImageDraw.Draw(img)
        pen.ellipse((3, 3, SIZE - 4, SIZE - 4), outline=tuple(v // 2 for v in pet.color), width=3)
        for y, row in enumerate(draw(actor, f, now)):
            for x, c in enumerate(row):
                if c:
                    pen.rectangle((left + x * ZOOM, top + y * ZOOM, left + (x + 1) * ZOOM - 1, top + (y + 1) * ZOOM - 1), fill=c)
        pen.text((SIZE / 2, 262), pet.name, font=name_font, fill=(236, 235, 244), anchor="mm")
        pen.text((SIZE / 2, 286), label, font=mood_font, fill=(141, 140, 163), anchor="mm")
        out.append(img)
    return out


def write_gif(pet, mood, path):
    images = [im.quantize(colors=64, dither=0) for im in frames(pet, mood)]
    images[0].save(path, save_all=True, append_images=images[1:], duration=100, loop=0, optimize=False)
    return path


def look_of(pet):
    """What the stored GIFs depend on. A new look means the slots are redrawn."""
    return [pet.name, pet.color_index, pet.species, pet.wearing]


def ask(cooler, command, reply, tries=12):
    """Send a command and read until its own reply arrives.

    The cooler also sends status reports on its own schedule, and liquidctl's helpers take whatever comes
    next as the answer, which can be the answer to an earlier question. Matching on the reply's first two
    bytes keeps questions and answers paired.
    """
    cooler.device.clear_enqueued_reports()
    cooler._write(command)
    for _ in range(tries):
        msg = bytes(cooler._read())
        if msg[:2] == reply:
            return msg
    raise RuntimeError("the cooler did not answer")


def occupied(cooler):
    return {i for i in range(16) if any(ask(cooler, [0x30, 0x04, i], b"\x31\x04")[15:])}


def show_slot(cooler, index):
    return ask(cooler, [0x38, 0x01, 0x04, index], b"\x39\x01")[14] == 1


def show_stock(cooler):
    """Back to the cooler's own liquid-temperature screen."""
    return ask(cooler, [0x38, 0x01, 0x02, 0x00], b"\x39\x01")[14] == 1


def delete_slot(cooler, index):
    return ask(cooler, [0x32, 0x02, index], b"\x33\x02")[14] == 1


def memo_path():
    return state_path().with_name("lcd.json")


def load_memo():
    try:
        return json.loads(memo_path().read_text())
    except (OSError, ValueError):
        return {}


def save_memo(memo):
    memo_path().parent.mkdir(parents=True, exist_ok=True)
    memo_path().write_text(json.dumps(memo, indent=1))


def clear_slots(cooler, memo):
    """Delete the slots this program filled, and only those."""
    for index in set(memo.get("slots", {}).values()) & occupied(cooler):
        delete_slot(cooler, index)


def install(cooler, pet, memo, say=print):
    """Draw every mood and store each in a free slot. Returns {mood: slot}."""
    show_stock(cooler)                          # show the stock screen while slots are being rewritten
    clear_slots(cooler, memo)
    slots = {}
    with tempfile.TemporaryDirectory() as tmp:
        for mood in MOODS:
            before = occupied(cooler)
            if len(before) >= 16:
                raise RuntimeError("the cooler has no free image slots; free one in NZXT CAM or run --lcd-remove")
            path = write_gif(pet, mood, str(Path(tmp) / f"{mood}.gif"))
            cooler.device.clear_enqueued_reports()
            cooler.set_screen("lcd", "gif", path)
            new = occupied(cooler) - before
            if len(new) != 1:
                raise RuntimeError(f"could not tell which slot the '{mood}' picture went into")
            slots[mood] = new.pop()
            say(f"cooler screen: stored '{mood}'")
    memo.update({"pet": pet.gpu.uuid, "look": look_of(pet), "slots": slots})
    save_memo(memo)
    return slots


def remove():
    cooler = find_cooler()
    if cooler is None:
        print("No NZXT Kraken Z cooler found (is liquidctl installed?).")
        return 1
    memo = load_memo()
    cooler.connect()
    try:
        show_stock(cooler)
        clear_slots(cooler, memo)
    finally:
        cooler.disconnect()
    memo_path().unlink(missing_ok=True)
    print("Cooler screen is back to its stock liquid-temperature display.")
    return 0


class Screen(threading.Thread):
    """Keeps the cooler showing the right mood for one pet."""

    def __init__(self, world, which=None):
        super().__init__(daemon=True)
        self.world, self.which = world, which

    def target(self):
        pets = self.world.view
        if not pets:
            return None
        if self.which is not None:
            return pets[min(self.which, len(pets) - 1)]
        return next((p for p in pets if p.gpu.hosts_llm), pets[0])

    def run(self):
        world = self.world
        try:
            import PIL  # noqa: F401
        except ImportError:
            world.note = "cooler screen needs Pillow (pip install pillow)"
            return
        cooler = find_cooler()
        if cooler is None:
            world.note = "no NZXT Kraken Z cooler found"
            return
        cooler.connect()
        try:
            while self.target() is None and not world.stop.wait(0.5):
                pass
            memo, shown, stable_since, pending = load_memo(), None, time.time(), None
            while not world.stop.wait(1.0):
                pet = self.target()
                if pet is None:
                    continue
                look = look_of(pet)
                slots = memo.get("slots", {})
                fresh = memo.get("pet") == pet.gpu.uuid and memo.get("look") == look and set(slots.values()) <= occupied(cooler) and len(slots) == len(MOODS)
                if not fresh:
                    if pending != look:                  # wait for the new look to hold still before rewriting slots
                        pending, stable_since = look, time.time()
                    if time.time() - stable_since < (0 if not slots else 20):
                        continue
                    world.note = "drawing the pet onto the cooler screen..."
                    slots = install(cooler, pet, memo, say=lambda text: setattr(world, "note", text))
                    world.note, shown = "pet is on the cooler screen", None
                pending = None
                if pet.mood != shown and show_slot(cooler, slots[pet.mood]):
                    shown = pet.mood
            slots = load_memo().get("slots", {})
            if "sleeping" in slots:                      # nobody is watching the card any more: put the pet to bed
                show_slot(cooler, slots["sleeping"])
        except Exception as e:
            world.note = f"cooler screen stopped: {e}"[:70]
        finally:
            cooler.disconnect()


def start(world, which=None):
    screen = Screen(world, which)
    screen.start()
    return screen
