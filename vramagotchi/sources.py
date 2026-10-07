"""Where the numbers come from: nvidia-smi, a llama.cpp server, or a made-up demo."""

import json
import re
import subprocess
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from .util import clamp

LLM_PROCESSES = ("llama", "ollama", "kobold", "vllm", "lmstudio", "lm-studio", "tabby", "text-generation", "exllama", "aphrodite")


@dataclass
class Gpu:
    index: int
    uuid: str
    name: str
    util: float = 0.0        # percent
    mem_used: float = 0.0    # MiB
    mem_total: float = 1.0   # MiB
    temp: float = 0.0        # °C
    power: float = 0.0       # W
    hosts_llm: bool = False
    stamp: float = 0.0       # when this sample was taken
    kind: str = "gpu"        # "claude" for the Claude Code pet, whose "memory" is its context window in tokens


def num(text):
    try:
        return float(text)
    except ValueError:        # "[N/A]" on cards that don't report a field
        return 0.0


class NvidiaSmi:
    QUERY = "index,uuid,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw"

    def _run(self, *args):
        return subprocess.run(["nvidia-smi", *args], capture_output=True, text=True, timeout=5).stdout.strip().splitlines()

    def sample(self):
        llm_cards = set()
        for line in self._run("--query-compute-apps=gpu_uuid,process_name", "--format=csv,noheader"):
            uuid, _, proc = line.partition(",")
            if any(key in proc.lower() for key in LLM_PROCESSES):
                llm_cards.add(uuid.strip())
        gpus, now = [], time.time()
        for line in self._run(f"--query-gpu={self.QUERY}", "--format=csv,noheader,nounits"):
            p = [x.strip() for x in line.split(",")]
            if len(p) < 8:
                continue
            name = p[2].replace("NVIDIA ", "").replace("GeForce ", "")
            gpus.append(Gpu(int(p[0]), p[1], name, num(p[3]), num(p[4]), num(p[5]) or 1.0, num(p[6]), num(p[7]), p[1] in llm_cards, now))
        return gpus

    def poll_tokens(self, gpus=()):
        return False, 0


class AppleSilicon:
    """A Mac's built-in GPU. Its memory is the Mac's shared memory; macOS does not report GPU temperature or power
    without administrator rights, so those stay at zero and the pet never overheats here."""

    def __init__(self):
        self.name = self._run("sysctl", "-n", "machdep.cpu.brand_string") or "Apple GPU"
        self.total = num(self._run("sysctl", "-n", "hw.memsize")) / 2 ** 20 or 1.0

    @staticmethod
    def _run(*cmd):
        try:
            return subprocess.run(cmd, capture_output=True, text=True, timeout=5).stdout.strip()
        except (OSError, subprocess.SubprocessError):
            return ""

    @staticmethod
    def parse_memory(vm_stat):
        """MiB in use (active + wired + compressed) from `vm_stat` output."""
        size = re.search(r"page size of (\d+) bytes", vm_stat)
        pages = sum(int(n) for n in re.findall(r"Pages (?:active|wired down|occupied by compressor):\s+(\d+)", vm_stat))
        return pages * (int(size.group(1)) if size else 16384) / 2 ** 20

    @staticmethod
    def parse_util(ioreg):
        found = re.findall(r'"Device Utilization %"\s*=\s*(\d+)', ioreg)
        return max(map(float, found)) if found else 0.0

    def sample(self):
        busy = self._run("pgrep", "-if", "ollama|lm studio|llama-server|mlx")
        return [Gpu(0, "apple-gpu", self.name, self.parse_util(self._run("ioreg", "-r", "-d", "1", "-w", "0", "-c", "IOAccelerator")),
                    self.parse_memory(self._run("vm_stat")), self.total, 0.0, 0.0, bool(busy), time.time())]

    def poll_tokens(self, gpus=()):
        return False, 0


