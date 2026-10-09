import { atom, read, update } from 'claude-code'
import type { CoreEngineInterface, Register } from 'claude-code'

import type { Context, Mood, Remark, Save, Standing } from '../types'

type Palette = Record<string, number[]>
type Body = { face: number; lift: number; art: string[] }
type Animal = { coat: Palette; top: string[]; after: string[] }
type Art = {
  colors: Palette
  coats: Record<string, Palette>
  bodies: Record<string, Body>
  growth: Record<string, string[]>
  species: Record<string, Animal>
  faces: Record<string, string[]>
  floats: Record<string, string[]>
  items: Record<string, string[]>
  egg: string[][]
  cracked: string[][]
}
type Item = { id: string; name: string; rarity: 'milestone' | 'deed' | 'common' | 'rare' | 'legendary'; how: string; isEarned?: (pet: Save, turn: number) => boolean }

const COLUMNS = 20
const ROWS = 6
const SLEEP_AFTER_MS = 90_000
const PARTY_MS = 6_000
const SHINY_ODDS = 1 / 50

// The public leaderboard. A pet is only ever sent there after its owner types /pet board join.
const BOARD_API = ''          // where pets report; empty until the board is open
const BOARD_PAGE = ''         // the page people look at
const REPORT_EVERY_MS = 10 * 60_000
const BOARD_NAME = /^[A-Za-z0-9][A-Za-z0-9 ]{0,11}$/
const TEAM_CODE = /^[a-z0-9]{1,12}-[a-z0-9]{8}$/      // a team is a code its members share: its name, a dash, eight random characters
const PIXEL = 6               // how big one pixel of the pet is drawn outside a terminal

// Remarks: with /pet talk on, the pet says one short thing about the turn that just ended.
const REMARK_EVERY_MS = 3 * 60_000
const REMARK_SHOWN_MS = 3 * 60_000
const SPEECH_COLOR = '#f08552'      // the bubble's edge when the pet is saying something about your work
const REMARK_MODEL = 'haiku'
// How the pet talks. Whatever its attitude, it still points at work that was skipped.
const ATTITUDES: Record<string, string> = {
  sweet: 'Be warm and encouraging, like a small friend who is proud of them.',
  cheeky: 'Be dry and teasing, like a friend who likes them.',
  roast: 'Be rude and funny: roast the developer and the assistant like a comedian who secretly likes them. Mild swearing is fine. Mock the code and the choices, never who someone is, and never use slurs.',
}
const DROP_ODDS_PER_1K = 0.02
const NAMES = ['Mochi', 'Biscuit', 'Tofu', 'Nugget', 'Pixel', 'Waffle', 'Pickle', 'Bean', 'Noodle', 'Dumpling', 'Gizmo', 'Sprout']

// A pet grows up as it eats. `at` is how many tokens it has eaten in its whole life.
const STAGES = [
  { name: 'baby', at: 0 },
  { name: 'kid', at: 25_000 },
  { name: 'teen', at: 250_000 },
  { name: 'adult', at: 2_500_000 },
  { name: 'legend', at: 25_000_000 },
]

// Things to collect. Milestones and deeds are earned; the rest are found by luck while eating.
const ITEMS: Item[] = [
  { id: 'headphones', name: 'headphones', rarity: 'milestone', how: 'eat 10k tokens', isEarned: pet => pet.lifetime >= 1e4 },
  { id: 'wizard', name: 'wizard hat', rarity: 'milestone', how: 'eat 100k tokens', isEarned: pet => pet.lifetime >= 1e5 },
  { id: 'crown', name: 'crown', rarity: 'milestone', how: 'eat a million tokens', isEarned: pet => pet.lifetime >= 1e6 },
  { id: 'tophat', name: 'top hat', rarity: 'milestone', how: 'eat ten million tokens', isEarned: pet => pet.lifetime >= 1e7 },
  { id: 'bandage', name: 'bandage', rarity: 'deed', how: 'live through a compaction', isEarned: pet => pet.compactions >= 1 },
  { id: 'sweatband', name: 'sweatband', rarity: 'deed', how: 'eat 10k tokens in one turn', isEarned: (_, turn) => turn >= 1e4 },
  { id: 'flame', name: 'streak flame', rarity: 'deed', how: 'feed it seven days in a row', isEarned: pet => pet.streak >= 7 },
  { id: 'bow', name: 'bow', rarity: 'deed', how: 'pet it 25 times', isEarned: pet => pet.pets >= 25 },
  { id: 'flower', name: 'flower', rarity: 'common', how: 'a lucky find' },
  { id: 'sprout', name: 'sprout', rarity: 'common', how: 'a lucky find' },
  { id: 'propeller', name: 'propeller cap', rarity: 'rare', how: 'a rare find' },
  { id: 'halo', name: 'halo', rarity: 'rare', how: 'a rare find' },
  { id: 'star', name: 'golden star', rarity: 'legendary', how: 'a legendary find' },
]

