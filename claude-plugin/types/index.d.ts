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
    }
  }
}