class Demo:
    """Two made-up cards living through a busy 48 seconds, on a loop."""

    LOOP = 48.0

    def __init__(self, clock):
        self.clock = clock
        self.last = clock()

    @staticmethod
    def _ramp(t, t0, t1, a, b):
        return a + (b - a) * clamp((t - t0) / (t1 - t0))

    def _rate(self, t):
        return 49.0 if 14 <= t < 34 else 0.0

    def sample(self):
        t, r = self.clock() % self.LOOP, self._ramp
        big = Gpu(0, "demo-0", "RTX 5060 Ti", 0, 600, 16311, 34, 4, True, time.time())
        if t < 6:
            pass
        elif t < 9:
            big.util, big.mem_used = 35, r(t, 6, 9, 600, 14300)
        elif t < 14:
            big.mem_used, big.temp = 14300, 40
        elif t < 28:
            big.util, big.mem_used, big.temp, big.power = 96, 14300, r(t, 14, 28, 40, 78), 165
        elif t < 34:
            big.util, big.mem_used, big.temp, big.power = 100, 14300, r(t, 28, 34, 78, 89), 180
        elif t < 40:
            big.util, big.mem_used, big.temp = 3, 14300, r(t, 34, 40, 89, 58)
        else:
            big.mem_used, big.temp = 14300, r(t, 40, 48, 58, 40)
        small = Gpu(1, "demo-1", "RTX 3070 Ti", 0, 300, 8192, 33, 12, False, time.time())
        if 16 <= t < 22:
            small.util, small.mem_used, small.temp, small.power = 99, r(t, 16, 18, 300, 7200), r(t, 16, 22, 33, 74), 240
        elif 22 <= t < 26:
            small.util, small.mem_used, small.temp, small.power = 100, 8150, 76, 250
        elif 26 <= t < 34:
            small.temp = r(t, 26, 34, 70, 40)
        return [big, small]

    def poll_tokens(self, gpus=()):
        now = self.clock()
        dt, self.last = max(0.0, now - self.last), now
        rate = self._rate(now % self.LOOP)
        return rate > 0, rate * dt


class LlamaCpp:
    """Reads generated-token counters from a llama.cpp server and can ask it for a line of dialogue."""

    def __init__(self, base):
        self.base = base.rstrip("/")
        self.seen = {}
        self.model = None

    def _get(self, path, timeout=1.5):
        with urllib.request.urlopen(self.base + path, timeout=timeout) as r:
            return json.load(r)

    def alive(self):
        try:
            if not isinstance(self._get("/slots"), list):
                return False
            models = self._get("/v1/models").get("data") or []
            self.model = models[0]["id"] if models else None
            return True
        except Exception:
            return False

    def poll_tokens(self, gpus=()):
        busy, new, seen = False, 0, {}
        for slot in self._get("/slots"):
            key = (slot.get("id"), slot.get("id_task"))
            nxt = slot.get("next_token")
            nxt = nxt[0] if isinstance(nxt, list) and nxt else (nxt or {})
            decoded = int(nxt.get("n_decoded") or 0)
            busy = busy or bool(slot.get("is_processing"))
            new += max(0, decoded - self.seen.get(key, 0))
            seen[key] = decoded
        self.seen = seen
        return busy, new

    def say(self, system, user):
        body = {"messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
                "max_tokens": 60, "temperature": 0.9, "stream": False,
                "chat_template_kwargs": {"enable_thinking": False}}   # a thinking model would spend the whole budget before answering
        if self.model:
            body["model"] = self.model
        req = urllib.request.Request(self.base + "/v1/chat/completions", data=json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=90) as r:
            text = (json.load(r)["choices"][0]["message"].get("content") or "").strip()
        text = text.splitlines()[0].strip().strip('"') if text else ""
        return text[:90]


