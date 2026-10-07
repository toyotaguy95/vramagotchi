"""Keeps the pets alive: samples the hardware in the background and moves every pet on ten times a second."""

import json
import os
import random
import threading
import time
from pathlib import Path

from .art import FPS, draw
from .pet import ITEM_NAMES, LINES, Pet
from .sources import Demo, LlamaCpp, find_llm
from .util import human


def state_path():
    return Path(os.environ.get("XDG_STATE_HOME") or Path.home() / ".local" / "state") / "vramagotchi" / "state.json"


def load_state():
    try:
        return json.loads(state_path().read_text())
    except (OSError, ValueError):
        return {}


class World:
    def __init__(self, source, llm=None, persist=True, urls=()):
        self.source, self.llm, self.persist, self.urls = source, llm, persist, urls
        self.demo = isinstance(source, Demo)
        self.lock = threading.Lock()
        self.gpus, self.pending = [], 0.0
        self.pets, self.saved = {}, load_state() if persist else {}
        self.view = []                   # the pets as last drawn; other threads only read this
        self.stop = threading.Event()
        self.last = self.last_save = time.time()
        self.frame_no, self.selected, self.note = 0, 0, ""
        self.adopted = set(self.saved)   # cards that have a pet; a first run starts with one
        self.waiting = []                # cards without a pet yet

    # ── sampling (background thread) ──
    def sample_once(self, with_gpus=True):
        if with_gpus:
            gpus = self.source.sample()
            with self.lock:
                self.gpus = gpus
        try:
            _, new = (self.llm or self.source).poll_tokens()
        except Exception:
            new = 0
        with self.lock:
            self.pending += new

    def _sample_forever(self):
        k = 0
        while not self.stop.is_set():
            started = time.time()
            try:
                self.sample_once(with_gpus=k % 2 == 0)
            except Exception as e:      # keep the pets alive through a bad read
                self.note = f"read failed: {e}"[:60]
            k += 1
            if self.llm is None and self.urls and k % 30 == 0:
                self.llm = find_llm(self.urls)
            self.stop.wait(max(0.05, 0.5 - (time.time() - started)))

    def start(self):
        threading.Thread(target=self._sample_forever, daemon=True).start()

    # ── one step of pet life; call from a single place, FPS times a second ──
    def frame(self, now=None):
        now = now or time.time()
        dt, self.last = max(1e-3, now - self.last), now
        with self.lock:
            gpus, tokens, self.pending = self.gpus, self.pending, 0.0
        if gpus and not self.adopted:
            first = next((g for g in gpus if g.hosts_llm), gpus[0])
            self.adopted = {g.uuid for g in gpus} if self.demo else {first.uuid}
        self.waiting = [g for g in gpus if g.uuid not in self.adopted]
        gpus = [g for g in gpus if g.uuid in self.adopted]
        for g in gpus:
            if g.uuid not in self.pets:
                self.pets[g.uuid] = Pet(g, self.saved.get(g.uuid, {}), len(self.pets),
                                        sleep_after=3.0 if self.demo else 20.0, unlock_all=self.demo)
                if self.demo:
                    self.pets[g.uuid].wearing = ("propeller", "bow", "glasses", "flower")[len(self.pets) % 4 - 1]
        eaters = [g.uuid for g in gpus if g.hosts_llm] or ([max(gpus, key=lambda g: g.util).uuid] if gpus and tokens else [])
        pets = []
        for g in gpus:
            pet = self.pets[g.uuid]
            pet.update(g, tokens / len(eaters) if g.uuid in eaters else 0.0, now, dt)
            if getattr(self, "hatched", None) == g.uuid:
                self.hatched = None
                pet.sparkle_until = now + 4
                pet.say(f"hi! I'm {pet.name}. I live in your {g.name}", 6, now)
            pet.px = draw(pet, self.frame_no, now)
            pets.append(pet)
        self.frame_no += 1
        self.selected = min(self.selected, max(0, len(pets) - 1))
        self.view = pets
        if self.persist and now - self.last_save > 30:
            self.save()
        return pets

    def run(self):
        """Drive the pets with no screen attached (for the web page or a cooler display)."""
        said = ""
        while not self.stop.is_set():
            started = time.time()
            self.frame()
            if self.note != said:
                said = self.note
                print(said, flush=True)
            self.stop.wait(max(0.0, 1 / FPS - (time.time() - started)))

    def save(self):
        self.last_save = time.time()
        if not (self.persist and self.pets):
            return
        path = state_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps({uuid: pet.save() for uuid, pet in self.pets.items()}, indent=1))
        tmp.replace(path)

    # ── things people do to pets ──
    def pick(self, uuid=None):
        if uuid in self.pets:
            return self.pets[uuid]
        return self.view[self.selected] if self.view else None

    def feed(self):
        pets = [p for p in self.view if p.gpu.hosts_llm] or list(self.view)
        if not pets:
            return
        pet, now = pets[0], time.time()
        if not isinstance(self.llm, LlamaCpp):
            pet.say("no model server found. I only eat real tokens", 5, now)
            return
        pet.say("...", 90, now)
        g = pet.gpu

        def ask():
            try:
                text = self.llm.say(
                    f"You are {pet.name}, a tiny pet creature that lives inside an {g.name} graphics card and eats tokens. "
                    "Reply with ONE short funny sentence in first person, under 14 words, no quotes, no emojis.",
                    f"Status: {g.temp:.0f}°C, VRAM {pet.pct * 100:.0f}% full ({g.mem_used / 1024:.1f} GB), "
                    f"{human(pet.tokens_today)} tokens eaten today, mood: {pet.label()}. You were just fed. Say something.")
            except Exception:
                text = ""
            pet.say(text or "nom.", 12, time.time())

        threading.Thread(target=ask, daemon=True).start()

    def hatch(self):
        """Give the next card that has no pet one of its own."""
        if self.waiting:
            self.adopted.add(self.waiting[0].uuid)
            self.hatched = self.waiting[0].uuid

    def stroke(self, uuid=None):
        pet, now = self.pick(uuid), time.time()
        if pet:
            pet.petted_until = now + 2.5
            pet.times_petted += 1
            pet.say(random.choice(LINES["petted"]), 2.5, now)

    def dress(self, uuid=None, item="next"):
        pet = self.pick(uuid)
        if not pet:
            return
        if item == "next":
            pet.wear_next()
        elif item in pet.unlocked or item is None:
            pet.wearing = item
        pet.say(f"wearing my {ITEM_NAMES[pet.wearing]}" if pet.wearing else "au naturel", 3, time.time())
