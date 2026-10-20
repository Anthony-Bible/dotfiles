/** The Buddy as the band draws it: its Hatch is rolled from `seed`; absent before the first /buddy. */
export type BuddyState = {
  seed?: string
  name?: string
  isShown: boolean
  /** The Bubble it is saying now, its full sprite drawn beside it. */
  bubble?: string
  /** The egg's frame while it hatches. */
  egg?: number
  /** The fidget its resting face is mid-way through. */
  pose?: number
}

/** What the Buddy announces for dotfiles-dev-tools to price: `n` goes up by one with each. */
export type BuddyCueState = {
  n: number
  cue?: { kind: 'reroll' } | { kind: 'legendary'; species: string }
}

/** dotfiles-dev-tools' Cue as it writes it; `cueOf` checks what it holds. Written at all means it runs. */
export type ShowCueState = { n: number; cue?: unknown }

declare module 'claude-code' {
  interface PluginState {
    'dungeon-buddy': {
      buddy: BuddyState
      cue: BuddyCueState
    }
    // dotfiles-dev-tools' own, read but never written here; absent (version 0) without that plugin.
    'dotfiles-dev-tools': {
      cue: ShowCueState
      allTime: number
    }
  }
}