class ClaudeCode:
    """A pet for Claude Code. Claude Code keeps a record of every reply on this computer, with token counts;
    this reads new lines from those records. The pet eats the tokens Claude writes, and its belly is how
    full the context window of the most recent session is. Nothing is sent anywhere."""

    def __init__(self, root=None):
        self.root = Path(root or Path.home() / ".claude" / "projects")
        self.offsets, self.counted = {}, {}
        self.context, self.window, self.last_scan, self.busy_until = 0, 200_000, 0.0, 0.0
        for path in self._recent(3600):                  # start from now: old replies are not eaten again
            self.offsets[path] = path.stat().st_size
        newest = max(self.offsets, key=lambda p: p.stat().st_mtime, default=None)
        if newest:
            with open(newest, "rb") as f:
                f.seek(max(0, self.offsets[newest] - 400_000))
                for line in f.read().decode("utf-8", "ignore").splitlines():
                    self._read(line, count=False)

    def available(self):
        return self.root.is_dir()

    def _recent(self, seconds):
        cutoff, found = time.time() - seconds, []
        try:
            for folder in self.root.iterdir():
                if folder.is_dir():
                    found += [p for p in folder.glob("*.jsonl") if p.stat().st_mtime >= cutoff]
        except OSError:
            pass
        return found

    def _read(self, line, count=True):
        if '"usage"' not in line:
            return 0
        try:
            entry = json.loads(line)
        except ValueError:
            return 0
        msg = entry.get("message") or {}
        use = msg.get("usage") or {}
        if entry.get("type") != "assistant" or not use:
            return 0
        if not entry.get("isSidechain"):
            self.context = (use.get("input_tokens") or 0) + (use.get("cache_read_input_tokens") or 0) + (use.get("cache_creation_input_tokens") or 0)
            self.window = 1_000_000 if self.context > 200_000 else 200_000
        key, out = msg.get("id") or entry.get("uuid"), use.get("output_tokens") or 0
        new = max(0, out - self.counted.get(key, 0))     # one reply is written as several lines; count it once
        self.counted[key] = max(out, self.counted.get(key, 0))
        return new if count else 0

    def poll_tokens(self, gpus=()):
        now, new = time.time(), 0
        if now - self.last_scan < 1.0:
            return now < self.busy_until, 0
        self.last_scan = now
        for path in self._recent(120):
            start = self.offsets.get(path, 0)
            try:
                size = path.stat().st_size
                if size <= start:
                    continue
                with open(path, "rb") as f:
                    f.seek(start)
                    chunk = f.read()
            except OSError:
                continue
            end = chunk.rfind(b"\n") + 1                # leave a half-written last line for next time
            self.offsets[path] = start + end
            for line in chunk[:end].decode("utf-8", "ignore").splitlines():
                new += self._read(line)
        if new:
            self.busy_until = now + 3
        if len(self.counted) > 5000:
            self.counted = dict(list(self.counted.items())[-1000:])
        return now < self.busy_until, new

    def sample(self):
        return Gpu(90, "claude-code", "Claude Code", 100.0 if time.time() < self.busy_until else 0.0,
                   float(self.context), float(self.window), 0.0, 0.0, True, time.time(), "claude")


class Ollama:
    """Ollama does not publish a running token count, so this estimates one: it measures the loaded model's
    real speed with one tiny request, then counts at that speed while a model is loaded and the GPU is busy.
    Numbers from here are estimates and are shown with a "~"."""

    approx = True

    def __init__(self, base="http://127.0.0.1:11434"):
        self.base = base.rstrip("/")
        self.speed = {}            # model name -> measured tokens per second
        self.model = None
        self.last = time.time()

    def _call(self, path, body=None, timeout=3):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.load(r)

    def alive(self):
        try:
            return isinstance(self._call("/api/ps").get("models"), list)
        except Exception:
            return False

    def _generate(self, prompt, system=None, tokens=24):
        body = {"model": self.model, "prompt": prompt, "stream": False, "options": {"num_predict": tokens}}
        if system:
            body["system"] = system
        reply = self._call("/api/generate", body, timeout=120)
        if reply.get("eval_count") and reply.get("eval_duration"):
            self.speed[self.model] = reply["eval_count"] / (reply["eval_duration"] / 1e9)
        return (reply.get("response") or "").strip(), reply.get("eval_count") or 0

    def poll_tokens(self, gpus=()):
        now = time.time()
        dt, self.last = min(2.0, now - self.last), now
        loaded = self._call("/api/ps").get("models") or []
        if not loaded:
            self.model = None
            return False, 0
        self.model = loaded[0].get("name") or loaded[0].get("model")
        if self.model not in self.speed:
            self.speed[self.model] = 0.0           # so a failed measurement is not retried every half second
            self._generate("hi")
            self.last = time.time()
            return True, 0
        # Generating means the GPU is busy AND Ollama's own process is working; a busy GPU alone could be anything.
        busy = max((g.util for g in gpus), default=0.0) >= 40 and self.process_cpu() >= 8
        return busy, self.speed[self.model] * dt if busy else 0

    @staticmethod
    def process_cpu():
        """Total CPU percent used by Ollama's processes right now."""
        try:
            out = subprocess.run(["ps", "-axo", "pcpu=,command="], capture_output=True, text=True, timeout=3).stdout
        except (OSError, subprocess.SubprocessError):
            return 100.0                     # can't tell: fall back to trusting the GPU reading
        return sum(num(line.split(None, 1)[0]) for line in out.splitlines() if "ollama" in line.lower() and len(line.split(None, 1)) == 2)

    def say(self, system, user):
        if not self.model:
            return ""
        text, _ = self._generate(user, system, tokens=60)
        text = text.splitlines()[0].strip().strip('"') if text else ""
        return text[:90]


def find_llm(urls):
    for probe in [LlamaCpp(url) for url in urls] + [Ollama()]:
        if probe.alive():
            return probe
    return None