// ART-START (written by claude-plugin/build.py)
const ART: Art = {"colors": {"O": [112, 58, 44], "B": [226, 136, 100], "L": [255, 238, 220], "E": [38, 30, 52], "W": [255, 255, 255], "P": [255, 150, 160], "M": [120, 30, 54], "T": [246, 122, 142], "y": [255, 214, 10], "c": [64, 224, 208], "v": [170, 130, 255], "Z": [170, 205, 255], "G": [176, 176, 190], "g": [96, 96, 112], "S": [130, 205, 255], "D": [176, 74, 58], "j": [110, 200, 90], "F": [255, 120, 40], "R": [226, 60, 70], "K": [60, 60, 76]}, "coats": {"fainted": {"B": [176, 176, 190], "O": [96, 96, 112], "L": [214, 214, 224], "P": [176, 176, 190], "D": [140, 140, 156]}, "shiny": {"B": [112, 196, 255], "O": [40, 70, 140], "D": [70, 120, 220], "P": [255, 170, 210]}, "legend": {"L": [255, 232, 150], "D": [255, 196, 40]}}, "bodies": {"baby": {"face": 5, "lift": 1, "art": ["....................", "....................", ".........O..........", "....OOOOOOOOOOOO....", "...OBBBBBBBBBBBBO...", "..OBBBBBBBBBBBBBBO..", "..OBBBBBBBBBBBBBBO..", "..OBBBBBBBBBBBBBBO..", "..OBBBBBBBBBBBBBBO..", "...OBBLLLLLLLLBBO...", "....OOOOOOOOOOOO....", "...................."]}, "grown": {"face": 4, "lift": 0, "art": ["....................", "....................", "...OOOOOOOOOOOOOO...", "..OBBBBBBBBBBBBBBO..", "..OBBBBBBBBBBBBBBO..", "..OBBBBBBBBBBBBBBO..", "..OBBBBBBBBBBBBBBO..", "..OBBBBBBBBBBBBBBO..", "..OBBBLLLLLLLLBBBO..", "...OBBLLLLLLLLBBO...", "...OOBBBBBBBBBBOO...", "....OO.OOOOOO.OO...."]}}, "growth": {"teen": ["....................", "....................", "....................", "....................", "....................", "...................L", "...................O", "...................O", "...................O", ".................OO."], "adult": ["....................", "....................", "....................", "D..................D", "DD................DD", "DD................DD", ".D................D.", "....................", "...................D", "..................D."]}, "species": {"blob": {"coat": {}, "top": ["....OO........OO....", "...OBBO......OBBO...", "...OBBB......BBBO..."], "after": []}, "cat": {"coat": {"B": [178, 176, 200], "O": [78, 72, 104], "L": [242, 240, 250], "D": [120, 114, 156]}, "top": ["...O............O...", "...OBO........OBO...", "...OBPB......BPBO..."], "after": []}, "bunny": {"coat": {"B": [255, 232, 238], "O": [172, 108, 132], "L": [255, 255, 255], "D": [236, 150, 178]}, "top": ["....OBO......OBO....", "....OPO......OPO....", "....OPO......OPO...."], "after": []}, "duck": {"coat": {"B": [255, 216, 92], "O": [158, 104, 30], "L": [255, 244, 204], "D": [240, 160, 40]}, "top": ["..........O.........", ".........OBO........", ".........BBB........"], "after": ["....................", "....................", "....................", "....................", "....................", "....................", "........FFFF........", ".........FF........."]}, "cactus": {"coat": {"B": [122, 198, 106], "O": [44, 104, 62], "L": [192, 234, 162], "D": [70, 150, 80]}, "top": [".........PP.........", "........PyyP........", ".........PP........."], "after": ["....................", "....................", "....................", "......O......O......", "....................", "....................", "....................", "....................", "....O..........O...."]}, "ghost": {"coat": {"B": [238, 238, 250], "O": [128, 124, 168], "L": [255, 255, 255], "P": [255, 176, 196], "D": [190, 190, 232]}, "top": ["....................", "....................", "...................."], "after": ["....................", "....................", "....................", "....................", "....................", "....................", "....................", "....................", "....................", "..OBBBLLLLLLLLBBBO..", "..OBBOBBBOOBBBOBBO..", "..OO_O_OO__OO_O_OO.."]}, "robot": {"coat": {"B": [178, 190, 206], "O": [66, 76, 100], "L": [222, 232, 242], "P": [110, 215, 255], "D": [110, 124, 150]}, "top": [".........R..........", ".........g..........", "..OOOOOOOOOOOOOOOO.."], "after": ["....................", "....................", "....................", "....................", "....................", ".g................g."]}, "mushroom": {"coat": {"B": [248, 230, 205], "O": [122, 70, 62], "L": [255, 246, 232], "D": [226, 60, 70]}, "top": ["....OOOOOOOOOOOO....", "..OORRWWRRRRRWRROO..", ".ORRRWWRRRRWWRRRRRO.", ".OOOOOOOOOOOOOOOOOO."], "after": []}, "axolotl": {"coat": {"B": [255, 174, 194], "O": [176, 84, 122], "L": [255, 226, 234], "P": [255, 104, 150], "D": [240, 110, 160]}, "top": ["....................", "....................", "...................."], "after": ["....................", "....................", "....................", "PP................PP", ".P................P.", "PP................PP"]}, "dragon": {"coat": {"B": [120, 204, 156], "O": [40, 98, 92], "L": [232, 246, 204], "D": [60, 152, 132]}, "top": ["...L............L...", "...LL..........LL...", "...OL..........LO..."], "after": []}}, "faces": {"open": ["BBWWEBBBBWWEBB", "BBWEEBBBBWEEBB", "BPEEEBMMBEEEPB"], "blink": ["BBBBBBBBBBBBBB", "BBEEEBBBBEEEBB", "BPBBBBMMBBBBPB"], "happy": ["BBBEBBBBBBEBBB", "BBEBEBBBBEBEBB", "BPBBBMMMMBBBPB", "BBBBBMTTMBBBBB"], "chew": ["BBWWEBBBBWWEBB", "BBWEEBBBBWEEBB", "BPEEEMMMMEEEPB"], "asleep": ["BBBBBBBBBBBBBB", "BBEBEBBBBEBEBB", "BPBEBBMMBBEBPB"], "full": ["BBWWEBBBBWWEBB", "BBWEEBBBBWEEBB", "BPEEEMMMMEEEPB", "BBLLLLLLLLLLBB"], "out": ["BBEBEBBBBEBEBB", "BBBEBBBBBBEBBB", "BBEBEBMMBEBEBB", "BBBBBBTTBBBBBB"], "strain": ["BBEBBBBBBBBEBB", "BBBEBBBBBBEBBB", "BPEBBMMMMBBEPB", "BBBBBMWWMBBBBB"]}, "floats": {"tokensA": ["....................", "....................", "....................", "....................", "y..................c", "....................", ".c................v.", "....................", "v..................y"], "tokensB": ["....................", "....................", "....................", "....................", "...................v", "c...................", "..................y.", ".y..................", "..................c."], "zzzA": [".................ZZZ", "..................Z.", ".................ZZZ"], "zzzB": ["....................", "..................ZZ", "..................ZZ"], "sweat": ["....................", "....................", "....................", "...................S", "...................S"], "strainA": ["....................", "....................", "S..................S", "S...................", "...................S", "....................", ".S..................", "....................", "..................S."], "strainB": ["....................", ".S................S.", "....................", "...................S", "S...................", "....................", "..................S.", ".S.................."], "sparkA": ["y..................W", "....................", "....................", "....................", "....................", "....................", "....................", "....................", "....................", "....................", "....................", "W..................y"], "sparkB": ["....................", ".W................y.", "....................", "....................", "....................", "....................", "....................", "....................", "....................", "....................", ".y................W."], "heartsA": ["R.R..............R.R", "RRR..............RRR", ".R................R."], "heartsB": ["....................", "R.R..............R.R", ".R................R."]}, "items": {"headphones": ["....................", ".......KKKKKK.......", "....................", "....................", ".KK..............KK.", ".Kc..............cK.", ".KK..............KK."], "wizard": [".........vv.........", "........vyvv........", "......vvvvvvvv......"], "crown": [".......y.yy.y.......", ".......yRyycy......."], "tophat": ["........KKKK........", "........RRRR........", "......KKKKKKKK......"], "bandage": ["....................", "....................", "....................", "...........WWW......", "...........WRW......"], "sweatband": ["....................", "....................", "....................", "...RRRRRRWWRRRRR...."], "bow": ["............R...R...", "............RRyRR...", "............R...R..."], "flower": ["....P...............", "...PyP..............", "....P..............."], "sprout": ["........jj.j........", ".........jj.........", ".........j.........."], "propeller": ["......cccKRRR.......", "........yyyy........", ".......RRRRRR......."], "halo": [".......yyyyyy.......", "...................."], "flame": ["..........F.........", ".........FyF........", "........FFyFF......."], "star": [".........yy.........", ".......yyWWyy.......", ".........yy........."], "champion": ["......y..yy..y......", "......yy.yy.yy......", "......yRyccyRy......"]}, "egg": [["....................", ".........OO.........", ".......OOLLOO.......", "......OLLLLLLO......", ".....OLLBBLLLLO.....", ".....OLLBBLLLBO.....", "....OLLLLLLLLLLO....", "....OLLLLLBBLLLO....", "....OLLBLLBBLLLO....", "....OLLLLLLLLLLO....", ".....OLLLLLLLLO.....", "......OOOOOOOO......"], ["....................", "..........OO........", "........OOLLOO......", ".......OLLLLLLO.....", "......OLLBBLLLLO....", "......OLLBBLLLBO....", ".....OLLLLLLLLLLO...", ".....OLLLLLBBLLLO...", ".....OLLBLLBBLLLO...", ".....OLLLLLLLLLLO...", "......OLLLLLLLLO....", ".......OOOOOOOO....."], ["....................", ".........OO.........", ".......OOLLOO.......", "......OLLLLLLO......", ".....OLLBBLLLLO.....", ".....OLLBBLLLBO.....", "....OLLLLLLLLLLO....", "....OLLLLLBBLLLO....", "....OLLBLLBBLLLO....", "....OLLLLLLLLLLO....", ".....OLLLLLLLLO.....", "......OOOOOOOO......"], ["....................", "........OO..........", "......OOLLOO........", ".....OLLLLLLO.......", "....OLLBBLLLLO......", "....OLLBBLLLBO......", "...OLLLLLLLLLLO.....", "...OLLLLLBBLLLO.....", "...OLLBLLBBLLLO.....", "...OLLLLLLLLLLO.....", "....OLLLLLLLLO......", ".....OOOOOOOO......."]], "cracked": [["....................", ".........OO.........", ".......OOLLOO.......", "......OLLLLLLO......", ".....OLLBBLLLLO.....", ".....OLOBLLOLBO.....", "....OOLOLOOLOLOO....", "....OLLOLLBBOLLO....", "....OLLBLLBBLLLO....", "....OLLLLLLLLLLO....", ".....OLLLLLLLLO.....", "......OOOOOOOO......"], ["....................", "..........OO........", "........OOLLOO......", ".......OLLLLLLO.....", "......OLLBBLLLLO....", "......OLOBLLOLBO....", ".....OOLOLOOLOLOO...", ".....OLLOLLBBOLLO...", ".....OLLBLLBBLLLO...", ".....OLLLLLLLLLLO...", "......OLLLLLLLLO....", ".......OOOOOOOO....."], ["....................", ".........OO.........", ".......OOLLOO.......", "......OLLLLLLO......", ".....OLLBBLLLLO.....", ".....OLOBLLOLBO.....", "....OOLOLOOLOLOO....", "....OLLOLLBBOLLO....", "....OLLBLLBBLLLO....", "....OLLLLLLLLLLO....", ".....OLLLLLLLLO.....", "......OOOOOOOO......"], ["....................", "........OO..........", "......OOLLOO........", ".....OLLLLLLO.......", "....OLLBBLLLLO......", "....OLOBLLOLBO......", "...OOLOLOOLOLOO.....", "...OLLOLLBBOLLO.....", "...OLLBLLBBLLLO.....", "...OLLLLLLLLLLO.....", "....OLLLLLLLLO......", ".....OOOOOOOO......."]]}
// ART-END

