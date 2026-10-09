import { atom, read, update } from 'claude-code'
import type { CoreEngineInterface, Register } from 'claude-code'

import type { Blackjack, Catch, Context, Game, Mood, Remark, Save, Standing } from '../types'

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
// The memory game: the pet shows shapes one at a time, and you press them back in the same order.
const SHAPES = [
  { mark: '▲', color: '#e23c46' },
  { mark: '●', color: '#ffd60a' },
  { mark: '■', color: '#40e0d0' },
  { mark: '◆', color: '#aa82ff' },
]
// The catch game: tokens fall, and you slide the pet under them.
const FIELD = { columns: 40, rows: 9 }      // the playing field, in terminal cells; twice as many pixels tall
const SKY = 6                 // pixels of sky above the pet's head
const SLIDE = 4               // pixels the pet moves for one press
const PLACES = (FIELD.columns - COLUMNS) / SLIDE + 1
const STEP_MS = 250           // how often the tokens fall
const MISSES = 3              // tokens that may hit the ground before the game is over
const TICKS = 100_000         // the frame counter starts over at this
const WINDOW = 'pet'          // the id of the pet's own window
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
const DROP_ODDS_PER_1K = 0.005      // a find about every 200k tokens
const LEGENDARY_ODDS = 0.01         // of those finds, one in a hundred is legendary: about once in 20M tokens
const RARE_ODDS = 0.12              // and about one in eight is rare
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
  playing: ['watch closely'],
  squeezing: ['hnnngh', 'squeezing... it all... smaller', 'forgetting things on purpose', 'this is my cardio', 'do you even compact'],
}

