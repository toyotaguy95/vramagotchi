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
  /** The longest run of shapes it has got right in the memory game. */
  bestMemory: number
  /** The most tokens it has caught in one catch game. */
  bestCatch: number
  /** Its owner's longest run of blackjack hands won in a row. */
  bestBlackjack: number
}

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

/** A hand of blackjack against the pet: both hands as cards 0 to 51, how it ended, and the run of wins so far. */
export type Blackjack = { isOn: boolean; isOver: boolean; you: number[]; pet: number[]; result: string; streak: number }

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
      game: Game
      catching: Catch
      table: Blackjack
    }
  }
}