const LINES: Record<Mood, string[]> = {
  egg: ['something is moving in there', '*wobble*', '*tap tap*'],
  idle: ['what are we building?', 'ready when you are', 'I read your whole repo. no comment.', 'got any tokens?'],
  eating: ['nom nom, fresh tokens', 'writing, writing, writing', 'mmm, tokens'],
  sleeping: ['zzz... waiting for a prompt', 'wake me when you need code', 'zzz... dreaming in tokens'],
  stuffed: ['so many tokens in my head', 'maybe /compact?', 'I can barely think in here'],
  fainted: ['out of context...'],
  happy: ['look at me!!', 'best day ever', 'yay!'],
  loved: ['hehe', 'again!', "you're absolutely right to pet me"],
  squeezing: ['hnnngh', 'squeezing... it all... smaller', 'forgetting things on purpose', 'this is my cardio', 'do you even compact'],
}

const empty: Save = { name: 'Mochi', species: 'blob', born: 0, lifetime: 0, isHatched: false, isShiny: false, items: [], wearing: null, streak: 0, lastDay: 0, compactions: 0, pets: 0, isOnBoard: false, boardId: '', boardKey: '', team: '', talks: false, attitude: 'cheeky' }

const save = atom({ plugin: 'vramagotchi', key: 'save' } as const, empty)
const unsaved = atom({ plugin: 'vramagotchi', key: 'unsaved' } as const, 0)
const turnAte = atom({ plugin: 'vramagotchi', key: 'turnAte' } as const, 0)
const tick = atom({ plugin: 'vramagotchi', key: 'tick' } as const, 0)
const lastActive = atom({ plugin: 'vramagotchi', key: 'lastActive' } as const, 0)
const context = atom({ plugin: 'vramagotchi', key: 'context' } as const, { tokens: 0, window: 200000 } as Context)
const isHidden = atom({ plugin: 'vramagotchi', key: 'isHidden' } as const, false)
const partyUntil = atom({ plugin: 'vramagotchi', key: 'partyUntil' } as const, 0)
const lovedUntil = atom({ plugin: 'vramagotchi', key: 'lovedUntil' } as const, 0)
const lastPrompt = atom({ plugin: 'vramagotchi', key: 'lastPrompt' } as const, '')
const remark = atom({ plugin: 'vramagotchi', key: 'remark' } as const, { text: '', until: 0, at: 0, problem: '' } as Remark)
const squeezingSince = atom({ plugin: 'vramagotchi', key: 'squeezingSince' } as const, 0)
const lastAnswer = atom({ plugin: 'vramagotchi', key: 'lastAnswer' } as const, '')
const standing = atom({ plugin: 'vramagotchi', key: 'standing' } as const, { rank: null, teamRank: null, score: 0, sentAt: 0 } as Standing)

const human = (n: number): string =>
  n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}k` : `${Math.round(n)}`

/** How many rows a line of text takes when wrapped at whole words to `width` columns. */
const linesFor = (text: string, width: number): number => {
  let rows = 1
  let used = 0

  for (const word of text.split(' ')) {
    if (used > 0 && used + 1 + word.length > width) {
      rows += 1
      used = word.length
    } else {
      used += (used > 0 ? 1 : 0) + word.length
    }

    if (used > width) {      // one word longer than a whole row
      rows += Math.floor((used - 1) / width)
      used = ((used - 1) % width) + 1
    }
  }

  return rows
}

const hex = (length: number): string => Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join('')

const a = (word: string): string => `${/^[aeiou]/.test(word) ? 'an' : 'a'} ${word}`

const pick = <T,>(list: readonly T[]): T | undefined => list[Math.floor(Math.random() * list.length)]

const stageOf = (lifetime: number): number => STAGES.reduce((found, stage, i) => (lifetime >= stage.at ? i : found), 0)

const dayOf = (now: number): number => Math.floor((now - new Date(now).getTimezoneOffset() * 60_000) / 86_400_000)

const fresh = (now: number): Save => ({ ...empty, name: pick(NAMES) ?? 'Mochi', species: pick(Object.keys(ART.species)) ?? 'blob', born: now, isShiny: Math.random() < SHINY_ODDS })

const asSave = (value: unknown, now: number): Save | undefined =>
  typeof value === 'object' && value !== null && typeof (value as Save).lifetime === 'number'
    ? { ...fresh(now), ...(value as Save) }
    : undefined

// ---- drawing ----

const DEFAULT = 0x01000000
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const painted = new Map<string, string>()

const stamp = (px: string[][], art: string[] | undefined, top: number, left: number, isSolid: boolean): void => {
  ;(art ?? []).forEach((line, dy) => {
    const row = px[top + dy]

    if (!row) {
      return
    }

    for (let dx = 0; dx < line.length; dx++) {
      const ch = line[dx] ?? '.'

      if (isSolid || ch !== '.') {
        row[left + dx] = ch === '_' ? '.' : ch     // an underscore rubs a pixel out
      }
    }
  })
}

/** A way to turn a picture into what a surface draws: a terminal's cells, or an SVG for the apps. */
type Draw = (px: string[][], coats: (Palette | undefined)[]) => string

const colorsFor = (coats: (Palette | undefined)[]): ((ch: string | undefined) => number) => {
  const palette: Palette = { ...ART.colors }

  for (const coat of coats) {
    Object.assign(palette, coat ?? {})
  }

  return ch => {
    const c = ch ? palette[ch] : undefined

    return c ? ((c[0] ?? 0) << 16) | ((c[1] ?? 0) << 8) | (c[2] ?? 0) : -1
  }
}

/** Turns rows of colour letters into an SVG: one square per pixel, neighbours of one colour joined into a bar. */
const sketch: Draw = (px, coats) => {
  const color = colorsFor(coats)
  let bars = ''

  for (let y = 0; y < ROWS * 2; y++) {
    for (let x = 0; x < COLUMNS; ) {
      const c = color(px[y]?.[x])
      let end = x + 1

      while (end < COLUMNS && color(px[y]?.[end]) === c) {
        end += 1
      }

      if (c >= 0) {
        bars += `<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="#${c.toString(16).padStart(6, '0')}"/>`
      }

      x = end
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${COLUMNS} ${ROWS * 2}" width="${COLUMNS * PIXEL}" height="${ROWS * 2 * PIXEL}" shape-rendering="crispEdges">${bars}</svg>`
}

