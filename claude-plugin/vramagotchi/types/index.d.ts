export type Mood = 'egg' | 'idle' | 'eating' | 'sleeping' | 'stuffed' | 'fainted' | 'happy' | 'loved' | 'squeezing'

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
}

/** The last thing the pet said about a turn: the line, until when it shows, and when it was asked for. */
export type Remark = { text: string; until: number; at: number; problem: string }

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
    }
  }
}