const empty: Save = { name: 'Mochi', species: 'blob', born: 0, lifetime: 0, isHatched: false, isShiny: false, items: [], wearing: null, streak: 0, lastDay: 0, compactions: 0, pets: 0, isOnBoard: false, boardId: '', boardKey: '', team: '', talks: false, attitude: 'cheeky', bestMemory: 0, bestCatch: 0, bestBlackjack: 0 }

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
const game = atom({ plugin: 'vramagotchi', key: 'game' } as const, { isOn: false, sequence: [], step: 0, showFrom: 0, isOver: false } as Game)
const catching = atom({ plugin: 'vramagotchi', key: 'catching' } as const, { isOn: false, isOver: false, place: 0, tokens: [], caught: 0, missed: 0, steps: 0, ateAt: -9 } as Catch)
const table = atom({ plugin: 'vramagotchi', key: 'table' } as const, { isOn: false, isOver: false, you: [], pet: [], result: '', streak: 0 } as Blackjack)
const isBusy = atom({ plugin: 'vramagotchi', key: 'isBusy' } as const, false)
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
  const columns = px[0]?.length ?? 0
  let bars = ''

  for (let y = 0; y < px.length; y++) {
    for (let x = 0; x < columns; ) {
      const c = color(px[y]?.[x])
      let end = x + 1

      while (end < columns && color(px[y]?.[end]) === c) {
        end += 1
      }

      if (c >= 0) {
        bars += `<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="#${c.toString(16).padStart(6, '0')}"/>`
      }

      x = end
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${columns} ${px.length}" width="${columns * PIXEL}" height="${px.length * PIXEL}" shape-rendering="crispEdges">${bars}</svg>`
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

  for (let y = 0; y < px.length / 2; y++) {
    for (let x = 0; x < (px[0]?.length ?? 0); x++) {
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
const petPixels = (species: string, stage: string, face: string, item: string | null, floats: string[], coats: string[]): { px: string[][]; coats: (Palette | undefined)[] } => {
  const isBaby = stage === 'baby'
  const body = ART.bodies[isBaby ? 'baby' : 'grown']
  const animal = ART.species[species] ?? ART.species.blob

  if (!body || !animal) {
    return { px: [], coats: [] }
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

  return { px, coats: [animal.coat, stage === 'legend' ? ART.coats.legend : undefined, ...coats.map(name => ART.coats[name])] }
}

const petPicture = (species: string, stage: string, face: string, item: string | null, floats: string[], coats: string[], draw: Draw = paint): string =>
  remembered([species, stage, face, item, floats, coats, draw === paint].join('|'), () => {
    const pet = petPixels(species, stage, face, item, floats, coats)

    return pet.px.length ? draw(pet.px, pet.coats) : ''
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
type Site = Parameters<$['ui']['resolve']>[0]

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
  const rarity = roll < LEGENDARY_ODDS ? 'legendary' : roll < LEGENDARY_ODDS + RARE_ODDS ? 'rare' : 'common'

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
    bestMemory: Math.max(mine.bestMemory, kept?.bestMemory ?? 0),
    bestCatch: Math.max(mine.bestCatch, kept?.bestCatch ?? 0),
    bestBlackjack: Math.max(mine.bestBlackjack, kept?.bestBlackjack ?? 0),
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
    `ate ${human(pet.lifetime)} tokens · ${days} day${days === 1 ? '' : 's'} old · ${pet.streak}-day streak · petted ${pet.pets} times${pet.bestMemory > 0 ? ` · memory best ${pet.bestMemory}` : ''}${pet.bestCatch > 0 ? ` · catch best ${pet.bestCatch}` : ''}${pet.bestBlackjack > 0 ? ` · blackjack run ${pet.bestBlackjack}` : ''}`,
    next ? `grows into ${a(next.name)} at ${human(next.at)} tokens` : 'fully grown',
    '',
    `Collection ${pet.items.length}/${ITEMS.length}`,
    ...list,
    '',
    '/pet name <name> · /pet animal <kind> · /pet wear <item> · /pet wear nothing · /pet hide · /pet show · /pet window · /pet play',
    '/pet talk on · /pet talk off · /pet say · /pet attitude <sweet|cheeky|roast>',
    '/pet board · /pet board join · /pet board leave · /pet team',
  ].join('\n')
}

// ---- the memory game ----

const shape = (): number => Math.floor(Math.random() * SHAPES.length)

const startGame = async ($: $): Promise<void> => {
  const frame = await read($, tick)
  await update($, catching, one => ({ ...one, isOn: false }))
  await update($, table, one => ({ ...one, isOn: false }))
  await update($, game, () => ({ isOn: true, sequence: [shape()], step: 0, showFrom: frame, isOver: false }))
}

/** One press of a shape: the next one right moves on, the last one right adds a shape, a wrong one ends the game. */
const guess = async ($: $, pressed: number): Promise<void> => {
  const play = await read($, game)

  if (!play.isOn || play.isOver) {
    return
  }

  if (play.sequence[play.step] !== pressed) {
    const score = play.sequence.length - 1
    await update($, game, one => ({ ...one, isOver: true }))

    if (score > (await read($, save)).bestMemory) {
      await change($, pet => ({ ...pet, bestMemory: score }))
    }

    return
  }

  const frame = await read($, tick)
  await update($, game, one =>
    one.step + 1 < one.sequence.length ? { ...one, step: one.step + 1 } : { ...one, sequence: [...one.sequence, shape()], step: 0, showFrom: frame },
  )
}

/** The game in place of the pet's usual corner. It only reads the frame counter, so the showing needs no timer of its own. */
const drawGame = async ($: $, e: Site, pet: Save, play: Game, frame: number, picture: (face: string, floats: string[]) => ReturnType<typeof h>) => {
  const { Box, Button, Text } = $.ui.resolve(e)
  const since = (frame - play.showFrom + TICKS) % TICKS
  const length = play.sequence.length
  const isShowing = !play.isOver && since < 1 + length * 2           // a beat to get ready, then each shape for one beat with a gap after it
  const showing = isShowing && since >= 1 && (since - 1) % 2 === 0 ? SHAPES[play.sequence[(since - 1) / 2] ?? 0] : undefined
  const score = length - 1
  const face = play.isOver ? 'out' : isShowing ? 'open' : frame % 2 === 0 ? 'happy' : 'open'

  return (
    <Box>
      <Box paddingTop={1}>{picture(face, play.isOver ? [] : isShowing ? [] : [frame % 2 === 0 ? 'sparkA' : 'sparkB'])}</Box>
      <Box flexDirection="column" paddingLeft={1}>
        <Text bold wrap="truncate">
          {' '}
          {pet.name} · memory game · {play.isOver ? 'over' : `round ${length}`}
        </Text>
        <Box borderStyle="round" borderDimColor width={44} height={4} paddingX={1} overflow="hidden">
          {play.isOver ? (
            <Text wrap="wrap">
              {score > 0 ? `${pet.name} remembered ${score} in a row.` : `${pet.name} forgot the very first one.`} Best: {Math.max(score, pet.bestMemory)}.
            </Text>
          ) : isShowing ? (
            <Text>
              watch:{'   '}
              <Text bold color={showing?.color}>
                {showing?.mark ?? ' '}
              </Text>
            </Text>
          ) : (
            <Text>
              your turn:{'  '}
              {play.sequence.map((_, i) => (i < play.step ? `${SHAPES[play.sequence[i] ?? 0]?.mark ?? ''} ` : '· ')).join('')}
            </Text>
          )}
        </Box>
        <Text dimColor wrap="truncate">
          {' '}
          {play.isOver ? 'Playing never changes what your pet has eaten.' : isShowing ? 'Remember the order.' : 'Press them in the same order.'}
        </Text>
        <Box>
          {!play.isOver &&
            !isShowing &&
            SHAPES.map((one, i) => <Button key={`shape${i}`} label={one.mark} hotkey={`${i + 1}`} onPress={() => guess($, i)} />)}
          {play.isOver && <Button key="again" label="Again" hotkey="1" onPress={() => startGame($)} />}
          <Button key="quit" label={play.isOver ? 'Done' : 'Quit'} onPress={() => update($, game, one => ({ ...one, isOn: false }))} />
        </Box>
      </Box>
    </Box>
  )
}

// ---- the catch game ----

let falling: { cancel: () => void } | undefined      // the timer that makes the tokens fall while a game is on

/** One beat of the game: every token drops, the ones over the pet are eaten, the ones on the ground are lost, and now and then a new one appears. */
const fall = (now: Catch): Catch => {
  const speed = Math.min(3, 1 + Math.floor(now.caught / 8))
  const left = now.place * SLIDE + 2
  const kept: Catch['tokens'] = []
  let { caught, missed, ateAt } = now

  for (const token of now.tokens) {
    const y = token.y + speed

    if (y + 1 >= SKY + 2 && token.x + 1 >= left && token.x <= left + 15) {
      caught += 1
      ateAt = now.steps
    } else if (y + 1 >= FIELD.rows * 2 - 1) {
      missed += 1
    } else {
      kept.push({ ...token, y })
    }
  }

  if (now.steps % Math.max(3, 8 - Math.floor(now.caught / 4)) === 0) {
    kept.push({ x: 2 + 2 * Math.floor(Math.random() * ((FIELD.columns - 4) / 2)), y: 0, color: pick(['y', 'c', 'v']) ?? 'y' })
  }

  return { ...now, tokens: kept, caught, missed, ateAt, steps: now.steps + 1, isOver: missed >= MISSES }
}

const startCatch = async ($: $): Promise<void> => {
  falling?.cancel()
  await update($, game, one => ({ ...one, isOn: false }))
  await update($, table, one => ({ ...one, isOn: false }))
  await update($, catching, () => ({ isOn: true, isOver: false, place: Math.floor(PLACES / 2), tokens: [], caught: 0, missed: 0, steps: 0, ateAt: -9 }))
  falling = $.clock.every(STEP_MS, () => {
    void quietly(async () => {
      const before = await read($, catching)

      if (!before.isOn || before.isOver) {
        falling?.cancel()

        return
      }

      const after = await update($, catching, one => (one.isOn && !one.isOver ? fall(one) : one))

      if (after.isOver) {
        falling?.cancel()

        if (after.caught > (await read($, save)).bestCatch) {
          await change($, pet => ({ ...pet, bestCatch: after.caught }))
        }
      }
    })
  })
}

const slide = ($: $, by: number): Promise<Catch> =>
  update($, catching, one => (one.isOn && !one.isOver ? { ...one, place: Math.max(0, Math.min(PLACES - 1, one.place + by)) } : one))

/** The field: sky with falling tokens, and the pet at the bottom wherever it has been slid to. */
const fieldPicture = (pet: Save, stage: string, play: Catch, draw: Draw): string => {
  const face = play.isOver ? 'out' : play.steps - play.ateAt < 2 ? 'chew' : 'happy'
  const sprite = petPixels(pet.species, stage, face, pet.wearing, [], pet.isShiny ? ['shiny'] : [])
  const px = Array.from({ length: FIELD.rows * 2 }, () => Array.from({ length: FIELD.columns }, () => '.'))

  sprite.px.forEach((row, y) => {
    row.forEach((ch, x) => {
      const line = px[SKY + y]

      if (line && ch !== '.') {
        line[play.place * SLIDE + x] = ch
      }
    })
  })

  for (const token of play.tokens) {
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      const line = px[token.y + dy]

      if (line) {
        line[token.x + dx] = token.color
      }
    }
  }

  return draw(px, sprite.coats)
}

const drawCatch = async ($: $, e: Site, pet: Save, play: Catch, picture: (cells: (draw: Draw) => string, alt: string, columns: number, rows: number) => ReturnType<typeof h>) => {
  const { Box, Button, Text } = $.ui.resolve(e)
  const stage = STAGES[stageOf(pet.lifetime)]?.name ?? 'baby'

  return (
    <Box>
      {picture(draw => fieldPicture(pet, stage, play, draw), `${pet.name} catching tokens: ${play.caught} caught, ${play.missed} missed`, FIELD.columns, FIELD.rows)}
      <Box flexDirection="column" paddingLeft={2} paddingTop={1}>
        <Text bold>
          {pet.name} · catch game{play.isOver ? ' · over' : ''}
        </Text>
        <Text>
          caught {play.caught} · missed {'●'.repeat(play.missed).padEnd(MISSES, '○')}
        </Text>
        <Text dimColor>{play.isOver ? `Best: ${Math.max(play.caught, pet.bestCatch)}. Playing never changes what your pet has eaten.` : 'Slide under the falling tokens.'}</Text>
        <Box paddingTop={1}>
          {!play.isOver && <Button key="left" label="◀" hotkey="1" onPress={() => slide($, -1)} />}
          {!play.isOver && <Button key="right" label="▶" hotkey="2" onPress={() => slide($, 1)} />}
          {play.isOver && <Button key="again" label="Again" hotkey="1" onPress={() => startCatch($)} />}
          <Button
            key="quit"
            label={play.isOver ? 'Done' : 'Quit'}
            onPress={async () => {
              falling?.cancel()
              await update($, catching, one => ({ ...one, isOn: false }))
            }}
          />
        </Box>
      </Box>
    </Box>
  )
}

// ---- blackjack ----
// You against the pet, who deals. Nothing is bet: not tokens, not anything. A card is a number from 0 to 51.

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
const SUITS = ['♠', '♥', '♦', '♣']

const deal = (): number => Math.floor(Math.random() * 52)

const cardName = (card: number): string => `${RANKS[card % 13] ?? ''}${SUITS[Math.floor(card / 13)] ?? ''}`

/** What a hand is worth: an ace counts eleven until that would go over 21. */
const worth = (hand: number[]): number => {
  let total = 0
  let aces = 0

  for (const card of hand) {
    const rank = card % 13
    total += rank === 0 ? 11 : Math.min(10, rank + 1)
    aces += rank === 0 ? 1 : 0
  }

  while (total > 21 && aces > 0) {
    total -= 10
    aces -= 1
  }

  return total
}

/** Ends a hand: the pet draws to 17, then the higher hand that is not over 21 wins. */
const settleHand = (now: Blackjack): Blackjack => {
  const pet = [...now.pet]
  const mine = worth(now.you)

  while (mine <= 21 && worth(pet) < 17) {
    pet.push(deal())
  }

  const theirs = worth(pet)
  const result = mine > 21 ? 'lost' : theirs > 21 || mine > theirs ? 'won' : mine === theirs ? 'tied' : 'lost'

  return { ...now, pet, isOver: true, result, streak: result === 'won' ? now.streak + 1 : result === 'tied' ? now.streak : 0 }
}

const finishHand = async ($: $, after: Blackjack): Promise<void> => {
  if (after.isOver && after.streak > (await read($, save)).bestBlackjack) {
    await change($, pet => ({ ...pet, bestBlackjack: after.streak }))
  }
}

const startBlackjack = async ($: $): Promise<void> => {
  falling?.cancel()
  await update($, game, one => ({ ...one, isOn: false }))
  await update($, catching, one => ({ ...one, isOn: false }))
  const after = await update($, table, one => {
    const dealt: Blackjack = { isOn: true, isOver: false, you: [deal(), deal()], pet: [deal(), deal()], result: '', streak: one.streak }

    return worth(dealt.you) === 21 ? settleHand(dealt) : dealt
  })
  await finishHand($, after)
}

const hit = async ($: $): Promise<void> => {
  const after = await update($, table, one => {
    if (!one.isOn || one.isOver) {
      return one
    }

    const drawn = { ...one, you: [...one.you, deal()] }

    return worth(drawn.you) >= 21 ? settleHand(drawn) : drawn
  })
  await finishHand($, after)
}

const stand = async ($: $): Promise<void> => {
  await finishHand($, await update($, table, one => (one.isOn && !one.isOver ? settleHand(one) : one)))
}

const drawBlackjack = async ($: $, e: Site, pet: Save, play: Blackjack, frame: number, picture: (face: string, floats: string[]) => ReturnType<typeof h>) => {
  const { Box, Button, Text } = $.ui.resolve(e)
  const mine = worth(play.you)
  const said =
    play.result === 'won'
      ? mine === 21 && play.you.length === 2 ? 'Blackjack! You win.' : worth(play.pet) > 21 ? `${pet.name} went over. You win.` : 'You win.'
      : play.result === 'lost'
        ? mine > 21 ? `You went over. ${pet.name} wins.` : `${pet.name} wins.`
        : play.result === 'tied'
          ? 'A tie.'
          : 'Hit or stand?'
  const face = play.result === 'lost' ? 'happy' : play.result === 'won' ? 'out' : frame % 6 === 5 ? 'blink' : 'open'

  return (
    <Box>
      <Box paddingTop={1}>{picture(face, play.result === 'lost' ? [frame % 2 === 0 ? 'sparkA' : 'sparkB'] : [])}</Box>
      <Box flexDirection="column" paddingLeft={1}>
        <Text bold wrap="truncate">
          {' '}
          {pet.name} · blackjack{play.streak > 0 ? ` · ${play.streak} won in a row` : ''}
        </Text>
        <Box borderStyle="round" borderDimColor width={44} height={4} paddingX={1} flexDirection="column" overflow="hidden">
          <Text wrap="truncate">
            {pet.name}: {play.isOver ? `${play.pet.map(cardName).join(' ')}  (${worth(play.pet)})` : `${cardName(play.pet[0] ?? 0)} ??`}
          </Text>
          <Text wrap="truncate">
            You: {play.you.map(cardName).join(' ')}  ({mine})
          </Text>
        </Box>
        <Text wrap="truncate">
          {' '}
          {said}
          {play.isOver ? ` Best run: ${Math.max(play.streak, pet.bestBlackjack)}. Nothing is bet.` : ''}
        </Text>
        <Box>
          {!play.isOver && <Button key="hit" label="Hit" hotkey="1" onPress={() => hit($)} />}
          {!play.isOver && <Button key="stand" label="Stand" hotkey="2" onPress={() => stand($)} />}
          {play.isOver && <Button key="again" label="Deal again" hotkey="1" onPress={() => startBlackjack($)} />}
          <Button key="quit" label={play.isOver ? 'Done' : 'Quit'} onPress={() => update($, table, one => ({ ...one, isOn: false, streak: one.isOver ? one.streak : 0 }))} />
        </Box>
      </Box>
    </Box>
  )
}

/**
 * Draws the pet and everything beside it. The same drawing serves the band above the prompt (the terminal and
 * the desktop app) and the pet's own window (/pet window, for the apps that have no band).
 */
const drawPet = async ($: $, e: Site, isWorking: boolean, columns: number, isWindow: boolean) => {
  const frame = await read($, tick)
  const pet = await read($, save)
  const { Box, Button, Text } = $.ui.resolve(e)
  // A terminal draws the pet out of half-block characters; the apps draw the same pixels as an SVG.
  const picture = (cells: (draw: Draw) => string, alt: string, columns = COLUMNS, rows = ROWS) => {
    if (e.surface === 'terminal') {
      const { Raster } = $.ui.resolve(e)

      return <Raster key={columns === COLUMNS ? 'pet' : 'field'} columns={columns} rows={rows} cells={cells(paint)} />
    }

    const { Svg } = $.ui.resolve(e)

    return <Svg source={cells(sketch)} alt={alt} width={columns * PIXEL} height={rows * 2 * PIXEL} />
  }

  if (!pet.isHatched) {
    const line = LINES.egg[Math.floor(frame / 12) % LINES.egg.length] ?? ''

    return (
      <Box paddingTop={1}>
        {picture(draw => eggPicture(isWorking, isWorking ? frame : Math.floor(frame / 2), draw), 'An egg')}
        <Box flexDirection="column" paddingLeft={2}>
          <Text bold>An egg!</Text>
          <Text dimColor>{line}</Text>
          <Text>{isWorking ? "It's cracking..." : 'Send Claude a prompt to hatch it.'}</Text>
        </Box>
      </Box>
    )
  }

  const chase = await read($, catching)

  if (chase.isOn) {
    return drawCatch($, e, pet, chase, picture)
  }

  const play = await read($, game)
  const hand = await read($, table)

  if (play.isOn || hand.isOn) {
    const stageName = STAGES[stageOf(pet.lifetime)]?.name ?? 'baby'
    const sprite = (face: string, floats: string[]) =>
      picture(draw => petPicture(pet.species, stageName, face, pet.wearing, floats, pet.isShiny ? ['shiny'] : [], draw), `${pet.name} playing a game`)

    return hand.isOn ? drawBlackjack($, e, pet, hand, frame, sprite) : drawGame($, e, pet, play, frame, sprite)
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
        : isWorking
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
  const room = Number.isFinite(columns) ? columns : 80
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
          {!isWindow && (
            <Button
              key="hide"
              label="Hide"
              onPress={async () => {
                await update($, isHidden, () => true)
                $.ui.toast('Pet hidden. Type /pet show to bring it back.')
              }}
            />
          )}
        </Box>
      </Box>
    </Box>
  )
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
    await update($, isBusy, () => true)

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
      await update($, isBusy, () => false)
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

    if (verb === 'play') {
      if (!pet.isHatched) {
        return { text: 'Hatch your egg first: send Claude a prompt.' }
      }

      await update($, isHidden, () => false)

      if (what.toLowerCase() === 'catch') {
        await startCatch($)

        return {
          text: `Catch game: tokens fall, and ${pet.name} has to get under them. Slide it with the ◀ and ▶ buttons: click them, or type 1 for left and 2 for right. Three on the ground and it is over.\nBest so far: ${pet.bestCatch}. Playing never changes what your pet has eaten.`,
        }
      }

      if (what.toLowerCase() === 'blackjack') {
        await startBlackjack($)

        return {
          text: `Blackjack: you against ${pet.name}, who deals. Get closer to 21 than it does without going over. Hit takes a card, Stand stops: click them, or type 1 and 2.\nBest run of wins: ${pet.bestBlackjack}. Nothing is bet, and playing never changes what your pet has eaten.`,
        }
      }

      if (what.toLowerCase() !== 'memory') {
        return { text: `${pet.name} knows three games.\n/pet play blackjack: you against ${pet.name}. Best run of wins: ${pet.bestBlackjack}.\n/pet play memory: it shows shapes, you press them back in order. Best: ${pet.bestMemory}.\n/pet play catch: slide it under falling tokens. Best: ${pet.bestCatch}.\nPlaying never changes what your pet has eaten.` }
      }

      await startGame($)

      return {
        text: `Memory game: ${pet.name} shows some shapes one at a time. When it is your turn, press them in the same order: click them, or type their numbers, 1 to 4. Each round adds one.\nBest so far: ${pet.bestMemory}. Playing never changes what your pet has eaten.`,
      }
    }

    if (verb === 'window') {
      await $.ui.open({ id: WINDOW, title: pet.name })

      return { text: `${pet.name} has a window of its own now. It is for VS Code and the mobile app, where a pet cannot sit above the prompt.` }
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

    return drawPet($, e, e.props.isWorking, e.props.bodyColumns, false)
  })

  // VS Code and the mobile app have no band above the prompt, so there the pet lives in a window of its own.
  on('ui.render', { component: 'Pane', requestId: WINDOW }, async ($, e) => drawPet($, e, await read($, isBusy), e.props.bodyColumns, true))
}
