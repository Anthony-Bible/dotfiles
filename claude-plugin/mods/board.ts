// The Dispatch Board's pure half: from the text of pi-implementer's files under .hybrid/ to the rows the pane
// draws. No `$` here, so every rule is testable without an engine.

export type Phase = 'running' | 'awaiting' | 'landed' | 'dropped' | 'conflict' | 'gone'

export type Ended = 'finished' | 'timeout' | 'turn cap' | 'error'

export type LiveCounts = {
  calls: number
  tools: number
  ctx: number
  lastTool: string
  lastText: string
}

export type BoardRow = {
  n: number
  ticket: string
  phase: Phase
  ended?: Ended
  wallS: number
  calls: number
  maxTurns?: number
  tools: number
  ctx: number
  lastTool: string
  detail: string
}

/** `.hybrid/running/NN.json`, written by `pi-dispatch.py dispatch` while pi runs. */
export type RunningMeta = {
  n: number
  ticket: string
  max_turns: number
  started: string
  log: string
  run_branch: string
}

/** A `.hybrid/dispatches.jsonl` row: the fields the board reads. */
export type DispatchRow = {
  n: number
  ticket: string
  max_turns: number
  ended: Ended
  run_branch: string
  worktree: string
  wall_s: number
  turns: number
  tool_calls: number
  ctx_max: number
  result: string
}

export type Outcome = { n: number; outcome: 'landed' | 'dropped' | 'conflict' }

export const emptyCounts = (): LiveCounts => ({ calls: 0, tools: 0, ctx: 0, lastTool: '', lastText: '' })

/** Every line of a JSONL text that parses as an object; torn or foreign lines are skipped. */
export const parseJsonl = <T>(text: string): T[] =>
  text.split('\n').flatMap(line => {
    if (line.trim() === '') return []
    try {
      const value: unknown = JSON.parse(line)
      return value !== null && typeof value === 'object' ? [value as T] : []
    } catch {
      return []
    }
  })

type PiEvent = {
  type?: string
  toolName?: string
  message?: {
    role?: string
    usage?: { input?: number; cacheRead?: number; output?: number }
    content?: { type?: string; text?: string }[]
  }
}

/**
 * Folds pi's `--mode json` events into the running counts, the way pi-dispatch.py's run_pi counts them: a
 * call is an assistant `message_end`, a tool is a `tool_execution_start`, ctx is the largest
 * input + cacheRead + output seen.
 */
export const foldPiEvents = (counts: LiveCounts, events: readonly PiEvent[]): LiveCounts =>
  events.reduce((c, e) => {
    if (e.type === 'tool_execution_start') {
      return { ...c, tools: c.tools + 1, lastTool: e.toolName ?? c.lastTool }
    }
    if (e.type !== 'message_end' || e.message?.role !== 'assistant') return c
    const u = e.message.usage ?? {}
    const text = (e.message.content ?? [])
      .filter(b => b.type === 'text' && typeof b.text === 'string')
      .map(b => b.text)
      .join(' ')
      .trim()
    return {
      ...c,
      calls: c.calls + 1,
      ctx: Math.max(c.ctx, (u.input ?? 0) + (u.cacheRead ?? 0) + (u.output ?? 0)),
      lastText: text || c.lastText,
    }
  }, counts)

/**
 * Splits newly read log text at its last newline: the complete lines to fold now, and how many bytes they
 * span (so the reader's offset only ever moves past whole lines; a torn tail is read again next time).
 */
export const completeLines = (chunk: string): { text: string; bytes: number } => {
  const cut = chunk.lastIndexOf('\n')
  const text = cut < 0 ? '' : chunk.slice(0, cut + 1)
  return { text, bytes: new TextEncoder().encode(text).length }
}

/** The last `width` characters of a text's last non-empty line, on one line. */
export const tail = (text: string, width: number): string => {
  const line =
    text
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .at(-1) ?? ''
  return line.length > width ? `…${line.slice(-(width - 1))}` : line
}

export type BoardInput = {
  branch: string
  running: readonly { meta: RunningMeta; counts: LiveCounts; nowMs: number }[]
  finished: readonly DispatchRow[]
  outcomes: readonly Outcome[]
  worktreesPresent: ReadonlySet<string>
}

/**
 * The board's rows, newest first: every running Dispatch, then every finished one of the current run
 * branch. A finished Dispatch's phase is its last Outcome; with none, `awaiting` while its Worktree is on
 * disk and `gone` once it is not.
 */
export const boardRows = (input: BoardInput): BoardRow[] => {
  const fate = new Map(input.outcomes.map(o => [o.n, o.outcome]))
  const running = input.running.map(({ meta, counts, nowMs }): BoardRow => ({
    n: meta.n,
    ticket: meta.ticket,
    phase: 'running',
    wallS: Math.max(0, Math.round((nowMs - Date.parse(meta.started)) / 1000)),
    calls: counts.calls,
    maxTurns: meta.max_turns,
    tools: counts.tools,
    ctx: counts.ctx,
    lastTool: counts.lastTool,
    detail: counts.lastText,
  }))
  const live = new Set(running.map(r => r.n))
  const finished = input.finished
    .filter(r => r.run_branch === input.branch && !live.has(r.n))
    .map((r): BoardRow => ({
      n: r.n,
      ticket: r.ticket,
      phase: fate.get(r.n) ?? (input.worktreesPresent.has(r.worktree) ? 'awaiting' : 'gone'),
      ended: r.ended,
      wallS: Math.round(r.wall_s),
      calls: r.turns,
      maxTurns: r.max_turns,
      tools: r.tool_calls,
      ctx: r.ctx_max,
      lastTool: '',
      detail: r.result,
    }))
  return [...running, ...finished].sort((a, b) => b.n - a.n)
}

export const duration = (s: number): string =>
  s < 60
    ? `${s}s`
    : s < 3600
      ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
      : `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`

export const kilo = (n: number): string =>
  n < 1000 ? String(n) : `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}K`

/** Reads `CTX_SIZE` out of pi-implementer's env file text (KEY=value lines, optional quotes / export). */
export const ctxSizeOf = (envText: string): number | undefined => {
  const m = envText.match(/^\s*(?:export\s+)?CTX_SIZE\s*=\s*["']?(\d+)/m)
  return m ? Number(m[1]) : undefined
}
