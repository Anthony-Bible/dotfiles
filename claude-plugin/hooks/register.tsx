// The plugin's function hooks (mods). The command hooks in hooks.json (the formatters) are separate.
//
// Dispatch Board: a pane listing pi-implementer's Dispatches on the current run branch, live while they run.
// It reads what pi-dispatch.py leaves under .hybrid/ and never writes there. /dispatches opens it; it also
// opens by itself when a Dispatch starts.
//
// Crawler Points: the System scores the session. Test/build runs, git milestones, tool errors and the
// Dispatch fates the board notices add or take points; the status line shows the score, and a toast written
// by a small model in the System's voice announces each award.
//
// Every use of `$` lives in this file (the engine follows `$` into this file's functions, never across an
// import); the rules are in ../mods/board.ts and ../mods/points.ts.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import {
  boardRows,
  completeLines,
  ctxSizeOf,
  duration,
  emptyCounts,
  foldPiEvents,
  kilo,
  parseJsonl,
  tail,
  type DispatchRow,
  type LiveCounts,
  type Outcome,
  type RunningMeta,
} from '../mods/board'
import {
  apply,
  bashAward,
  cleanQuip,
  dispatchAward,
  errorAward,
  fallbackToast,
  QUIP_SYSTEM,
  quipPrompt,
  statusLine,
  type Award,
  type Fate,
} from '../mods/points'
import type { BoardRowState, BoardState, CrawlerScore } from '../types'

// ---------------------------------------------------------------------------------------------- state

const board = atom({ plugin: 'dotfiles-dev-tools', key: 'board' } as const, null)
const score = atom({ plugin: 'dotfiles-dev-tools', key: 'score' } as const, { session: 0, streak: 0 })
const allTime = atom({ plugin: 'dotfiles-dev-tools', key: 'allTime' } as const, 0)

const PANE = 'dispatch-board'
const TITLE = 'Dispatch Board'
const POLL_MS = 2000

const STORE_ALL_TIME = 'crawler-points.allTime'
const STORE_UNLOCKED = 'crawler-points.unlocked'
const QUIP_MODEL = 'haiku'
/** At most one quip call in flight, and none sooner than this after the last one began. */
const QUIP_GAP_MS = 8000
const TOAST_MS = 6000

type Watch = {
  root: string
  ctxLimit?: number
  /** Per live log: bytes folded so far and the counts they gave. */
  logs: Map<string, { bytes: number; counts: LiveCounts }>
  running: Set<number>
  /** Size of outcomes.jsonl / dispatches.jsonl at the last full read; undefined before the first. */
  sizes: { outcomes?: number; dispatches?: number }
  /** Lines already seen, so only later ones become Fates; undefined before the baseline read. */
  seen: { outcomes?: number; dispatches?: number }
}

// Module variables: a hot reload starts them over (session.start runs again and re-baselines the board),
// which costs at most an early quip or a second "first check" of the session.
let watch: Watch | undefined
let isTicking = false
let hasChecked = false
let isQuipBusy = false
let quipAt = -Infinity

// ------------------------------------------------------------------------------------- Dispatch Board

async function readText($: EngineInterface, path: string): Promise<string> {
  return (await $.fs.exists(path)) ? String(await $.fs.read(path)) : ''
}

async function sizeOf($: EngineInterface, path: string): Promise<number> {
  return (await $.fs.exists(path)) ? (await $.fs.stat(path)).size : 0
}

/** The main checkout's root, also from inside a Worktree, as pi-dispatch.py finds it. */
async function mainRoot($: EngineInterface): Promise<string | undefined> {
  const r = await $.process.run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'])
  if (r.exitCode !== 0) return undefined
  const dir = r.stdout.trim()
  return dir.slice(0, dir.lastIndexOf('/')) || undefined
}

async function ctxLimitOf($: EngineInterface): Promise<number | undefined> {
  const r = await $.process.run([
    'sh',
    '-c',
    'cat "${PI_IMPLEMENTER_HOME:-$HOME/.config/pi-implementer}/env" 2>/dev/null',
  ])
  return ctxSizeOf(r.stdout)
}

