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

declare module 'claude-code' {
  interface PluginState {
    'dotfiles-dev-tools': {
      board: BoardState | null
      score: CrawlerScore
      allTime: number
      tdd: TddState
    }
  }
}
