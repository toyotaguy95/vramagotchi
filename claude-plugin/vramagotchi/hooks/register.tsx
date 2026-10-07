import { atom, read, update } from 'claude-code'
import type { CoreEngineInterface, Register } from 'claude-code'

import type { Context, Mood, Save } from '../types'

type Body = { face: number; lift: number; coat: string | null; art: string[] }
type Art = {
  colors: Record<string, number[]>
  coats: Record<string, Record<string, number[]>>
  bodies: Record<string, Body>
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
const ART: Art = {"colors": {"O": [112, 58, 44], "B": [226, 136, 100], "L": [255, 238, 220], "E": [38, 30, 52], "W": [255, 255, 255], "P": [255, 150, 160], "M": [120, 30, 54], "T": [246, 122, 142], "y": [255, 214, 10], "c": [64, 224, 208], "v": [170, 130, 255], "Z": [170, 205, 255], "G": [176, 176, 190], "g": [96, 96, 112], "S": [130, 205, 255], "D": [176, 74, 58], "j": [110, 200, 90], "F": [255, 120, 40], "R": [226, 60, 70], "K": [60, 60, 76]}, "coats": {"fainted": {"B": [176, 176, 190], "O": [96, 96, 112], "L": [214, 214, 224], "P": [176, 176, 190], "D": [140, 140, 156]}, "shiny": {"B": [112, 196, 255], "O": [40, 70, 140], "D": [70, 120, 220], "P": [255, 170, 210]}, "legend": {"L": [255, 232, 150], "D": [255, 196, 40]}}, "bodies": {"baby": {"face": 5, "lift": 1, "coat": null, "art": ["....................", "....................", ".........O..........", "....OOOOOOOOOOOO....", "...OBBBBBBBBBBBBO...", "..OBBBBBBBBBBBBBBO..", "..OBBBBBBBBBBBBBBO..", "..OBBBBBBBBBBBBBBO..", "..OBBBBBBBBBBBBBBO..", "...OBBLLLLLLLLBBO...", "....OOOOOOOOOOOO....", "...................."]}, "kid": {"face": 4, "lift": 0, "coat": null, "art": ["....OO........OO....", "...OBBO......OBBO...", "...OBBBOOOOOOBBBO...", "..OBBBBBBBBBBBBBBO..", "..OBBBBBBBBBBBBBBO..", "..OBBBBBBBBBBBBBBO..", "..OBBBBBBBBBBBBBBO..", "..OBBBBBBBBBBBBBBO..", "..OBBBLLLLLLLLBBBO..", "...OBBLLLLLLLLBBO...", "...OOBBBBBBBBBBOO...", "....OO.OOOOOO.OO...."]}, "teen": {"face": 4, "lift": 0, "coat": null, "art": ["..O..............O..", "..OBO..........OBO..", "..OBBOOOOOOOOOOBBO..", "..OBBBBBBBBBBBBBBO..", "..OBBBBBBBBBBBBBBO..", "..OBBBBBBBBBBBBBBO.L", "..OBBBBBBBBBBBBBBO.O", "..OBBBBBBBBBBBBBBO.O", "..OBBBLLLLLLLLBBBO.O", "...OBBLLLLLLLLBBOOO.", "...OOBBBBBBBBBBOO...", "....OO.OOOOOO.OO...."]}, "adult": {"face": 4, "lift": 0, "coat": null, "art": ["...L............L...", "...LL..........LL...", "...OLOOOOOOOOOOLO...", "D.OBBBBBBBBBBBBBBO.D", "DDOBBBBBBBBBBBBBBODD", "DDOBBBBBBBBBBBBBBODD", ".DOBBBBBBBBBBBBBBOD.", "..OBBBBBBBBBBBBBBO..", "..OBBBLLLLLLLLBBBO.D", "...OBBLLLLLLLLBBOOD.", "...OOBBBBBBBBBBOO...", "....OO.OOOOOO.OO...."]}, "legend": {"face": 4, "lift": 0, "coat": "legend", "art": ["...L............L...", "...LL..........LL...", "...OLOOOOOOOOOOLO...", "D.OBBBBBBBBBBBBBBO.D", "DDOBBBBBBBBBBBBBBODD", "DDOBBBBBBBBBBBBBBODD", ".DOBBBBBBBBBBBBBBOD.", "..OBBBBBBBBBBBBBBO..", "..OBBBLLLLLLLLBBBO.D", "...OBBLLLLLLLLBBOOD.", "...OOBBBBBBBBBBOO...", "....OO.OOOOOO.OO...."]}}, "faces": {"open": ["BBWWEBBBBWWEBB", "BBWEEBBBBWEEBB", "BPEEEBMMBEEEPB"], "blink": ["BBBBBBBBBBBBBB", "BBEEEBBBBEEEBB", "BPBBBBMMBBBBPB"], "happy": ["BBBEBBBBBBEBBB", "BBEBEBBBBEBEBB", "BPBBBMMMMBBBPB", "BBBBBMTTMBBBBB"], "chew": ["BBWWEBBBBWWEBB", "BBWEEBBBBWEEBB", "BPEEEMMMMEEEPB"], "asleep": ["BBBBBBBBBBBBBB", "BBEBEBBBBEBEBB", "BPBEBBMMBBEBPB"], "full": ["BBWWEBBBBWWEBB", "BBWEEBBBBWEEBB", "BPEEEMMMMEEEPB", "BBLLLLLLLLLLBB"], "out": ["BBEBEBBBBEBEBB", "BBBEBBBBBBEBBB", "BBEBEBMMBEBEBB", "BBBBBBTTBBBBBB"]}, "floats": {"tokensA": ["....................", "....................", "....................", "....................", "y..................c", "....................", ".c................v.", "....................", "v..................y"], "tokensB": ["....................", "....................", "....................", "....................", "...................v", "c...................", "..................y.", ".y..................", "..................c."], "zzzA": [".................ZZZ", "..................Z.", ".................ZZZ"], "zzzB": ["....................", "..................ZZ", "..................ZZ"], "sweat": ["....................", "....................", "....................", "...................S", "...................S"], "sparkA": ["y..................W", "....................", "....................", "....................", "....................", "....................", "....................", "....................", "....................", "....................", "....................", "W..................y"], "sparkB": ["....................", ".W................y.", "....................", "....................", "....................", "....................", "....................", "....................", "....................", "....................", ".y................W."], "heartsA": ["R.R..............R.R", "RRR..............RRR", ".R................R."], "heartsB": ["....................", "R.R..............R.R", ".R................R."]}, "items": {"headphones": ["....................", ".......KKKKKK.......", "....................", "....................", ".KK..............KK.", ".Kc..............cK.", ".KK..............KK."], "wizard": [".........vv.........", "........vyvv........", "......vvvvvvvv......"], "crown": [".......y.yy.y.......", ".......yRyycy......."], "tophat": ["........KKKK........", "........RRRR........", "......KKKKKKKK......"], "bandage": ["....................", "....................", "....................", "...........WWW......", "...........WRW......"], "sweatband": ["....................", "....................", "....................", "...RRRRRRWWRRRRR...."], "bow": ["............R...R...", "............RRyRR...", "............R...R..."], "flower": ["....P...............", "...PyP..............", "....P..............."], "sprout": ["........jj.j........", ".........jj.........", ".........j.........."], "propeller": ["......cccKRRR.......", "........yyyy........", ".......RRRRRR......."], "halo": [".......yyyyyy.......", "...................."], "flame": ["..........F.........", ".........FyF........", "........FFyFF......."], "star": [".........yy.........", ".......yyWWyy.......", ".........yy........."]}, "egg": [["....................", ".........OO.........", ".......OOLLOO.......", "......OLLLLLLO......", ".....OLLBBLLLLO.....", ".....OLLBBLLLBO.....", "....OLLLLLLLLLLO....", "....OLLLLLBBLLLO....", "....OLLBLLBBLLLO....", "....OLLLLLLLLLLO....", ".....OLLLLLLLLO.....", "......OOOOOOOO......"], ["....................", "..........OO........", "........OOLLOO......", ".......OLLLLLLO.....", "......OLLBBLLLLO....", "......OLLBBLLLBO....", ".....OLLLLLLLLLLO...", ".....OLLLLLBBLLLO...", ".....OLLBLLBBLLLO...", ".....OLLLLLLLLLLO...", "......OLLLLLLLLO....", ".......OOOOOOOO....."], ["....................", ".........OO.........", ".......OOLLOO.......", "......OLLLLLLO......", ".....OLLBBLLLLO.....", ".....OLLBBLLLBO.....", "....OLLLLLLLLLLO....", "....OLLLLLBBLLLO....", "....OLLBLLBBLLLO....", "....OLLLLLLLLLLO....", ".....OLLLLLLLLO.....", "......OOOOOOOO......"], ["....................", "........OO..........", "......OOLLOO........", ".....OLLLLLLO.......", "....OLLBBLLLLO......", "....OLLBBLLLBO......", "...OLLLLLLLLLLO.....", "...OLLLLLBBLLLO.....", "...OLLBLLBBLLLO.....", "...OLLLLLLLLLLO.....", "....OLLLLLLLLO......", ".....OOOOOOOO......."]], "cracked": [["....................", ".........OO.........", ".......OOLLOO.......", "......OLLLLLLO......", ".....OLLBBLLLLO.....", ".....OLOBLLOLBO.....", "....OOLOLOOLOLOO....", "....OLLOLLBBOLLO....", "....OLLBLLBBLLLO....", "....OLLLLLLLLLLO....", ".....OLLLLLLLLO.....", "......OOOOOOOO......"], ["....................", "..........OO........", "........OOLLOO......", ".......OLLLLLLO.....", "......OLLBBLLLLO....", "......OLOBLLOLBO....", ".....OOLOLOOLOLOO...", ".....OLLOLLBBOLLO...", ".....OLLBLLBBLLLO...", ".....OLLLLLLLLLLO...", "......OLLLLLLLLO....", ".......OOOOOOOO....."], ["....................", ".........OO.........", ".......OOLLOO.......", "......OLLLLLLO......", ".....OLLBBLLLLO.....", ".....OLOBLLOLBO.....", "....OOLOLOOLOLOO....", "....OLLOLLBBOLLO....", "....OLLBLLBBLLLO....", "....OLLLLLLLLLLO....", ".....OLLLLLLLLO.....", "......OOOOOOOO......"], ["....................", "........OO..........", "......OOLLOO........", ".....OLLLLLLO.......", "....OLLBBLLLLO......", "....OLOBLLOLBO......", "...OOLOLOOLOLOO.....", "...OLLOLLBBOLLO.....", "...OLLBLLBBLLLO.....", "...OLLLLLLLLLLO.....", "....OLLLLLLLLO......", ".....OOOOOOOO......."]]}
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
}