async function livePids($: EngineInterface, pids: readonly number[]): Promise<Set<number>> {
  if (pids.length === 0) return new Set()
  const r = await $.process.run(['ps', '-o', 'pid=', '-p', pids.join(',')])
  return new Set(
    r.stdout
      .split('\n')
      .map(Number)
      .filter(n => n > 0),
  )
}

/** Folds whatever the log gained since the last read into its counts; a torn last line waits. */
async function followLog($: EngineInterface, w: Watch, log: string): Promise<LiveCounts> {
  const held = w.logs.get(log) ?? { bytes: 0, counts: emptyCounts() }
  const r = await $.process.run(['tail', '-c', `+${held.bytes + 1}`, `${w.root}/${log}`])
  const { text, bytes } = completeLines(r.exitCode === 0 ? r.stdout : '')
  const next = { bytes: held.bytes + bytes, counts: foldPiEvents(held.counts, parseJsonl(text)) }
  w.logs.set(log, next)
  return next.counts
}

/** The running Dispatches: a `.json` beside a live `.pid` under .hybrid/running/. */
async function runningMetas($: EngineInterface, w: Watch): Promise<RunningMeta[]> {
  const dir = `${w.root}/.hybrid/running`
  if (!(await $.fs.exists(dir))) return []
  const names = (await $.fs.list(dir)).map(e => e.name)
  const pids = new Map<number, number>()
  for (const name of names.filter(n => n.endsWith('.pid'))) {
    const pid = Number((await readText($, `${dir}/${name}`)).trim())
    if (pid > 0) pids.set(Number(name.slice(0, -4)), pid)
  }
  const live = await livePids($, [...pids.values()])
  const metas: RunningMeta[] = []
  for (const name of names.filter(n => n.endsWith('.json'))) {
    const meta = parseJsonl<RunningMeta>(await readText($, `${dir}/${name}`))[0]
    const pid = meta && pids.get(meta.n)
    if (meta && pid !== undefined && live.has(pid)) metas.push(meta)
  }
  return metas
}

/** Re-reads .hybrid/ and redraws; answers the Fates that appeared and the Dispatches that started. */
async function refresh($: EngineInterface, w: Watch): Promise<{ fates: Fate[]; started: number[] }> {
  const hybrid = `${w.root}/.hybrid`
  const branch = (
    await $.process.run(['git', '-C', w.root, 'rev-parse', '--abbrev-ref', 'HEAD'])
  ).stdout.trim()
  const now = await $.clock.now()

  const metas = await runningMetas($, w)
  const running = []
  for (const meta of metas) running.push({ meta, counts: await followLog($, w, meta.log), nowMs: now })
  for (const log of [...w.logs.keys()]) if (!metas.some(m => m.log === log)) w.logs.delete(log)

  const finished = parseJsonl<DispatchRow>(await readText($, `${hybrid}/dispatches.jsonl`))
  const outcomes = parseJsonl<Outcome>(await readText($, `${hybrid}/outcomes.jsonl`))
  const present = new Set<string>()
  for (const r of finished) {
    if (r.run_branch === branch && (await $.fs.exists(r.worktree))) present.add(r.worktree)
  }

  const ticketOf = (n: number) => finished.find(r => r.n === n)?.ticket ?? `#${n}`
  const fates: Fate[] = [
    ...(w.seen.outcomes === undefined ? [] : outcomes.slice(w.seen.outcomes)).map(o => ({
      fate: o.outcome,
      ticket: ticketOf(o.n),
    })),
    ...(w.seen.dispatches === undefined ? [] : finished.slice(w.seen.dispatches))
      .filter(r => r.ended === 'timeout' || r.ended === 'turn cap')
      .map(r => ({ fate: r.ended as 'timeout' | 'turn cap', ticket: r.ticket })),
  ]
  w.seen = { outcomes: outcomes.length, dispatches: finished.length }

  const started = metas.map(m => m.n).filter(n => !w.running.has(n))
  w.running = new Set(metas.map(m => m.n))

  const rows = boardRows({ branch, running, finished, outcomes, worktreesPresent: present })
  await update($, board, (): BoardState => ({ branch, ctxLimit: w.ctxLimit, rows }))
  return { fates, started }
}

