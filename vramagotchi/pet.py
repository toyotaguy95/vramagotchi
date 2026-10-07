"""A pet's memory and mood. Nothing in here draws."""

import random
import time
import zlib

COLORS = [(150, 214, 80), (104, 196, 244), (188, 152, 246), (255, 176, 116), (255, 150, 192), (250, 222, 104)]
SPECIES = ("cat", "bear", "bunny", "sprout")
NAMES = ["Mochi", "Biscuit", "Tofu", "Nugget", "Pixel", "Waffle", "Pickle", "Bean", "Noodle", "Dumpling", "Gizmo", "Sprout"]

CLAUDE_LINES = {
    "sleeping": ["zzz... waiting for a prompt", "wake me when you need code", "zzz... dreaming in tokens"],
    "idle": ["what are we building?", "my context is {pct:.0f}% full", "ready when you are", "I read your whole repo. no comment."],
    "stuffed": ["context {pct:.0f}% full. I can barely think", "so many tokens in my head", "maybe start a fresh session?"],
    "eating": ["nom nom, fresh tokens", "{rate:.0f} tokens a second!", "writing, writing, writing"],
    "working": ["thinking hard"],
    "fainted": ["out of context...", "too... much... conversation"],
    "hungry": ["{hungry:.0f} hours since my last prompt", "is Claude on holiday?"],
    "petted": ["hehe", "again!", "you're absolutely right to pet me"],
}

LINES = {
    "sleeping": ["zzz... dreaming of matrix multiplications", "wake me when there's a prompt", "five more minutes", "zzz... float16... zzz"],
    "idle": ["feed me tokens?", "I'm holding {used:.1f} GB. it's heavy.", "is anyone going to prompt me", "just vibing at {temp:.0f}°C", "I could really go for a prompt"],
    "stuffed": ["so... full... {pct:.0f}% VRAM", "one more layer and I pop", "no room for dessert", "who put {used:.0f} GB of model in me"],
    "eating": ["nom nom nom", "{rate:.0f} tokens a second. delicious", "tokens!!", "mmm, fresh logits"],
    "working": ["not tokens, but it's cardio", "rendering. don't talk to me", "{util:.0f}% busy over here"],
    "sweating": ["{temp:.0f}°C. is it hot in here", "my fans are doing their best", "could someone open a window"],
    "overheating": ["I CAN SMELL THERMAL PASTE", "{temp:.0f}°C. THIS IS FINE.", "tell my fans I loved them"],
    "fainted": ["out of memory...", "too... much... VRAM", "CUDA said no"],
    "hungry": ["{hungry:.0f} hours since my last token", "I'm wasting away over here", "remember when you used to prompt me"],
    "petted": ["hehe", "again!", "I love you too"],
}

# A pet grows up as it eats: (stage, tokens eaten in its whole life, how big it is drawn).
STAGES = (("baby", 0, 0.7), ("kid", 25e3, 0.85), ("teen", 250e3, 1.0), ("adult", 2.5e6, 1.0), ("legend", 25e6, 1.0))

# Things a pet can wear. Some are earned by what the card actually does; the rest are found by luck while eating.
EARNED = (
    ("headphones", "ate 10k tokens", lambda p: p.tokens_total >= 1e4),
    ("wizard", "ate 100k tokens", lambda p: p.tokens_total >= 1e5),
    ("crown", "ate a million tokens", lambda p: p.tokens_total >= 1e6),
    ("tophat", "ate ten million tokens", lambda p: p.tokens_total >= 1e7),
    ("shades", "survived 85°C", lambda p: p.max_temp >= 85),
    ("bandage", "ran out of memory and lived", lambda p: p.faints >= 1),
    ("flame", "was fed seven days in a row", lambda p: p.streak >= 7),
    ("bow", "got petted 25 times", lambda p: p.times_petted >= 25),
)
FOUND = (("flower", "common"), ("glasses", "common"), ("propeller", "rare"), ("halo", "rare"), ("star", "legendary"))
FIND_ODDS_PER_1K = 0.02          # the chance of a find for every thousand tokens eaten
SHINY_ODDS = 1 / 50              # the chance an egg holds a shiny pet
OLD_STARTERS = ("bow", "flower", "glasses", "propeller")     # pets born before finds existed had these from birth
ITEM_NAMES = {"bow": "bow", "flower": "flower", "glasses": "glasses", "propeller": "propeller cap", "headphones": "headphones",
              "wizard": "wizard hat", "crown": "crown", "tophat": "top hat", "shades": "sunglasses", "bandage": "bandage",
              "flame": "streak flame", "halo": "halo", "star": "golden star"}
ITEM_SLOT = {"bow": "deco", "flower": "deco", "bandage": "deco", "glasses": "face", "shades": "face",
             "propeller": "head", "wizard": "head", "crown": "head", "tophat": "head", "headphones": "head",
             "flame": "head", "halo": "head", "star": "head"}
ALL_ITEMS = tuple(item for item, _, _ in EARNED) + tuple(item for item, _ in FOUND)