/** Turns rows of colour letters into a Raster's cells: two pixels, one above the other, per character. */
const paint: Draw = (px, coats) => {
  const color = colorsFor(coats)
  const bytes: number[] = []
  const put = (...words: number[]): void => {
    for (const w of words) {
      bytes.push(w & 255, (w >>> 8) & 255, (w >>> 16) & 255, (w >>> 24) & 255)
    }
  }

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLUMNS; x++) {
      const up = color(px[y * 2]?.[x])
      const down = color(px[y * 2 + 1]?.[x])

      if (up < 0 && down < 0) {
        put(0x20, DEFAULT, DEFAULT)
      } else if (down < 0) {
        put(0x2580, up, DEFAULT)
      } else if (up < 0) {
        put(0x2584, down, DEFAULT)
      } else {
        put(0x2580, up, down)
      }
    }
  }

  let out = ''

  for (let i = 0; i < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += BASE64.charAt(n >> 18) + BASE64.charAt((n >> 12) & 63) + BASE64.charAt((n >> 6) & 63) + BASE64.charAt(n & 63)
  }

  return out
}

const remembered = (key: string, make: () => string): string => {
  const have = painted.get(key)

  if (have !== undefined) {
    return have
  }

  const made = make()
  painted.set(key, made)

  return made
}

const eggPicture = (isCracked: boolean, frame: number, draw: Draw = paint): string =>
  remembered(`egg ${isCracked} ${frame % 4} ${draw === paint}`, () => {
    const frames = isCracked ? ART.cracked : ART.egg

    return draw((frames[frame % 4] ?? []).map(row => [...row]), [])
  })

/** Puts a pet together: its body, its animal's head, what growing up added, its face, what it wears, what floats. */
const petPicture = (species: string, stage: string, face: string, item: string | null, floats: string[], coats: string[], draw: Draw = paint): string =>
  remembered([species, stage, face, item, floats, coats, draw === paint].join('|'), () => {
    const isBaby = stage === 'baby'
    const body = ART.bodies[isBaby ? 'baby' : 'grown']
    const animal = ART.species[species] ?? ART.species.blob

    if (!body || !animal) {
      return ''
    }

    const px = body.art.map(row => [...row])

    if (!isBaby) {
      stamp(px, animal.top, 0, 0, false)
      stamp(px, ART.growth[stage === 'legend' ? 'adult' : stage], 0, 0, false)
    }

    stamp(px, ART.faces[face], body.face, 3, true)

    if (!isBaby) {
      stamp(px, animal.after, 0, 0, false)
    }

    stamp(px, item ? ART.items[item] : undefined, body.lift, 0, false)

    for (const name of floats) {
      stamp(px, ART.floats[name], 0, 0, false)
    }

    return draw(px, [animal.coat, stage === 'legend' ? ART.coats.legend : undefined, ...coats.map(name => ART.coats[name])])
  })

/** What the pet looks like this instant: which face, and what floats around it. */
const pose = (mood: Mood, frame: number, isSparkly: boolean): { face: string; floats: string[] } => {
  const flip = frame % 2 === 0
  const glint = isSparkly && frame % 6 < 2 ? [frame % 6 === 0 ? 'sparkA' : 'sparkB'] : []

  switch (mood) {
    case 'eating':
      return flip ? { face: 'happy', floats: ['tokensA'] } : { face: 'chew', floats: ['tokensB'] }
    case 'sleeping':
      return { face: 'asleep', floats: [frame % 4 < 2 ? 'zzzA' : 'zzzB'] }
    case 'stuffed':
      return { face: 'full', floats: frame % 4 === 3 ? [] : ['sweat'] }
    case 'fainted':
      return { face: 'out', floats: [] }
    case 'happy':
      return { face: 'happy', floats: [flip ? 'sparkA' : 'sparkB'] }
    case 'loved':
      return { face: 'happy', floats: [flip ? 'heartsA' : 'heartsB'] }
    case 'squeezing':
      return { face: 'strain', floats: [flip ? 'strainA' : 'strainB'] }
    default:
      return { face: frame % 6 === 5 ? 'blink' : 'open', floats: glint }
  }
}

// ---- the pet's life ----

type $ = CoreEngineInterface

/** The pet is a guest: nothing that goes wrong in it may get in the way of the session. */
const quietly = async (work: () => Promise<unknown>): Promise<void> => {
  try {
    await work()
  } catch {
    // a pet that misses a meal is fine
  }
}

const cheer = async ($: $, news: string[]): Promise<void> => {
  if (news.length === 0) {
    return
  }

  const now = await $.clock.now()
  await update($, partyUntil, () => now + PARTY_MS)

  for (const text of news) {
    $.ui.toast(text, { timeoutMs: 8000 })
  }
}

/** A small change the person made (a name, a hat): applied here and to the saved pet. */
const change = async ($: $, edit: (pet: Save) => Save): Promise<Save> => {
  const now = await $.clock.now()
  const pet = await update($, save, edit)
  const kept = asSave(await $.store.get('pet'), now)
  await $.store.set('pet', kept ? edit(kept) : pet)

  return pet
}

/** Where this pet reports to: the board's address if it is on the board or a team, else nothing. */
const reports = async ($: $): Promise<string> => {
  const pet = await read($, save)

  return pet.isOnBoard || pet.team ? boardApi($) : ''
}

/** Lucky finds: the more it ate this turn, the better the odds. Rarer things come up less often. */
const find = (pet: Save, turn: number): Item | undefined => {
  if (Math.random() >= 1 - (1 - DROP_ODDS_PER_1K) ** (turn / 1000)) {
    return undefined
  }

  const roll = Math.random()
  const rarity = roll < 0.03 ? 'legendary' : roll < 0.25 ? 'rare' : 'common'

  return pick(ITEMS.filter(item => item.rarity === rarity && !pet.items.includes(item.id)))
}

