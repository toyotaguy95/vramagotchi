"""Keeps the pets alive: samples the hardware in the background and moves every pet on ten times a second."""

import json
import os
import random
import threading
import time
from pathlib import Path

from .art import FPS, draw
from .pet import ATTITUDES, ITEM_NAMES, LINES, Pet
from .sources import Demo, find_llm
from .util import human


def state_path():
    return Path(os.environ.get("XDG_STATE_HOME") or Path.home() / ".local" / "state") / "vramagotchi" / "state.json"


def load_state():
    try:
        return json.loads(state_path().read_text())
    except (OSError, ValueError):
        return {}


class World:
    def __init__(self, source, llm=None, persist=True, urls=(), extras=()):
        self.source, self.llm, self.persist, self.urls = source, llm, persist, urls
        self.extras = list(extras)       # pets that are not GPUs, such as Claude Code
        self.own = {}                    # tokens waiting for those pets, by id
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
        self.treats = {}                 # tokens a pet was hand-fed and has not eaten yet

    # ── sampling (background thread) ──
    def sample_once(self, with_gpus=True):
        if with_gpus:
            gpus = self.source.sample() + [extra.sample() for extra in self.extras]
            with self.lock:
                self.gpus = gpus
        for extra in self.extras:
            try:
                _, eaten = extra.poll_tokens()
            except Exception:
                eaten = 0
            with self.lock:
                uuid = extra.sample().uuid
                self.own[uuid] = self.own.get(uuid, 0) + eaten
        try:
            _, new = (self.llm or self.source).poll_tokens(self.gpus)
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
            own, self.own = self.own, {}
        if gpus and not self.adopted:
            first = next((g for g in gpus if g.hosts_llm and g.kind == "gpu"), gpus[0])
            self.adopted = {g.uuid for g in gpus} if self.demo else {first.uuid}
        self.waiting = [g for g in gpus if g.uuid not in self.adopted]
        gpus = [g for g in gpus if g.uuid in self.adopted]
        for g in gpus:
            if g.uuid not in self.pets:
                self.pets[g.uuid] = Pet(g, self.saved.get(g.uuid, {}), len(self.pets),
                                        sleep_after=3.0 if self.demo else 20.0, unlock_all=self.demo)
                if getattr(self, "hatched", None) == g.uuid:
                    self.pets[g.uuid].hatch_start, self.hatched = now, None
                if self.demo:
                    self.pets[g.uuid].wearing = ("propeller", "bow", "glasses", "flower")[len(self.pets) % 4 - 1]
        cards = [g for g in gpus if g.kind == "gpu"]
        eaters = [g.uuid for g in cards if g.hosts_llm] or ([max(cards, key=lambda g: g.util).uuid] if cards and tokens else [])
        pets = []
        for g in gpus:
            pet = self.pets[g.uuid]
            pet.approx = bool(getattr(self.llm, "approx", False)) and g.kind == "gpu"
            treat = min(2, self.treats.get(g.uuid, 0))           # a treat is eaten a bite at a time
            if treat:
                self.treats[g.uuid] -= treat
            pet.update(g, treat + (own.get(g.uuid, 0) if g.kind != "gpu" else tokens / len(eaters) if g.uuid in eaters else 0.0), now, dt)
            pet.px = draw(pet, self.frame_no, now)
            look = (pet.mood, pet.egg, bool(pet.hatch_start), pet.wearing, round(pet.pct, 1), pet.stage, pet.species)
            if pet.still is None or look != pet.still_look or self.frame_no % 20 == 0:
                pet.still, pet.still_look = pet.px, look      # a steadier picture for very small windows
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
        tmp.write_text(json.dumps({uuid: pet.save() for uuid, pet in self.pets.items() if not pet.egg}, indent=1))
        tmp.replace(path)

    # ── things people do to pets ──
    def pick(self, uuid=None):
        if uuid in self.pets:
            return self.pets[uuid]
        return self.view[self.selected] if self.view else None

    def feed(self, uuid=None):
        """Feed the chosen pet: the model writes its reply, and the pet eats those tokens as a treat."""
        pet, now = self.pick(uuid), time.time()
        if not pet or pet.egg:
            return
        if not hasattr(self.llm, "say"):
            pet.say("no model server found. I only eat real tokens", 5, now)
            return
        pet.say("...", 90, now, hold=True)
        g = pet.gpu

        def ask():
            try:
                text = self.llm.say(
                    f"You are {pet.name}, a tiny pet {pet.species} that lives inside an {g.name} graphics card and eats tokens. "
                    f"Reply with ONE short funny sentence in first person, under 14 words, no quotes, no emojis. {ATTITUDES[pet.attitude]}",
                    f"Status: {g.temp:.0f}°C, VRAM {pet.pct * 100:.0f}% full ({g.mem_used / 1024:.1f} GB), "
                    f"{human(pet.tokens_today)} tokens eaten today, mood: {pet.label()}. You were just fed. Say something.")
            except Exception:
                text = ""
            pet.say(text or "nom.", 12, time.time(), hold=True)
            if not (g.hosts_llm and g.kind == "gpu"):      # the card running the model already counted these; any other pet gets them as a treat
                self.treats[g.uuid] = self.treats.get(g.uuid, 0) + max(8, len(text) // 4)

        threading.Thread(target=ask, daemon=True).start()

    def crack(self):
        """Hatch the first egg that is still waiting."""
        egg = next((p for p in self.view if p.egg and not p.hatch_start), None)
        if egg:
            egg.hatch_start = time.time()
        return egg is not None

    def hatch(self):
        """Hatch a waiting egg, or give the next card that has no pet one of its own."""
        if self.crack():
            return
        if self.waiting:
            self.adopted.add(self.waiting[0].uuid)
            self.hatched = self.waiting[0].uuid

    def stroke(self, uuid=None):
        pet, now = self.pick(uuid), time.time()
        if pet:
            pet.petted_until = now + 2.5
            pet.times_petted += 1
            pet.say(random.choice(LINES["petted"]), 2.5, now)

    def morph(self, uuid=None):
        """Turn the chosen pet into the next animal."""
        pet = self.pick(uuid)
        if pet and not pet.egg:
            pet.say(f"I'm a {pet.become_next()} now", 3, time.time())

    def attitude(self, uuid=None):
        pet = self.pick(uuid)
        if pet and not pet.egg:
            kind = pet.next_attitude()
            pet.say({"sweet": "I'll be sweet", "cheeky": "I'll be cheeky", "rude": "fine. I'll be rude"}[kind] + " when you feed me", 3, time.time())

    def dress(self, uuid=None, item="next"):
        pet = self.pick(uuid)
        if not pet:
            return
        if item == "next":
            pet.wear_next()
        elif item in pet.unlocked or item is None:
            pet.wearing = item
        pet.say(f"wearing my {ITEM_NAMES[pet.wearing]}" if pet.wearing else "au naturel", 3, time.time())
