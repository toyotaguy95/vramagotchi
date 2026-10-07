"""A web page showing the pets, served from this machine. Standard library only.

The page works as a normal tab, as an OBS browser source (?bg=transparent), on a small case
screen in kiosk mode, and inside cooler software that can show a URL (?layout=round&pet=0).
"""

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from .art import FPS, H, W
from .pet import ITEM_NAMES
from .util import age, human

SYMBOLS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_"   # one character per pixel; "." is see-through


def encode(px):
    palette, index, out = [], {}, []
    for row in px:
        for c in row:
            if c is None:
                out.append(".")
                continue
            i = index.get(c)
            if i is None:
                i = index[c] = min(len(palette), len(SYMBOLS) - 1)
                if i == len(palette):
                    palette.append("#%02x%02x%02x" % c)
            out.append(SYMBOLS[i])
    return palette, "".join(out)


def payload(world):
    now, pets = time.time(), []
    for p in world.view:
        if p.px is None:
            continue
        g = p.gpu
        palette, pixels = encode(p.px)
        pets.append({
            "id": g.uuid, "name": p.name, "gpu": g.name, "age": age(now - p.born), "mood": p.mood, "label": p.label(),
            "line": p.line, "color": "#%02x%02x%02x" % p.color, "pct": round(p.pct * 100, 1),
            "used": round(g.mem_used / 1024, 1), "total": round(g.mem_total / 1024), "temp": round(g.temp),
            "power": round(g.power), "util": round(g.util), "rate": round(p.rate), "today": ("~" if p.approx else "") + human(p.tokens_today),
            "ever": human(p.tokens_total), "wearing": p.wearing, "items": [[i, ITEM_NAMES[i]] for i in p.unlocked],
            "pal": palette, "px": pixels,
        })
    return {"w": W, "h": H, "pets": pets, "waiting": [g.name for g in world.waiting]}


class Handler(BaseHTTPRequestHandler):
    world = None
    local_only = True
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):       # stay quiet; the terminal belongs to the pets
        pass

    def _allowed(self):
        """When listening on this machine only, refuse requests that arrive under some other site's name."""
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip("[]")
        return not self.local_only or host in ("127.0.0.1", "localhost", "::1")

    def _send(self, code, body, kind="application/json"):
        data = body if isinstance(body, bytes) else body.encode()
        self.send_response(code)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if not self._allowed():
            return self._send(403, "forbidden", "text/plain")
        path = urlparse(self.path).path
        if path == "/":
            self._send(200, PAGE, "text/html; charset=utf-8")
        elif path == "/state":
            self._send(200, json.dumps(payload(self.world)))
        elif path == "/events":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True
            last, sent = "", 0.0
            try:
                while not self.world.stop.is_set():
                    body = json.dumps(payload(self.world), separators=(",", ":"))
                    if body != last or time.time() - sent > 5:
                        self.wfile.write(f"data: {body}\n\n".encode())
                        self.wfile.flush()
                        last, sent = body, time.time()
                    time.sleep(1 / FPS)
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
        else:
            self._send(404, "not found", "text/plain")

    def do_POST(self):
        # The custom header keeps other websites from poking the pets: browsers won't send it cross-site without asking first.
        if not self._allowed() or self.headers.get("X-VRAMagotchi") != "1" or urlparse(self.path).path != "/do":
            return self._send(403, "forbidden", "text/plain")
        try:
            ask = json.loads(self.rfile.read(min(int(self.headers.get("Content-Length") or 0), 4096)) or b"{}")
        except ValueError:
            return self._send(400, "bad request", "text/plain")
        action, uuid = ask.get("action"), ask.get("id")
        if action == "feed":
            self.world.feed()
        elif action == "pet":
            self.world.stroke(uuid)
        elif action == "hatch":
            self.world.hatch()
        elif action == "wear":
            self.world.dress(uuid, ask.get("item"))
        else:
            return self._send(400, "unknown action", "text/plain")
        self._send(200, "{}")


def start(world, host="127.0.0.1", port=8377):
    handler = type("PetHandler", (Handler,), {"world": world, "local_only": host in ("127.0.0.1", "localhost", "::1")})
    for attempt in range(port, port + 10):
        try:
            server = ThreadingHTTPServer((host, attempt), handler)
            break
        except OSError:
            continue
    else:
        raise SystemExit(f"could not open a port near {port} for the web page")
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return f"http://{'127.0.0.1' if host in ('0.0.0.0', '::') else host}:{server.server_address[1]}"