async function isPaneOpen($: EngineInterface): Promise<boolean> {
  return (await $.ui.panes()).some(p => p.id === PANE)
}

/** One poll: cheap stats always; a full read only while something runs, the pane is open or a file grew. */
async function tick($: EngineInterface, force: boolean): Promise<void> {
  const w = watch
  if (!w || !(await $.fs.exists(`${w.root}/.hybrid`))) return
  const hybrid = `${w.root}/.hybrid`
  const sizes = {
    outcomes: await sizeOf($, `${hybrid}/outcomes.jsonl`),
    dispatches: await sizeOf($, `${hybrid}/dispatches.jsonl`),
  }
  const runningDir = `${hybrid}/running`
  const hasRunFiles =
    (await $.fs.exists(runningDir)) && (await $.fs.list(runningDir)).some(e => e.name.endsWith('.json'))
  const hasGrown = sizes.outcomes !== w.sizes.outcomes || sizes.dispatches !== w.sizes.dispatches
  if (!(force || hasGrown || hasRunFiles || w.running.size > 0 || (await isPaneOpen($)))) return
  w.sizes = sizes
  const { fates, started } = await refresh($, w)
  for (const fate of fates) await award($, dispatchAward(fate.fate, fate.ticket))
  if (started.length > 0 && !(await isPaneOpen($))) await $.ui.open({ id: PANE, title: TITLE })
}

async function startBoard($: EngineInterface): Promise<void> {
  await $.command.register({
    name: 'dispatches',
    description: 'Open the Dispatch Board: pi-implementer Dispatches on this run branch',
  })
  const root = await mainRoot($)
  watch = root
    ? { root, ctxLimit: await ctxLimitOf($), logs: new Map(), running: new Set(), sizes: {}, seen: {} }
    : undefined
  isTicking = false
  $.clock.every(POLL_MS, () => {
    if (isTicking) return
    isTicking = true
    void tick($, false)
      .catch(() => undefined)
      .finally(() => {
        isTicking = false
      })
  })
  await tick($, true).catch(() => undefined) // the baseline: Fates already on disk are not new
}

const PHASE: Record<BoardRowState['phase'], { label: string; color: string }> = {
  running: { label: '▶ running', color: 'yellow' },
  awaiting: { label: '⏸ Gate', color: 'cyan' },
  landed: { label: '✔ landed', color: 'green' },
  dropped: { label: '✖ dropped', color: 'gray' },
  conflict: { label: '⚠ conflict', color: 'red' },
  gone: { label: '· gone', color: 'gray' },
}

const stats = (row: BoardRowState, ctxLimit?: number): string =>
  [
    row.ended && row.ended !== 'finished' ? row.ended : undefined,
    duration(row.wallS),
    `calls ${row.calls}${row.maxTurns ? `/${row.maxTurns}` : ''}`,
    `tools ${row.tools}`,
    `ctx ${kilo(row.ctx)}${ctxLimit ? `/${kilo(ctxLimit)}` : ''}`,
    row.phase === 'running' && row.lastTool ? `last: ${row.lastTool}` : undefined,
  ]
    .filter(Boolean)
    .join('  ')

// -------------------------------------------------------------------------------------- Crawler Points

async function showScore($: EngineInterface): Promise<void> {
  $.ui.status(statusLine(await read($, score), await read($, allTime)))
}