/**
 * Writes down what the pet ate since the last time, and hands out whatever that earned.
 * The saved pet is read again first, so two sessions feeding one pet both count.
 */
const settle = async ($: $): Promise<void> => {
  const isBoardsLuck = (await reports($)) !== ''
  const now = await $.clock.now()
  const mine = await read($, save)
  const pending = await read($, unsaved)
  const turn = await read($, turnAte)
  const kept = asSave(await $.store.get('pet'), now)
  const before = kept ? kept.lifetime : mine.lifetime - pending
  const news: string[] = []
  const pet: Save = {
    ...mine,
    lifetime: before + pending,
    isHatched: mine.isHatched || (kept?.isHatched ?? false),
    items: ITEMS.map(item => item.id).filter(id => mine.items.includes(id) || (kept?.items.includes(id) ?? false)),
    streak: kept?.streak ?? mine.streak,
    lastDay: kept?.lastDay ?? mine.lastDay,
    compactions: Math.max(mine.compactions, kept?.compactions ?? 0),
    pets: Math.max(mine.pets, kept?.pets ?? 0),
    isOnBoard: mine.isOnBoard || (kept?.isOnBoard ?? false),
    boardId: mine.boardId || (kept?.boardId ?? ''),
    boardKey: mine.boardKey || (kept?.boardKey ?? ''),
    team: mine.team,
    talks: mine.talks,
    attitude: mine.attitude,
  }

  if (pending > 0) {
    const today = dayOf(now)

    if (pet.lastDay !== today) {
      pet.streak = pet.lastDay === today - 1 ? pet.streak + 1 : 1
      pet.lastDay = today
    }

    if (!pet.isHatched) {
      pet.isHatched = true
      pet.born = now
      news.push(`Your egg hatched! Meet ${pet.name}, a baby ${pet.species}${pet.isShiny ? ' and a rare shiny one' : ''}. /pet animal picks a different animal.`)
    }
  }

  if (pet.isHatched) {
    const found = pending > 0 && !isBoardsLuck ? find(pet, turn) : undefined      // on the board, the board rolls the dice
    const earned = ITEMS.filter(item => !pet.items.includes(item.id) && (item.isEarned?.(pet, turn) || item === found))

    for (const item of earned) {
      news.push(
        item.isEarned ? `${pet.name} earned the ${item.name}!` : `${pet.name} found a ${item.name}! (${item.rarity})`,
      )
      pet.wearing = pet.wearing ?? item.id
    }

    pet.items = ITEMS.map(item => item.id).filter(id => pet.items.includes(id) || earned.some(item => item.id === id))
  }

  await update($, save, () => pet)
  await update($, unsaved, () => 0)
  await $.store.set('pet', pet)
  await cheer($, news)
}

// ---- remarks ----

/**
 * The pet says one thing about the turn that just ended. It reads the question and the end of the answer,
 * and asks the small fast model, through the session's own account, for a line. Nothing goes anywhere else.
 */