PAGE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VRAMagotchi</title>
<style>
  :root { --bg: #15151c; --card: #1d1d27; --line: #2c2c3a; --ink: #ecebf4; --dim: #8d8ca3; --good: #7bd36a; --warn: #f5c84a; --bad: #f0584c; }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body { background: var(--bg); color: var(--ink); font: 14px/1.45 ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace;
         display: flex; flex-direction: column; align-items: center; }
  header { padding: 22px 16px 4px; text-align: center; }
  header h1 { margin: 0; font-size: 22px; letter-spacing: 1px; }
  header p { margin: 2px 0 0; color: var(--dim); }
  main { display: flex; flex-wrap: wrap; gap: 18px; justify-content: center; padding: 16px; width: 100%; }
  .pet { background: var(--card); border: 1px solid var(--line); border-radius: 18px; padding: 14px 18px 16px; width: min(380px, 100%);
         display: flex; flex-direction: column; align-items: center; }
  .say { min-height: 58px; display: flex; align-items: flex-end; justify-content: center; width: 100%; }
  .bubble { background: var(--ink); color: #1a1a22; border-radius: 12px; padding: 7px 12px; max-width: 100%; position: relative; text-align: center; }
  .bubble::after { content: ""; position: absolute; left: 50%; bottom: -7px; margin-left: -7px; border: 7px solid transparent; border-top-color: var(--ink); border-bottom: 0; }
  .stage { position: relative; width: 100%; cursor: pointer; }
  .stage::after { content: ""; position: absolute; left: 22%; right: 22%; bottom: 3%; height: 7%; border-radius: 50%; background: rgba(0,0,0,.35); z-index: 0; }
  canvas { position: relative; z-index: 1; width: 100%; height: auto; image-rendering: pixelated; image-rendering: crisp-edges; display: block; }
  .name { font-size: 17px; font-weight: 700; margin-top: 4px; }
  .name small { color: var(--dim); font-weight: 400; font-size: 13px; }
  .mood { color: var(--dim); margin-bottom: 8px; }
  .bar { width: 100%; height: 12px; border-radius: 8px; background: #0f0f15; border: 1px solid var(--line); overflow: hidden; }
  .bar i { display: block; height: 100%; border-radius: 8px; transition: width .6s; }
  .row { display: flex; justify-content: space-between; width: 100%; color: var(--dim); margin-top: 5px; gap: 8px; }
  .row b { color: var(--ink); font-weight: 600; }
  .wardrobe, .acts { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; margin-top: 10px; }
  button { font: inherit; color: var(--ink); background: #262633; border: 1px solid var(--line); border-radius: 999px; padding: 3px 11px; cursor: pointer; }
  button:hover { border-color: var(--dim); }
  button.on { background: var(--ink); color: #1a1a22; }
  .acts button { padding: 5px 16px; }
  .empty { color: var(--dim); padding: 40px; }

  body.bare header, body.bare .name, body.bare .mood, body.bare .bar, body.bare .row, body.bare .wardrobe, body.bare .acts { display: none; }
  body.bare .pet { background: none; border: 0; }

  /* round cooler screens: one pet inside a circle, VRAM as a ring around the edge */
  body.round { justify-content: center; overflow: hidden; }
  body.round header, body.round .wardrobe, body.round .acts, body.round .bar, body.round .row { display: none; }
  body.round main { padding: 0; width: 100vmin; height: 100vmin; position: relative; align-items: center; }
  body.round .pet { background: none; border: 0; width: 100vmin; height: 100vmin; padding: 9vmin 14vmin 0; justify-content: flex-start; }
  body.round .say { min-height: 17vmin; font-size: 3.6vmin; line-height: 1.25; }
  body.round .bubble { padding: 1.4vmin 2.6vmin; border-radius: 3vmin; }
  body.round .stage { width: 62vmin; margin-top: -1vmin; }
  body.round .name { font-size: 5.4vmin; margin-top: -1vmin; }
  body.round .name small { display: none; }
  body.round .mood { font-size: 3.8vmin; }
  .ring { display: none; }
  body.round .ring { display: block; position: fixed; left: 50%; top: 50%; width: 100vmin; height: 100vmin; margin: -50vmin 0 0 -50vmin; transform: rotate(-90deg); pointer-events: none; }
</style>
</head>
<body>
<header><h1>VRAMagotchi</h1><p>a pet that lives on your GPU</p></header>
<main id="pets"><div class="empty">looking for GPUs...</div></main>
<div class="acts" id="hatch" style="display:none"><button></button></div>
<svg class="ring" viewBox="0 0 100 100"><circle cx="50" cy="50" r="47.5" fill="none" stroke="#262633" stroke-width="3"/>
<circle id="arc" cx="50" cy="50" r="47.5" fill="none" stroke="#7bd36a" stroke-width="3" stroke-linecap="round" stroke-dasharray="0 299"/></svg>
<script>
const q = new URLSearchParams(location.search);
const only = q.get("pet"), layout = q.get("layout");
if (layout === "round") document.body.classList.add("round");
if (q.has("bare")) document.body.classList.add("bare");
if (q.get("bg")) document.body.style.background = q.get("bg");
const SYMBOLS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_";
const cards = new Map();
const level = (v, warn, bad) => v >= bad ? "var(--bad)" : v >= warn ? "var(--warn)" : "var(--good)";

function send(action, id, item) {
  fetch("/do", { method: "POST", headers: { "Content-Type": "application/json", "X-VRAMagotchi": "1" },
                 body: JSON.stringify({ action, id, item }) });
}

function card(p, w, h) {
  const el = document.createElement("section");
  el.className = "pet";
  el.innerHTML = `<div class="say"></div><div class="stage" title="pet me"><canvas width="${w}" height="${h}"></canvas></div>
    <div class="name"></div><div class="mood"></div><div class="bar"><i></i></div>
    <div class="row"><span class="vram"></span><span class="vitals"></span></div>
    <div class="row"><span class="ate"></span><span class="rate"></span></div>
    <div class="wardrobe"></div>
    <div class="acts"><button data-act="feed">feed</button><button data-act="pet">pet</button></div>`;
  el.querySelector(".stage").onclick = () => send("pet", p.id);
  el.querySelector('[data-act="feed"]').onclick = () => send("feed", p.id);
  el.querySelector('[data-act="pet"]').onclick = () => send("pet", p.id);
  document.getElementById("pets").appendChild(el);
  return { el, ctx: el.querySelector("canvas").getContext("2d"), items: "" };
}

function paint(ctx, p, w, h) {
  ctx.clearRect(0, 0, w, h);
  for (let i = 0; i < p.px.length; i++) {
    const ch = p.px[i];
    if (ch === ".") continue;
    ctx.fillStyle = p.pal[SYMBOLS.indexOf(ch)];
    ctx.fillRect(i % w, (i / w) | 0, 1, 1);
  }
}

function show(state) {
  const root = document.getElementById("pets");
  const hatch = document.getElementById("hatch");
  hatch.style.display = state.waiting.length && !document.body.classList.contains("round") && !document.body.classList.contains("bare") ? "" : "none";
  if (state.waiting.length) { hatch.firstChild.textContent = "hatch a pet for another GPU"; hatch.firstChild.onclick = () => send("hatch"); }
  const pets = only === null ? state.pets : state.pets.filter((p, i) => String(i) === only || p.id === only);
  if (pets.length && root.querySelector(".empty")) root.innerHTML = "";
  for (const p of pets) {
    if (!cards.has(p.id)) cards.set(p.id, card(p, state.w, state.h));
    const c = cards.get(p.id), el = c.el;
    paint(c.ctx, p, state.w, state.h);
    el.querySelector(".say").innerHTML = p.line ? `<div class="bubble"></div>` : "";
    if (p.line) el.querySelector(".bubble").textContent = p.line;
    el.querySelector(".name").innerHTML = `<span></span> <small></small>`;
    el.querySelector(".name span").textContent = p.name;
    el.querySelector(".name small").textContent = `· ${p.gpu} · ${p.age}`;
    el.querySelector(".mood").textContent = p.label;
    const bar = el.querySelector(".bar i");
    bar.style.width = Math.min(100, p.pct) + "%";
    bar.style.background = level(p.pct, 70, 90);
    el.querySelector(".vram").innerHTML = `VRAM <b>${p.used.toFixed(1)}</b>/${p.total} GB`;
    el.querySelector(".vitals").innerHTML = p.temp ? `<b style="color:${level(p.temp, 70, 82)}">${p.temp}°C</b> · ${p.power} W · ${p.util}%` : `${p.util}% busy`;
    el.querySelector(".ate").innerHTML = `ate <b>${p.today}</b> tokens today · ${p.ever} ever`;
    el.querySelector(".rate").innerHTML = p.rate > 1 ? `<b style="color:var(--warn)">${p.rate} tok/s</b>` : "";
    const key = p.items.map(i => i[0]).join() + "|" + p.wearing;
    if (key !== c.items) {
      c.items = key;
      const box = el.querySelector(".wardrobe");
      box.innerHTML = "";
      for (const [id, label] of [[null, "nothing"], ...p.items]) {
        const b = document.createElement("button");
        b.textContent = label;
        if (p.wearing === id) b.className = "on";
        b.onclick = () => send("wear", p.id, id);
        box.appendChild(b);
      }
    }
    if (layout === "round") {
      const arc = document.getElementById("arc");
      arc.setAttribute("stroke-dasharray", `${(Math.min(100, p.pct) / 100 * 298.5).toFixed(1)} 299`);
      arc.setAttribute("stroke", p.pct >= 90 ? "#f0584c" : p.pct >= 70 ? "#f5c84a" : "#7bd36a");
    }
  }
}

function listen() {
  const es = new EventSource("/events");
  es.onmessage = e => show(JSON.parse(e.data));
  es.onerror = () => { es.close(); setTimeout(listen, 2000); };
}
listen();
</script>
</body>
</html>
"""
