export type Mood = 'egg' | 'idle' | 'eating' | 'sleeping' | 'stuffed' | 'fainted' | 'happy' | 'loved'

export type Context = { tokens: number; window: number }

/** Everything a pet remembers between sessions. */
export type Save = {
  name: string
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
}

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
    }
  }
}