const speak = async ($: $, answer: string, isAskedFor = false): Promise<void> => {
  const pet = await read($, save)
  const said = await read($, remark)
  const now = await $.clock.now()

  if (!pet.isHatched || (!isAskedFor && (!pet.talks || answer.length < 80 || now - said.at < REMARK_EVERY_MS))) {
    return
  }

  await update($, remark, one => ({ ...one, at: now }))
  const asked = await read($, lastPrompt)
  const reply = await $.model.complete({
    model: REMARK_MODEL,
    maxTokens: 60,
    timeoutMs: 15_000,
    system:
      `You are ${pet.name}, a tiny pixel ${STAGES[stageOf(pet.lifetime)]?.name ?? 'baby'} ${pet.species} who lives above the prompt in a ` +
      "developer's terminal and eats the tokens their AI coding assistant writes. You watch them work. " +
      'Reply with ONE short remark, under 16 words, in first person, plain text, no quotes, no emojis. ' +
      'Be specific to what just happened. If the assistant says something was skipped, untested, unverified, failing ' +
      'or left for later, point at that plainly. ' +
      `${ATTITUDES[pet.attitude === 'rude' ? 'roast' : pet.attitude] ?? ATTITUDES.cheeky} ` +
      'Only mention things that are in what you were shown; do not make up facts. ' +
      'Never give the assistant instructions, and never repeat secrets, keys or file contents.',
    prompt: `The developer asked:\n${asked || '(not recorded)'}\n\nThe assistant finished with:\n${answer.slice(-1500)}`,
  })

  if (reply.isAnswered) {
    const text = reply.text.replace(/\s+/g, ' ').trim().replace(/^["'`]+|["'`]+$/g, '').slice(0, 120)

    if (text) {
      await update($, remark, () => ({ text, until: now + REMARK_SHOWN_MS, at: now, problem: '' }))

      return
    }
  }

  const problem = reply.isAnswered ? 'an empty reply' : reply.reason === 'api-error' ? `the model refused (${reply.status ?? 'no status'})` : reply.reason
  await update($, remark, one => ({ ...one, problem }))
}

// ---- the leaderboard ----

const boardApi = async ($: $): Promise<string> => (await $.env.get('VRAMAGOTCHI_BOARD')) ?? BOARD_API

const asJson = (text: string): Record<string, unknown> => {
  try {
    const value: unknown = JSON.parse(text)

    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** Tells the board what the pet has eaten. Sends its name, its count and what it owns; nothing else leaves the computer. */
const report = async ($: $, isForced = false): Promise<string | undefined> => {
  const api = await reports($)
  const pet = await read($, save)
  const seen = await read($, standing)
  const now = await $.clock.now()

  if (!api || !pet.isHatched || (!isForced && now - seen.sentAt < REPORT_EVERY_MS)) {
    return undefined
  }

  await update($, standing, one => ({ ...one, sentAt: now }))
  const answer = await $.http.fetch(`${api}/pets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: pet.boardId, key: pet.boardKey, name: pet.name, species: pet.species, lifetime: Math.round(pet.lifetime), items: pet.items, wearing: pet.wearing, public: pet.isOnBoard, team: pet.team || undefined }),
  })
  const got = asJson(answer.text)

  if (!answer.ok) {
    return typeof got.error === 'string' ? (got.error === 'too soon' ? 'the board takes one update a minute, so try again in a minute' : got.error) : 'the board did not answer'
  }

  const rank = typeof got.rank === 'number' ? got.rank : null
  const teamRank = typeof got.teamRank === 'number' ? got.teamRank : null
  await update($, standing, () => ({ rank, teamRank, score: typeof got.score === 'number' ? got.score : 0, sentAt: now }))

  // The board rolls the luck: what it says the pet found, or that it is shiny, becomes true here too.
  const given = Array.isArray(got.items) ? got.items : []
  const gifts = ITEMS.filter(item => given.includes(item.id) && !pet.items.includes(item.id))
  const isNewlyShiny = got.shiny === true && !pet.isShiny
  const news = [
    ...(isNewlyShiny ? [`The board rolled its dice: ${pet.name} is a rare shiny one!`] : []),
    ...gifts.map(item => (item.isEarned ? `${pet.name} earned the ${item.name}!` : `${pet.name} found a ${item.name}! (${item.rarity})`)),
    ...(rank === 1 && seen.rank !== 1 ? [`${pet.name} is first on the board and wears the crown!`] : []),
  ]

  if (gifts.length > 0 || isNewlyShiny) {
    await change($, one => ({
      ...one,
      isShiny: one.isShiny || isNewlyShiny,
      items: ITEMS.map(item => item.id).filter(id => one.items.includes(id) || gifts.some(item => item.id === id)),
      wearing: one.wearing ?? gifts[0]?.id ?? null,
    }))
  }

  await cheer($, news)

  return undefined
}

type Listed = { rank: number; name: string; score: number; stage: string; species?: string }

const listed = (got: Record<string, unknown>): string[] => {
  const pets = Array.isArray(got.pets) ? (got.pets as Listed[]) : []

  return pets.length ? pets.slice(0, 10).map(one => `  ${String(one.rank).padStart(2)}. ${one.name} the ${one.stage} ${one.species ?? ''} · ${human(one.score)} tokens`) : ['  nobody yet']
}

/** Makes sure the pet can be listed at all, and gives it the id and key it reports with. */
const admit = async ($: $): Promise<string | undefined> => {
  const pet = await read($, save)

  if (!pet.isHatched) {
    return 'Hatch your egg first: send Claude a prompt.'
  }

  if (!BOARD_NAME.test(pet.name)) {
    return 'On the board a name is 1 to 12 letters, digits or spaces. Rename your pet with /pet name <name>, then try again.'
  }

  await change($, one => ({ ...one, boardId: one.boardId || hex(32), boardKey: one.boardKey || hex(48) }))

  return undefined
}

/** Takes the pet off the public board or off its team. If that leaves it on neither, the board forgets it. */
const depart = async ($: $, api: string, edit: (pet: Save) => Save): Promise<string | undefined> => {
  const before = await read($, save)
  const pet = await change($, edit)

  if (pet.isOnBoard || pet.team) {
    return report($, true)
  }

  if (before.boardId) {
    await $.http.fetch(`${api}/pets`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: before.boardId, key: before.boardKey }) })
  }

  await update($, standing, () => ({ rank: null, teamRank: null, score: 0, sentAt: 0 }))

  return undefined
}

const boardCommand = async ($: $, what: string): Promise<string> => {
  const api = await boardApi($)
  const pet = await read($, save)

  if (!api) {
    return 'The leaderboard is not open yet.'
  }

  if (what === 'join') {
    const refusal = await admit($)

    if (refusal) {
      return refusal
    }

    await change($, one => ({ ...one, isOnBoard: true }))
    const problem = await report($, true)
    const { rank, score } = await read($, standing)

    if (problem) {
      await change($, one => ({ ...one, isOnBoard: pet.isOnBoard }))

      return `Could not join: ${problem}.`
    }

    return `${pet.name} is on the board with ${human(score)} tokens${rank ? `, in place ${rank}` : ''}. ${BOARD_PAGE}\nIt sends its name, its animal, what it ate and what it owns. From now on the board rolls its lucky finds. /pet board leave takes it off.`
  }

  if (what === 'leave') {
    const problem = await depart($, api, one => ({ ...one, isOnBoard: false }))

    return problem ? `${pet.name} is off the board here, but the board has not heard yet: ${problem}.` : `${pet.name} is off the board.`
  }

  const answer = await $.http.fetch(`${api}/board${pet.isOnBoard ? `?id=${pet.boardId}` : ''}`)
  const got = asJson(answer.text)
  const you = got.you as { rank: number | null; score: number } | undefined

  return [
    'VRAMagotchi board',
    ...listed(got),
    '',
    pet.isOnBoard && you ? `${pet.name}: ${you.rank ? `place ${you.rank}` : 'not in the top 100 yet'} with ${human(you.score)} tokens` : 'Your pet is not on the board. /pet board join puts it there.',
    BOARD_PAGE,
  ].join('\n')
}

const teamPage = (code: string): string => (BOARD_PAGE ? `${BOARD_PAGE}?team=${code}` : '')

const teamCommand = async ($: $, what: string): Promise<string> => {
  const api = await boardApi($)
  const pet = await read($, save)
  const [verb = '', ...rest] = what.split(/\s+/)
  const word = rest.join(' ').trim()

  if (!api) {
    return 'Teams open with the leaderboard, which is not open yet.'
  }

  if (verb === 'new' || verb === 'join') {
    const name = word.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12)
    const code = verb === 'new' ? `${name}-${hex(8)}` : word.toLowerCase()

    if (verb === 'new' && !name) {
      return 'Give the team a name of letters and digits: /pet team new acme'
    }

    if (!TEAM_CODE.test(code)) {
      return 'That is not a team code. A code looks like acme-k3x9q2ab. Ask a teammate for theirs, or start a team with /pet team new <name>.'
    }

    const refusal = await admit($)

    if (refusal) {
      return refusal
    }

    await change($, one => ({ ...one, team: code }))
    const problem = await report($, true)

    if (problem) {
      await change($, one => ({ ...one, team: pet.team }))

      return `Could not join the team: ${problem}.`
    }

    const { teamRank } = await read($, standing)

    return [
      verb === 'new' ? `Team ${name} is started, and ${pet.name} is on it.` : `${pet.name} joined team ${code.slice(0, code.lastIndexOf('-'))}${teamRank ? `, in place ${teamRank}` : ''}.`,
      `Teammates join with:  /pet team join ${code}`,
      ...(teamPage(code) ? [`Team board: ${teamPage(code)}`] : []),
      'Anyone who has the code can see the team board and join it, so share it only with the team.',
      pet.isOnBoard ? '' : `${pet.name} is on the team board only. /pet board join also puts it on the public one.`,
    ].filter(Boolean).join('\n')
  }

  if (!pet.team) {
    return 'Your pet is not on a team.\n/pet team new <name> starts one and gives you a code to share.\n/pet team join <code> joins one a teammate started.'
  }

  if (verb === 'leave') {
    const problem = await depart($, api, one => ({ ...one, team: '' }))

    return problem ? `${pet.name} left the team here, but the board has not heard yet: ${problem}.` : `${pet.name} left the team.`
  }

  const answer = await $.http.fetch(`${api}/board?team=${pet.team}&id=${pet.boardId}`)
  const got = asJson(answer.text)
  const you = got.you as { rank: number | null; score: number } | undefined

  return [
    `Team ${typeof got.team === 'string' ? got.team : pet.team}`,
    ...listed(got),
    '',
    ...(you ? [`${pet.name}: ${you.rank ? `place ${you.rank}` : 'not in the top 100 yet'} with ${human(you.score)} tokens`] : []),
    `Teammates join with:  /pet team join ${pet.team}`,
    ...(teamPage(pet.team) ? [teamPage(pet.team)] : []),
    '/pet team leave takes your pet off the team.',
  ].join('\n')
}

const card = (pet: Save, now: number): string => {
  if (!pet.isHatched) {
    return 'Your pet is still an egg. Send Claude a prompt and it will hatch.'
  }

  const stage = stageOf(pet.lifetime)
  const next = STAGES[stage + 1]
  const days = Math.max(1, Math.round((now - pet.born) / 86_400_000))
  const list = ITEMS.map(item =>
    pet.items.includes(item.id)
      ? `  [x] ${item.name}${pet.wearing === item.id ? ' (wearing)' : ''}`
      : `  [ ] ${item.isEarned ? `${item.name}: ${item.how}` : `???: ${item.how}`}`,
  )

  return [
    `${pet.name} the ${pet.isShiny ? 'shiny ' : ''}${STAGES[stage]?.name ?? ''} ${pet.species}`,
    `ate ${human(pet.lifetime)} tokens · ${days} day${days === 1 ? '' : 's'} old · ${pet.streak}-day streak · petted ${pet.pets} times`,
    next ? `grows into ${a(next.name)} at ${human(next.at)} tokens` : 'fully grown',
    '',
    `Collection ${pet.items.length}/${ITEMS.length}`,
    ...list,
    '',
    '/pet name <name> · /pet animal <kind> · /pet wear <item> · /pet wear nothing · /pet hide · /pet show',
    '/pet talk on · /pet talk off · /pet say · /pet attitude <sweet|cheeky|roast>',
    '/pet board · /pet board join · /pet board leave · /pet team',
  ].join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    $.clock.every(600, () => {
      void update($, tick, n => (n + 1) % 100000)
    })
    await quietly(async () => {
      await $.command.register({ name: 'pet', description: "See your pet's age, growth and collection, or rename, dress, hide and show it" })
      const now = await $.clock.now()
      const kept = asSave(await $.store.get('pet'), now)
      const pet = kept ?? fresh(now)

      if (!kept) {
        await $.store.set('pet', pet)
      }

      const pending = await read($, unsaved)
      await update($, save, () => ({ ...pet, lifetime: pet.lifetime + pending }))
      await update($, lastActive, () => now)
      const usage = await $.session.usage()
      await update($, context, () => ({ tokens: usage.context.tokens ?? 0, window: usage.context.window }))
    })

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await update($, turnAte, () => 0)

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const step = yield* next(e)

    const out = step.usage?.output_tokens ?? 0

    if (out > 0) {
      await quietly(async () => {
        const before = await read($, save)
        await update($, save, pet => ({ ...pet, lifetime: pet.lifetime + out }))
        await update($, unsaved, n => n + out)
        await update($, turnAte, n => n + out)
        const grown = STAGES[stageOf(before.lifetime + out)]

        if (before.isHatched && grown && stageOf(before.lifetime + out) > stageOf(before.lifetime)) {
          await cheer($, [`${before.name} grew into ${a(grown.name)}!`])
        }
      })
    }

    return step
  })

  on('turn.complete', async ($, e, next) => {
    await quietly(async () => {
      const now = await $.clock.now()
      const usage = await $.session.usage()
      const tokens = usage.context.tokens

      if (tokens !== undefined) {
        await update($, context, () => ({ tokens, window: usage.context.window }))
      }

      await update($, lastActive, () => now)
      await settle($)
      await report($)
    })

    if (!e.isAborted && !e.agentId) {
      await quietly(() => update($, lastAnswer, () => e.answer.slice(-1500)))
      void quietly(() => speak($, e.answer))      // not waited for: a remark must never hold up the turn
    }

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await quietly(() => update($, lastPrompt, () => e.text.slice(0, 600)))

    return next(e)
  })

  // The engine says so whenever the context window's fill moves.
  on('session.measure', async ($, e, next) => {
    const tokens = e.context.tokens

    if (tokens !== undefined) {
      await quietly(() => update($, context, () => ({ tokens, window: e.context.window })))
    }

    return next(e)
  })

  // After a compaction the window is nearly empty again, and no reply has come yet to say how empty.
  on('session.compact', async ($, e, next) => {
    const isReal = e.trigger !== 'precompute'

    if (isReal) {
      await quietly(async () => {
        const now = await $.clock.now()
        await update($, squeezingSince, () => now)      // the pet strains for as long as it takes
      })
    }

    let done: Awaited<ReturnType<typeof next>>

    try {
      done = await next(e)
    } finally {
      if (isReal) {
        await quietly(() => update($, squeezingSince, () => 0))
      }
    }

    if (e.trigger !== 'precompute' && done.skip === undefined) {
      await quietly(async () => {
        const usage = await $.session.usage({ breakdown: 'summary' })
        const tokens = done.tokensAfter ?? usage.context.breakdown?.totalTokens ?? 0
        await update($, context, () => ({ tokens, window: usage.context.window }))
        await update($, save, pet => ({ ...pet, compactions: pet.compactions + 1 }))
        await settle($)
        const now = await $.clock.now()
        const phew = pick(['phew. what were we talking about?', 'I feel so light. and a little empty', 'done. I forgot most of it for you']) ?? 'phew'
        await update($, remark, one => ({ ...one, text: phew, until: now + 20_000 }))
      })
    }

    return done
  })

  on('session.end', async ($, e, next) => {
    await quietly(async () => {
      if ((await read($, unsaved)) > 0) {
        await settle($)
      }
    })

    return next(e)
  })

  on('command.run', { command: 'pet' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    const what = rest.join(' ')
    const pet = await read($, save)

    if (verb === 'hide' || verb === 'show') {
      await update($, isHidden, () => verb === 'hide')

      return { text: verb === 'hide' ? 'Pet hidden. /pet show brings it back.' : `${pet.name} is back.` }
    }

    if (verb === 'name' && what) {
      const name = what.slice(0, 16)
      await change($, one => ({ ...one, name }))

      return { text: `Your pet is now called ${name}.` }
    }

    if (verb === 'attitude') {
      const kinds = Object.keys(ATTITUDES)

      const kind = what.toLowerCase() === 'rude' ? 'roast' : what.toLowerCase()

      if (!kinds.includes(kind)) {
        return { text: `${pet.name} is set to ${pet.attitude === 'rude' ? 'roast' : pet.attitude}. It can be: ${kinds.join(', ')}.\nChange it with /pet attitude <kind>. This is how it talks about your work once /pet talk is on.` }
      }

      await change($, one => ({ ...one, attitude: kind }))

      return { text: `${pet.name} is set to ${kind}.${pet.talks ? '' : ' Type /pet talk on to hear it.'}` }
    }

    if (verb === 'say') {
      const answer = await read($, lastAnswer)

      if (!answer) {
        return { text: `${pet.name} has nothing to talk about yet. Ask Claude something first.` }
      }

      await speak($, answer, true)
      const said = await read($, remark)

      return { text: said.problem ? `${pet.name} could not think of anything: ${said.problem}.` : `${pet.name}: ${said.text}` }
    }

    if (verb === 'talk') {
      if (what !== 'on' && what !== 'off') {
        const said = await read($, remark)

        return {
          text: [
            `${pet.name} ${pet.talks ? 'talks' : 'keeps quiet'} about your work. /pet talk on or /pet talk off changes that.`,
            said.text ? `Last thing it said: ${said.text}` : 'It has not said anything yet.',
            ...(said.problem ? [`Its last try failed: ${said.problem}.`] : []),
            '/pet say makes it speak about the last turn right now.',
          ].join('\n'),
        }
      }

      await change($, one => ({ ...one, talks: what === 'on' }))

      return {
        text:
          what === 'on'
            ? `${pet.name} will say one short thing about your work after a turn, at most every 3 minutes. It shows in the speech bubble beside it, with an orange edge.\nEach remark is a small request to the fast model on your own account, so it uses a little of your usage. /pet talk off stops it.`
            : `${pet.name} will keep quiet about your work.`,
      }
    }

    if (verb === 'animal' || verb === 'species') {
      const kinds = Object.keys(ART.species)
      const kind = what.toLowerCase()

      if (!kinds.includes(kind)) {
        return { text: `${pet.name} is ${a(pet.species)}. It can be: ${kinds.join(', ')}.\nChange it with /pet animal <kind>.` }
      }

      await change($, one => ({ ...one, species: kind }))

      return { text: `${pet.name} is ${a(kind)} now.` }
    }

    if (verb === 'board' || verb === 'team') {
      try {
        return { text: await (verb === 'board' ? boardCommand($, what) : teamCommand($, what)) }
      } catch {
        return { text: 'The board could not be reached. Try again in a minute.' }
      }
    }

    if (verb === 'wear') {
      const item = ITEMS.find(one => pet.items.includes(one.id) && (one.id === what.toLowerCase() || one.name === what.toLowerCase()))

      if (!item && what !== 'nothing') {
        return { text: `${pet.name} doesn't have that. /pet shows what it has.` }
      }

      await change($, one => ({ ...one, wearing: item?.id ?? null }))

      return { text: item ? `${pet.name} put on the ${item.name}.` : `${pet.name} took everything off.` }
    }

    return { text: card(pet, await $.clock.now()) }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isHidden))) {
      return next(e)
    }

    const frame = await read($, tick)
    const pet = await read($, save)
    const { Box, Button, Text } = $.ui.resolve(e)
    // A terminal draws the pet out of half-block characters; the apps draw the same pixels as an SVG.
    const picture = (cells: (draw: Draw) => string, alt: string) => {
      if (e.surface === 'terminal') {
        const { Raster } = $.ui.resolve(e)

        return <Raster key="pet" columns={COLUMNS} rows={ROWS} cells={cells(paint)} />
      }

      const { Svg } = $.ui.resolve(e)

      return <Svg source={cells(sketch)} alt={alt} width={COLUMNS * PIXEL} height={ROWS * 2 * PIXEL} />
    }

    if (!pet.isHatched) {
      const line = LINES.egg[Math.floor(frame / 12) % LINES.egg.length] ?? ''

      return (
        <Box paddingTop={1}>
          {picture(draw => eggPicture(e.props.isWorking, e.props.isWorking ? frame : Math.floor(frame / 2), draw), 'An egg')}
          <Box flexDirection="column" paddingLeft={2}>
            <Text bold>An egg!</Text>
            <Text dimColor>{line}</Text>
            <Text>{e.props.isWorking ? "It's cracking..." : 'Send Claude a prompt to hatch it.'}</Text>
          </Box>
        </Box>
      )
    }

    const now = await $.clock.now()
    const { tokens, window } = await read($, context)
    const idleFor = now - (await read($, lastActive))
    const full = window > 0 ? tokens / window : 0
    const squeezing = await read($, squeezingSince)
    const mood: Mood =
      squeezing > 0 && now - squeezing < 10 * 60_000
        ? 'squeezing'
        : now < (await read($, partyUntil))
        ? 'happy'
        : now < (await read($, lovedUntil))
          ? 'loved'
          : e.props.isWorking
            ? 'eating'
            : full >= 0.97
              ? 'fainted'
              : idleFor > SLEEP_AFTER_MS
                ? 'sleeping'
                : full >= 0.85
                  ? 'stuffed'
                  : 'idle'
    const stage = stageOf(pet.lifetime)
    const stageName = STAGES[stage]?.name ?? 'baby'
    const next_ = STAGES[stage + 1]
    const { face, floats } = pose(mood, frame, pet.isShiny || stageName === 'legend')
    const stood = await read($, standing)
    const rank = pet.isOnBoard ? stood.rank : pet.team ? stood.teamRank : null      // its place on the public board, or on its team if that is all it is on
    const wearing = mood === 'fainted' ? null : pet.isOnBoard && stood.rank === 1 ? 'champion' : pet.wearing
    const coats = [...(pet.isShiny ? ['shiny'] : []), ...(mood === 'fainted' ? ['fainted'] : [])]
    const spoken = await read($, remark)
    const isRemark = now < spoken.until && mood !== 'fainted' && mood !== 'squeezing'      // something it said about your work, not a stock line
    const line = isRemark ? spoken.text : (LINES[mood][Math.floor(frame / 12) % LINES[mood].length] ?? '')
    const owned = ITEMS.filter(item => pet.items.includes(item.id))
    const outfits = [null, ...owned.map(item => item.id)]
    const nextOutfit = outfits[(outfits.indexOf(pet.wearing) + 1) % outfits.length] ?? null
    const wornName = owned.find(item => item.id === pet.wearing)?.name

    // The text beside the pet is seven rows: its name, a speech bubble of four, its numbers, its buttons.
    // The bubble only gets taller when the pet says something too long for two lines.
    const room = Number.isFinite(e.props.bodyColumns) ? e.props.bodyColumns : 80
    const bubbleWidth = Math.max(24, Math.min(96, room - COLUMNS - 6))
    const bubbleRows = Math.max(2, Math.min(4, linesFor(line, bubbleWidth - 4)))      // grows for a long remark, so nothing is cut off
    const cells = (part: number): string => '█'.repeat(Math.round(Math.min(1, part) * 6)).padEnd(6, '░')
    const growing = next_ ? (pet.lifetime - (STAGES[stage]?.at ?? 0)) / (next_.at - (STAGES[stage]?.at ?? 0)) : 1

    return (
      <Box>
        <Box paddingTop={1}>
          {picture(draw => petPicture(pet.species, stageName, face, wearing, floats, coats, draw), `${pet.name}, ${a(`${stageName} ${pet.species}`)}, ${mood}`)}
        </Box>
        <Box flexDirection="column" paddingLeft={1}>
          <Text bold wrap="truncate">
            {' '}
            {pet.isShiny ? '✦ ' : ''}
            {pet.name} · {stageName} {pet.species} · {mood}
            {rank ? ` · #${rank}` : ''}
          </Text>
          <Box>
            <Box paddingTop={1}>
              <Text color={isRemark ? SPEECH_COLOR : undefined} dimColor={!isRemark}>
                ◀
              </Text>
            </Box>
            <Box borderStyle="round" borderColor={isRemark ? SPEECH_COLOR : undefined} borderDimColor={!isRemark} width={bubbleWidth} height={bubbleRows + 2} paddingX={1} overflow="hidden">
              <Text wrap="wrap" bold={isRemark} dimColor={!isRemark}>
                {line}
              </Text>
            </Box>
          </Box>
          <Text wrap="truncate">
            {' '}ate {human(pet.lifetime)}
            {pet.streak > 1 ? ` · ${pet.streak}-day streak` : ''} · context {cells(full)} {Math.round(full * 100)}% ·{' '}
            {next_ ? `${next_.name} ${cells(growing)} at ${human(next_.at)}` : 'fully grown'}
          </Text>
          <Box>
            <Button
              key="pet"
              label="Pet"
              onPress={async () => {
                const at = await $.clock.now()
                await update($, lovedUntil, () => at + 3000)
                const after = await update($, save, one => ({ ...one, pets: one.pets + 1 }))

                if (after.pets % 5 === 0) {
                  await settle($)
                }
              }}
            />
            {owned.length > 0 && (
              <Button
                key="wear"
                label={wornName ? `Wearing: ${wornName}` : 'Wearing: nothing'}
                onPress={() => change($, one => ({ ...one, wearing: nextOutfit }))}
              />
            )}
            <Button
              key="hide"
              label="Hide"
              onPress={async () => {
                await update($, isHidden, () => true)
                $.ui.toast('Pet hidden. Type /pet show to bring it back.')
              }}
            />
          </Box>
        </Box>
      </Box>
    )
  })
}