const empty: Save = { name: 'Mochi', born: 0, lifetime: 0, isHatched: false, isShiny: false, items: [], wearing: null, streak: 0, lastDay: 0, compactions: 0, pets: 0 }

const save = atom({ plugin: 'vramagotchi', key: 'save' } as const, empty)
const unsaved = atom({ plugin: 'vramagotchi', key: 'unsaved' } as const, 0)
const turnAte = atom({ plugin: 'vramagotchi', key: 'turnAte' } as const, 0)
const tick = atom({ plugin: 'vramagotchi', key: 'tick' } as const, 0)
const lastActive = atom({ plugin: 'vramagotchi', key: 'lastActive' } as const, 0)
const context = atom({ plugin: 'vramagotchi', key: 'context' } as const, { tokens: 0, window: 200000 } as Context)
const isHidden = atom({ plugin: 'vramagotchi', key: 'isHidden' } as const, false)
const partyUntil = atom({ plugin: 'vramagotchi', key: 'partyUntil' } as const, 0)
const lovedUntil = atom({ plugin: 'vramagotchi', key: 'lovedUntil' } as const, 0)

const human = (n: number): string =>
  n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}k` : `${Math.round(n)}`

const pick = <T,>(list: readonly T[]): T | undefined => list[Math.floor(Math.random() * list.length)]

const stageOf = (lifetime: number): number => STAGES.reduce((found, stage, i) => (lifetime >= stage.at ? i : found), 0)

const dayOf = (now: number): number => Math.floor((now - new Date(now).getTimezoneOffset() * 60_000) / 86_400_000)

const fresh = (now: number): Save => ({ ...empty, name: pick(NAMES) ?? 'Mochi', born: now, isShiny: Math.random() < SHINY_ODDS })

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
        row[left + dx] = ch
      }
    }
  })
}

/** Turns rows of colour letters into a Raster's cells: two pixels, one above the other, per character. */
const paint = (px: string[][], coats: (string | null)[]): string => {
  const palette: Record<string, number[]> = { ...ART.colors }

  for (const coat of coats) {
    Object.assign(palette, (coat && ART.coats[coat]) || {})
  }

  const color = (ch: string | undefined): number => {
    const c = ch ? palette[ch] : undefined

    return c ? ((c[0] ?? 0) << 16) | ((c[1] ?? 0) << 8) | (c[2] ?? 0) : -1
  }
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

const eggPicture = (isCracked: boolean, frame: number): string =>
  remembered(`egg ${isCracked} ${frame % 4}`, () => {
    const frames = isCracked ? ART.cracked : ART.egg

    return paint((frames[frame % 4] ?? []).map(row => [...row]), [])
  })

const petPicture = (stage: string, face: string, item: string | null, floats: string[], coats: string[]): string =>
  remembered([stage, face, item, floats, coats].join('|'), () => {
    const body = ART.bodies[stage]

    if (!body) {
      return ''
    }

    const px = body.art.map(row => [...row])
    stamp(px, ART.faces[face], body.face, 3, true)
    stamp(px, item ? ART.items[item] : undefined, body.lift, 0, false)

    for (const name of floats) {
      stamp(px, ART.floats[name], 0, 0, false)
    }

    return paint(px, [body.coat, ...coats])
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
      news.push(`Your egg hatched! Meet ${pet.name}${pet.isShiny ? ', a rare shiny one' : ''}.`)
    }
  }

  if (pet.isHatched) {
    const found = pending > 0 ? find(pet, turn) : undefined
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
    `${pet.name} the ${pet.isShiny ? 'shiny ' : ''}${STAGES[stage]?.name ?? ''}`,
    `ate ${human(pet.lifetime)} tokens · ${days} day${days === 1 ? '' : 's'} old · ${pet.streak}-day streak · petted ${pet.pets} times`,
    next ? `grows into a ${next.name} at ${human(next.at)} tokens` : 'fully grown',
    '',
    `Collection ${pet.items.length}/${ITEMS.length}`,
    ...list,
    '',
    '/pet name <name> · /pet wear <item> · /pet wear nothing · /pet hide · /pet show',
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
          await cheer($, [`${before.name} grew into a ${grown.name}!`])
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
    })

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
    const done = await next(e)

    if (e.trigger !== 'precompute' && done.skip === undefined) {
      await quietly(async () => {
        const usage = await $.session.usage({ breakdown: 'summary' })
        const tokens = done.tokensAfter ?? usage.context.breakdown?.totalTokens ?? 0
        await update($, context, () => ({ tokens, window: usage.context.window }))
        await update($, save, pet => ({ ...pet, compactions: pet.compactions + 1 }))
        await settle($)
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
    if (e.props.hasSurvey || e.surface !== 'terminal' || (await read($, isHidden))) {
      return next(e)
    }

    const frame = await read($, tick)
    const pet = await read($, save)
    const { Box, Button, Raster, Text } = $.ui.resolve(e)

    if (!pet.isHatched) {
      const line = LINES.egg[Math.floor(frame / 12) % LINES.egg.length] ?? ''

      return (
        <Box paddingTop={1}>
          <Raster key="pet" columns={COLUMNS} rows={ROWS} cells={eggPicture(e.props.isWorking, e.props.isWorking ? frame : Math.floor(frame / 2))} />
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
    const mood: Mood =
      now < (await read($, partyUntil))
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
    const wearing = mood === 'fainted' ? null : pet.wearing
    const coats = [...(pet.isShiny ? ['shiny'] : []), ...(mood === 'fainted' ? ['fainted'] : [])]
    const line = LINES[mood][Math.floor(frame / 12) % LINES[mood].length] ?? ''
    const bar = Math.round(Math.min(1, full) * 10)
    const grown = next_ ? Math.floor(Math.min(1, (pet.lifetime - (STAGES[stage]?.at ?? 0)) / (next_.at - (STAGES[stage]?.at ?? 0))) * 10) : 10
    const owned = ITEMS.filter(item => pet.items.includes(item.id))
    const outfits = [null, ...owned.map(item => item.id)]
    const nextOutfit = outfits[(outfits.indexOf(pet.wearing) + 1) % outfits.length] ?? null
    const wornName = owned.find(item => item.id === pet.wearing)?.name

    return (
      <Box paddingTop={1}>
        <Raster key="pet" columns={COLUMNS} rows={ROWS} cells={petPicture(stageName, face, wearing, floats, coats)} />
        <Box flexDirection="column" paddingLeft={2}>
          <Text bold>
            {pet.isShiny ? '✦ ' : ''}
            {pet.name} · {stageName} · {mood}
          </Text>
          <Text dimColor>"{line}"</Text>
          <Text>
            ate {human(pet.lifetime)} tokens{pet.streak > 1 ? ` · ${pet.streak}-day streak` : ''}
          </Text>
          <Text>
            context {'█'.repeat(bar)}
            {'░'.repeat(10 - bar)} {Math.round(full * 100)}%
          </Text>
          <Text>
            growth {'█'.repeat(grown)}
            {'░'.repeat(10 - grown)} {next_ ? `${next_.name} at ${human(next_.at)}` : 'fully grown'}
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