class Pet:
    def __init__(self, gpu, saved, slot, sleep_after=20.0, unlock_all=False):
        now = time.time()
        self.gpu = gpu
        self.slot = slot
        self.sleep_after = sleep_after
        self.name = saved.get("name") or NAMES[(zlib.crc32(gpu.uuid.encode()) + slot) % len(NAMES)]
        self.color_index = saved.get("color", slot) % len(COLORS)
        self.color = COLORS[self.color_index] if gpu.kind == "gpu" else (222, 132, 98)
        self.species_index = saved.get("species", slot) % len(SPECIES)
        self.species = SPECIES[self.species_index]
        self.born = saved.get("born", now)
        self.tokens_total = saved.get("tokens_total", 0.0)
        self.day = saved.get("day", time.strftime("%Y-%m-%d"))
        self.tokens_today = saved.get("tokens_today", 0.0) if self.day == time.strftime("%Y-%m-%d") else 0.0
        self.max_temp = saved.get("max_temp", 0.0)
        self.last_fed = saved.get("last_fed", now)
        self.faints = saved.get("faints", 0)
        self.times_petted = saved.get("times_petted", 0)
        self.streak = saved.get("streak", 0)
        self.fed_day = saved.get("fed_day", "")
        self.shiny = saved.get("shiny", bool(not saved and not unlock_all and random.random() < SHINY_ODDS))
        self.crumbs = saved.get("crumbs", 0.0)       # tokens eaten since the last roll for a find
        known = ALL_ITEMS if unlock_all else tuple(saved.get("unlocked", ())) + (OLD_STARTERS if saved and "streak" not in saved else ())
        self.unlocked = [item for item in ALL_ITEMS if item in known]
        self.wearing = saved.get("wearing") if saved.get("wearing") in self.unlocked else None

        self.egg = not saved and not unlock_all      # a brand-new pet starts as an egg
        self.hatch_start = None                      # set when someone hatches it
        self.rate = 0.0
        self.approx = False                          # true when token numbers are estimates
        self.last_active = now
        self.mood = "idle"
        self.line, self.line_until, self.quiet_until = "", 0.0, now + 2
        self.petted_until = self.sparkle_until = self.hot_until = 0.0
        self.particles, self.drops = [], []
        self.px = None
        self.still, self.still_look = None, None     # a picture refreshed only now and then, for tiny windows
        self._stamp = gpu.stamp
        self._settled = gpu.mem_used     # last memory level we commented on

    def save(self):
        return {"name": self.name, "color": self.color_index, "species": self.species_index, "born": self.born,
                "tokens_total": round(self.tokens_total), "day": self.day, "tokens_today": round(self.tokens_today),
                "max_temp": self.max_temp, "last_fed": self.last_fed, "faints": self.faints,
                "times_petted": self.times_petted, "unlocked": list(self.unlocked), "wearing": self.wearing,
                "streak": self.streak, "fed_day": self.fed_day, "shiny": self.shiny, "crumbs": round(self.crumbs)}

    @property
    def stage(self):
        return max(i for i, (_, at, _) in enumerate(STAGES) if self.tokens_total >= at)

    @property
    def stage_name(self):
        return STAGES[self.stage][0]

    def growth(self):
        """What comes next, in words."""
        if self.stage + 1 == len(STAGES):
            return "fully grown"
        name, at, _ = STAGES[self.stage + 1]
        return f"{name} at {at / 1e6:g}M" if at >= 1e6 else f"{name} at {at / 1e3:g}k"

    def _find(self, tokens):
        """Rolls for a lucky find: one roll for every thousand tokens eaten. Rarer things come up less often."""
        self.crumbs += tokens
        while self.crumbs >= 1000:
            self.crumbs -= 1000
            if random.random() < FIND_ODDS_PER_1K:
                roll = random.random()
                rarity = "legendary" if roll < 0.03 else "rare" if roll < 0.25 else "common"
                new = [item for item, kind in FOUND if kind == rarity and item not in self.unlocked]
                if new:
                    return random.choice(new), rarity
        return None

    @property
    def pct(self):
        return self.gpu.mem_used / self.gpu.mem_total

    @property
    def stuffed(self):
        return self.pct >= 0.85

    @property
    def sweating(self):
        return self.gpu.temp >= 72

    def hungry_hours(self, now):
        return (now - self.last_fed) / 3600 if self.gpu.hosts_llm else 0.0

    def outfit(self, now):
        """What is on the pet right now: what it chose to wear plus what the moment calls for."""
        chosen = self.wearing
        look = {"head": None, "face": None, "deco": None, "band": self.mood == "working"}
        if chosen:
            look[ITEM_SLOT[chosen]] = chosen
        if self.mood == "fainted":
            look["head"] = None
        elif self.mood == "sleeping":
            look["head"] = "nightcap"
        elif now < self.hot_until and self.mood != "overheating":
            look["head"] = "icepack"
        return look

    def wear_next(self):
        options = [None] + self.unlocked
        self.wearing = options[(options.index(self.wearing) + 1) % len(options)]
        return self.wearing

    def say(self, text, seconds, now):
        self.line, self.line_until = text, now + seconds
        self.quiet_until = self.line_until + random.uniform(4, 9)

    def _pick(self, now):
        g = self.gpu
        hungry = self.hungry_hours(now)
        if self.mood in ("idle", "sleeping") and hungry >= 2 and random.random() < 0.5:
            key = "hungry"
        elif self.mood == "idle" and self.stuffed:
            key = "stuffed"
        elif self.mood in ("eating", "working") and self.sweating and random.random() < 0.5:
            key = "sweating"
        else:
            key = self.mood
        lines = CLAUDE_LINES if g.kind == "claude" else LINES
        return random.choice(lines.get(key) or lines["idle"]).format(used=g.mem_used / 1024, pct=self.pct * 100, temp=g.temp, util=g.util,
                                                rate=self.rate, hungry=hungry)

    def update(self, gpu, tokens, now, dt):
        if self.egg:
            self.gpu, self._stamp, self._settled, self.line = gpu, gpu.stamp, gpu.mem_used, ""
            if self.hatch_start and now - self.hatch_start > 2.4:
                self.egg = False
                self.born = self.last_fed = self.last_active = now
                self.sparkle_until = now + 4
                self.say(f"hi! I'm {self.name}{', a rare shiny one' if self.shiny else ''}. I live in your {gpu.name}", 6, now)
            return
        fresh = gpu.stamp != self._stamp
        delta = gpu.mem_used - self.gpu.mem_used if fresh else 0.0
        self.gpu, self._stamp = gpu, gpu.stamp
        self.rate += (tokens / dt - self.rate) * min(1.0, dt / 1.5) if dt > 0 else 0.0
        stage, found = self.stage, None
        if tokens:
            today = time.strftime("%Y-%m-%d")
            if today != self.day:
                self.day, self.tokens_today = today, 0.0
            if today != self.fed_day:
                yesterday = time.strftime("%Y-%m-%d", time.localtime(now - 86400))
                self.streak, self.fed_day = (self.streak + 1 if self.fed_day == yesterday else 1), today
            found = self._find(tokens)
            self.tokens_total += tokens
            self.tokens_today += tokens
            self.last_fed = now
        if gpu.util >= 5 or tokens:
            self.last_active = now
        self.max_temp = max(self.max_temp, gpu.temp)
        if gpu.temp >= 85:
            self.hot_until = now + 300       # ice pack for five minutes afterwards

        if self.pct >= 0.985:
            mood = "fainted"
        elif gpu.temp >= 85:
            mood = "overheating"
        elif self.rate > 1:
            mood = "eating"
        elif gpu.util >= 25:
            mood = "working"
        elif now - self.last_active > self.sleep_after:
            mood = "sleeping"
        else:
            mood = "idle"
        if mood == "fainted" and self.mood != "fainted":
            self.faints += 1

        earned = next((item for item, _, test in EARNED if item not in self.unlocked and test(self)), None)
        change = gpu.mem_used - self._settled if fresh and abs(delta) < 150 and gpu.kind == "gpu" else 0.0
        if fresh and abs(delta) < 150:
            self._settled = gpu.mem_used
        if self.stage > stage:
            self.sparkle_until = now + 6
            self.say(f"I grew up! I'm {'an' if self.stage_name[0] in 'aeiou' else 'a'} {self.stage_name} now", 8, now)
        elif earned or found:
            new = earned or found[0]
            self.unlocked = [item for item in ALL_ITEMS if item in self.unlocked or item == new]
            self.wearing = self.wearing or new
            self.sparkle_until = now + 4
            if earned:
                why = next(reason for item, reason, _ in EARNED if item == earned)
                self.say(f"new {ITEM_NAMES[earned]}! I {why}", 7, now)
            else:
                self.say(f"I found a {ITEM_NAMES[new]}! ({found[1]})", 7, now)
        elif change > 1024:
            self.say(f"*gulp* that was a {change / 1024:.1f} GB model", 6, now)
        elif change < -1024:
            self.say(f"ahh. {-change / 1024:.1f} GB lighter", 6, now)
        elif mood != self.mood:
            self.mood = mood
            self.say(self._pick(now), 5, now)
        elif now > self.quiet_until:
            self.say(self._pick(now), 5, now)
        self.mood = mood
        if now > self.line_until:
            self.line = ""

    def label(self):
        if self.egg:
            return "hatching!" if self.hatch_start else "an egg"
        extra = []
        if self.sweating and self.mood not in ("overheating", "fainted"):
            extra.append("sweating")
        if self.stuffed and self.mood in ("idle", "eating", "working"):
            extra.append("stuffed")
        base = {"fainted": "fainted (out of context)" if self.gpu.kind == "claude" else "fainted (out of memory)", "overheating": "OVERHEATING", "eating": "eating",
                "working": "working out", "idle": "chilling",
                "sleeping": "food coma" if self.stuffed else "sleeping"}[self.mood]
        return " · ".join([base] + extra)
