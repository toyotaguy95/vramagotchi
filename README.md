# VRAMagotchi

A pet that lives on your GPU.

![Two VRAMagotchi pets reacting to GPU load](docs/demo.gif)

It gets fat on VRAM, eats the tokens your local model generates, sweats when the card runs hot,
faints when memory runs out, and falls asleep when nothing is happening.

## Try it

No GPU needed for the demo:

```
uvx --from git+https://github.com/toyotaguy95/vramagotchi vramagotchi --demo
```

On your own machine (NVIDIA on Linux or WSL; Macs are experimental):

```
uvx --from git+https://github.com/toyotaguy95/vramagotchi vramagotchi
```

Or without `uv`:

```
git clone https://github.com/toyotaguy95/vramagotchi && cd vramagotchi
python3 -m vramagotchi --demo
```

There is nothing to configure. The first run gives you one egg, on the card running your model. Press `h` to hatch it. If you
have more cards, press `n` to hatch a pet for each. The view scales with your terminal window.

The core, the terminal view and the web page use only the Python standard library.

## What the pets react to

| What the card does | What the pet does |
|---|---|
| VRAM fills up | gets wider; "stuffed" above 85% |
| Your model generates tokens | tokens fly into its mouth; lifetime count goes up |
| Other GPU work (rendering, training) | works out, with a sweatband |
| Temperature climbs | turns red and sweats at 72°C, catches fire at 85°C, wears an ice pack afterwards |
| VRAM hits 98.5% | faints, and its ghost floats off |
| Nothing for 20 seconds | puts on a nightcap and sleeps |

Token counts come from a llama.cpp server's `/slots` endpoint (looked for on ports 8080 and 8000, or
pass `--llm URL`). Without one the pets still react to load, memory and heat.

## Keys

`f` feed (your own model writes the pet's reply) · `p` pet · `a` dress up · `n` hatch a pet for another GPU · `tab` next pet · `q` quit

## Accessories

Every pet starts with a bow, a flower, glasses and a propeller cap. The rest are earned by what the
card actually does:

| Accessory | Earned by |
|---|---|
| headphones | eating 10k tokens |
| wizard hat | eating 100k tokens |
| crown | eating a million tokens |
| top hat | eating ten million tokens |
| sunglasses | surviving 85°C |
| bandage | running out of memory and living |

## Other ways to watch them

**In a browser:** `python3 -m vramagotchi --web` opens the pets as a web page on your own computer, at
`http://127.0.0.1:8377`. Nothing leaves your computer and nobody else can see it, unless you choose to
share it with `--host`. Useful address options:

- `?pet=0` shows one pet
- `?layout=round` fits a round cooler screen, with VRAM as a ring around the edge
- `?bare&bg=transparent` is just the pet, for an OBS browser source

**On an NZXT Kraken Z cooler screen:** `python3 -m vramagotchi --lcd` (needs `liquidctl` and Pillow).
That screen plays images stored in the cooler's own memory, so each mood is stored once as a short GIF
and the program then only tells the cooler which one to play. The stored pictures are rewritten only
when the pet's name or accessory changes. `--lcd-remove` puts the stock temperature screen back and
deletes only the pictures this program stored.

**Without a terminal:** `python3 -m vramagotchi --serve --web --lcd` runs in the background.

## Not done yet

Help is welcome on any of these:

- Macs: memory and GPU load are read, but it is untested on real hardware and macOS gives no temperature
- AMD and Intel cards
- Token counts from Ollama and LM Studio (the pet reacts to load, but only eats with a llama.cpp server)
- Native Windows terminal (works in WSL)
- Other cooler screens
- More species and accessories

Pets remember their name, age, tokens eaten and wardrobe in `~/.local/state/vramagotchi/state.json`.

MIT licensed.