/** Toasts the award: a model-written line when one is allowed and arrives, the plain line otherwise. */
async function announce(
  $: EngineInterface,
  a: Award,
  after: CrawlerScore,
  isNewEver: boolean,
): Promise<void> {
  const plain = fallbackToast(a)
  const now = await $.clock.now()
  if (isQuipBusy || now - quipAt < QUIP_GAP_MS) return $.ui.toast(plain, { timeoutMs: TOAST_MS })
  isQuipBusy = true
  quipAt = now
  try {
    const r = await $.model.complete({
      model: QUIP_MODEL,
      system: QUIP_SYSTEM,
      prompt: quipPrompt(a, after) + (isNewEver ? '\nThis achievement is a first, ever.' : ''),
      maxTokens: 80,
      effort: 'low',
      timeoutMs: 8000,
    })
    const quip = r.isAnswered ? cleanQuip(r.text) : undefined
    const points = `(${a.points >= 0 ? '+' : '−'}${Math.abs(a.points)} CP)`
    $.ui.toast(quip ? `${quip} ${points}` : plain, { timeoutMs: TOAST_MS })
  } finally {
    isQuipBusy = false
  }
}

async function award($: EngineInterface, a: Award): Promise<void> {
  const after = await update($, score, s => apply(s, a))
  const total = await update($, allTime, t => t + a.points)
  await $.store.set(STORE_ALL_TIME, total)
  let isNewEver = false
  if (a.achievement) {
    const unlocked = ((await $.store.get(STORE_UNLOCKED)) as string[] | undefined) ?? []
    isNewEver = !unlocked.includes(a.achievement)
    if (isNewEver) await $.store.set(STORE_UNLOCKED, [...unlocked, a.achievement])
  }
  await showScore($)
  // Off the caller's dispatch: a tool call never waits on the quip.
  $.clock.after(0, () => void announce($, a, after, isNewEver).catch(() => undefined))
}

async function startPoints($: EngineInterface): Promise<void> {
  const stored = Number((await $.store.get(STORE_ALL_TIME)) ?? 0)
  await update($, allTime, () => (Number.isFinite(stored) ? stored : 0))
  hasChecked = false
  await showScore($)
}

// ------------------------------------------------------------------------------------------------ hooks

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await startPoints($)
    await startBoard($)
    return next(e)
  })

  on('command.run', { command: 'dispatches' }, async $ => {
    if (!watch) return { text: 'Dispatch Board: not inside a git repository.' }
    await tick($, true)
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Dispatch Board opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const state = await read($, board)
    if (!state) return <Text dimColor>No .hybrid/ in this repo: run pi-dispatch.py init first.</Text>
    const width = Math.max(30, (e.props.bodyColumns ?? e.viewport?.columns ?? 80) - 2)
    const count = (phase: BoardRowState['phase']) => state.rows.filter(r => r.phase === phase).length
    return (
      <Box flexDirection="column">
        <Text bold wrap="truncate-end">
          {state.branch} · {count('running')} running · {count('awaiting')} awaiting Gate
        </Text>
        {state.rows.length === 0 && <Text dimColor>No Dispatches on this run branch yet.</Text>}
        {state.rows.map(row => (
          <Box key={`d${row.n}`} flexDirection="column">
            <Text wrap="truncate-end">
              <Text color={PHASE[row.phase].color}>{PHASE[row.phase].label}</Text>
              {` #${String(row.n).padStart(2, '0')} ${row.ticket}  ${stats(row, state.ctxLimit)}`}
            </Text>
            {row.detail !== '' && (
              <Text dimColor wrap="truncate-end">
                {`  ↳ ${tail(row.detail, width - 4)}`}
              </Text>
            )}
          </Box>
        ))}
      </Box>
    )
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const isDenied = ran.deny !== undefined
    if (e.tool === 'Bash') {
      const result = ran.result as { backgroundTaskId?: string } | undefined
      if (!isDenied && result?.backgroundTaskId) return ran // still running: nothing to score yet
      if (isDenied) {
        await award($, errorAward('Bash', true))
        return ran
      }
      const a = bashAward(e.command, ran.isError === true, await read($, score), !hasChecked)
      if (a?.isGreen !== undefined) hasChecked = true
      if (a) await award($, a)
      return ran
    }
    if (isDenied || ran.isError === true) await award($, errorAward(String(e.tool), isDenied))
    return ran
  })
}
