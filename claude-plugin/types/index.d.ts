export type BoardPhase = 'running' | 'awaiting' | 'landed' | 'dropped' | 'conflict' | 'gone'

export type BoardRowState = {
  n: number
  ticket: string
  phase: BoardPhase
  ended?: 'finished' | 'timeout' | 'turn cap' | 'error'
  wallS: number
  calls: number
  maxTurns?: number
  tools: number
  ctx: number
  lastTool: string
  detail: string
}

export type BoardState = {
  branch: string
  ctxLimit?: number
  rows: BoardRowState[]
}

export type CrawlerScore = {
  session: number
  streak: number
  debuff?: string
}

export type TddState = {
  phase?: 'RED' | 'GREEN' | 'REFACTOR'
  lastCheck?: boolean
  isAgentLed: boolean
  visibility: 'auto' | 'shown' | 'hidden'
}

export type BossState = { name: string; hp: number; maxHp: number; order: number }

export type BossesState = {
  foes: Record<string, { reds: number; boss?: BossState }>
  summoned: number
}

export type CheckRunState = { name: string; state: 'pass' | 'fail' | 'pending' }

export type MailWatchState = {
  number: number
  url: string
  branch: string
  root: string
  seen: string[]
  mine: string[]
  mail: { id: string; author: string }[]
  checks: CheckRunState[]
  changedAt: number
}

export type BeastReadingState = {
  state: 'up' | 'loading' | 'down'
  reason?: string
  vram?: { usedMb: number; totalMb: number }
}

export type BeastWatchState = { isAwake: boolean; reading?: BeastReadingState }

/** The show's latest Cue for other mods to hear; `n` goes up by one with each. Written at session start too. */
export type CueState = {
  n: number
  // As mods/cue.ts's Cue, which dungeon-buddy reads: change them together.
  cue?:
    | { kind: 'boss-summoned'; name: string }
    | { kind: 'boss-slain'; name: string }
    | { kind: 'achievement'; name: string }
    | { kind: 'debuff'; name: string }
    | { kind: 'streak'; count: number }
    | { kind: 'streak-broken'; count: number }
    | { kind: 'collapse' }
    | { kind: 'mail'; author: string }
    | { kind: 'red-pr'; names: string[] }
    | { kind: 'verdict'; text: string }
}

declare module 'claude-code' {
  interface PluginState {
    'dotfiles-dev-tools': {
      board: BoardState | null
      score: CrawlerScore
      allTime: number
      tdd: TddState
      bosses: BossesState
      mailWatch: MailWatchState | null
      beast: BeastWatchState
      cue: CueState
    }
    // dungeon-buddy's own, heard but never written here; `awardOfBuddyCue` checks what it holds.
    'dungeon-buddy': {
      cue: { n: number; cue?: unknown }
    }
  }
}
