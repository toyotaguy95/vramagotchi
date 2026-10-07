export type Mood = 'idle' | 'eating' | 'sleeping' | 'stuffed' | 'fainted'

export type Context = { tokens: number; window: number }

declare module 'claude-code' {
  interface PluginState {
    vramagotchi: { eaten: number; tick: number; lastActive: number; context: Context; isHidden: boolean }
  }
}
