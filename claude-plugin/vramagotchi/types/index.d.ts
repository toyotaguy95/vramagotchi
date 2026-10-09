export type Mood = 'egg' | 'idle' | 'eating' | 'sleeping' | 'stuffed' | 'fainted' | 'happy' | 'loved' | 'squeezing' | 'playing'

export type Context = { tokens: number; window: number }

/** Everything a pet remembers between sessions. */
export type Save = {
  name: string
  /** Which animal it is: one of the kinds in the art. */
  species: string
  born: number
  lifetime: number
  isHatched: boolean
  isShiny: boolean
  items: string[]
  wearing: string | null
  streak: number
  lastDay: number
  compactions: number
  pets: number
  /** The leaderboard: whether the owner put the pet there, and the id and key it reports with. */
  isOnBoard: boolean
  boardId: string
  boardKey: string
  /** The code of the team it is on, like "acme-k3x9q2ab", or nothing. A pet can be on a team without being on the public board. */
  team: string
  /** Whether it remarks on the owner's work after a turn. Off unless the owner turns it on. */
  talks: boolean
  /** How it talks: sweet, cheeky or roast. */
  attitude: string
  /** Its own personality: one sentence the model wrote for it, or the owner did. Empty until it first talks. */
  quirk: string
  /** The stats that are kept. Each 0 to 100, raised by what happens while the owner works. (Wisdom is worked out from `lifetime`.) */
  stats: Stats
  /** The longest run of shapes it has got right in the memory game. */
  bestMemory: number
  /** The most tokens it has caught in one catch game. */
  bestCatch: number
  /** Play chips for blackjack: what the owner has now, and the most they ever had. Worth nothing, and never sent anywhere. */
  chips: number
  bestChips: number
}

export type Stats = { debugging: number; patience: number; chaos: number; snark: number }

/** The last thing the pet said about a turn: the line, until when it shows, and when it was asked for. */
export type Remark = { text: string; until: number; at: number; problem: string }

/** A memory game in progress: the shapes so far, how many of them have been pressed right, and the frame the showing began on. */
export type Game = { isOn: boolean; sequence: number[]; step: number; showFrom: number; isOver: boolean }

/** A catch game in progress: where the pet has been slid to, the tokens in the air (in pixels), and the count so far. */
export type Catch = {
  isOn: boolean
  isOver: boolean
  place: number
  tokens: { x: number; y: number; color: string }[]
  caught: number
  missed: number
  steps: number
  ateAt: number
}

/** Six decks shuffled into one order, with the seal (a SHA-256 of the salt and the order) that proves the order was not changed later. */
export type Shoe = { cards: number[]; salt: string; seal: string }

/**
 * Blackjack against the pet. The shoe and how far into it play has got, the last shoe (opened once used up),
 * the player's hands (two after a split), the pet's hand, and how the hand came out in chips.
 */
export type Blackjack = {
  isOn: boolean
  isOver: boolean
  shoe: Shoe
  at: number
  past: (Shoe & { dealt: number }) | null
  hands: { cards: number[]; bet: number; isDone: boolean }[]
  active: number
  pet: number[]
  net: number
  said: string
}

/** Where the pet stands on the leaderboard, as the board last said. */
export type Standing = { rank: number | null; teamRank: number | null; score: number; sentAt: number }

declare module 'claude-code' {
  interface PluginState {
    vramagotchi: {
      save: Save
      unsaved: number
      turnAte: number
      tick: number
      lastActive: number
      context: Context
      isHidden: boolean
      partyUntil: number
      lovedUntil: number
      standing: Standing
      lastPrompt: string
      remark: Remark
      lastAnswer: string
      squeezingSince: number
      isBusy: boolean
      recent: string[]
      isNamed: boolean
      trouble: string
      turnLines: number
      isFailing: boolean
      turnFixes: number
      game: Game
      catching: Catch
      table: Blackjack
    }
  }
}
