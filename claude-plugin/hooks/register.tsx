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
// Podman Guard: a Bash line that runs `docker` runs `podman` instead, with a note the model reads; a Daemon-Only
// Command is refused; a DOCKER_OK=1 line passes untouched.
//
// TDD Band: above the prompt, the TDD Phase that TDD subagents and Checks lead to, with buttons that draft a
// prompt for each TDD subagent. /tdd shows or hides it.
//
// The System's voice: Spinner Words in the terminal, and a Verdict under each Notable Turn's answer.
//
// Branch Guard: a git commit on a Protected Branch, or a push that lands on one, is refused; a BRANCH_OK=1
// line passes untouched.
//
// Floor Boss: three red runs in a row of one Check command summon a named boss above the prompt, its HP the
// failing-test count; that command's next green run slays it for 100 CP and an Achievement.
//
// Sponsor Mail: once `gh pr create` succeeds (or /watch-pr), the Watched PR's checks and new comments show above
// the prompt, polled without a turn; Mail and red checks raise a notification and a button that queues the turn.
//
// Beast Watch: woken by the session's first use of Beast (or /beast), Beast's health rides the HUD and its going
// Down is notified; the Beast Guard refuses a Dispatch while Beast is Down and holds one while it is Loading.
//
// Every use of `$` lives in this file (the engine follows `$` into this file's functions, never across an
// import); the rules are in ../mods/*.ts.

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
  bashAwards,
  cleanQuip,
  compactAward,
  dispatchAward,
  errorAward,
  fallbackToast,
  QUIP_SYSTEM,
  quipPrompt,
  statusLine,
  type Award,
  type Fate,
  type Usage,
} from '../mods/points'
import { bossToast, checkKey, failingCount, hpBar, initialBosses, newestBoss, onBossCheck, slayAward } from '../mods/boss'
import { branchGuard, gitSteps, type Repo } from '../mods/branch'
import { guard, rewriteNote } from '../mods/podman'
import { DRAFTS, initialTdd, isShown, onAgent, onCheck, toggle, verdictOf } from '../mods/tdd'
import {
  addressPrompt,
  answeredAward,
  claimMine,
  fixPrompt,
  isPost,
  isPrCreate,
  mailNotice,
  mergeAward,
  nextPollMs,
  parsePr,
  prQueryArgv,
  prRefOf,
  redAward,
  redNotice,
  startWatch,
  step,
  tally,
  type MailEvent,
  type MailWatch,
  type Pr,
} from '../mods/mail'
import {
  beastGuard,
  beastSegment,
  healthOf,
  hostOf,
  isBeastUse,
  isBusy,
  isGuarded,
  judge,
  llamaKeyOf,
  llamaUrlOf,
  LOADING_WAIT_MS,
  modelAliasOf,
  modelStateOf,
  SMI_QUERY,
  transition,
  type Probe,
  type Reading,
} from '../mods/beast'
import {
  fallbackVerdict,
  isNotable,
  moodOf,
  spinnerWord,
  VERDICT_SYSTEM,
  verdictLine,
  verdictPrompt,
  type TurnStats,
} from '../mods/voice'
import type {
  BeastWatchState,
  BoardRowState,
  BoardState,
  BossesState,
  CrawlerScore,
  MailWatchState,
  TddState,
} from '../types'

// ---------------------------------------------------------------------------------------------- state

const board = atom({ plugin: 'dotfiles-dev-tools', key: 'board' } as const, null)
const score = atom({ plugin: 'dotfiles-dev-tools', key: 'score' } as const, { session: 0, streak: 0 })
const allTime = atom({ plugin: 'dotfiles-dev-tools', key: 'allTime' } as const, 0)
const tdd = atom({ plugin: 'dotfiles-dev-tools', key: 'tdd' } as const, initialTdd as TddState)
const bosses = atom({ plugin: 'dotfiles-dev-tools', key: 'bosses' } as const, initialBosses as BossesState)
const mailWatch = atom({ plugin: 'dotfiles-dev-tools', key: 'mailWatch' } as const, null as MailWatchState | null)
const beast = atom({ plugin: 'dotfiles-dev-tools', key: 'beast' } as const, { isAwake: false } as BeastWatchState)

const PANE = 'dispatch-board'
const TITLE = 'Dispatch Board'
const POLL_MS = 2000

const STORE_ALL_TIME = 'crawler-points.allTime'
const STORE_UNLOCKED = 'crawler-points.unlocked'
const QUIP_MODEL = 'haiku'
/** At most one quip call in flight, and none sooner than this after the last one began. */
const QUIP_GAP_MS = 8000
const TOAST_MS = 6000
/** A model-written quip is a full sentence of up to 140 characters: it stays long enough to read. */
const QUIP_TOAST_MS = 15000
/** The answer's line waits on the Verdict, so its model call gets less time than a toast's quip. */
const VERDICT_TIMEOUT_MS = 5000

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
  /** The .json names under .hybrid/running/ at the last full read, so a leftover one is read once. */
  runFiles?: string
}

// Module variables: a hot reload starts them over (session.start runs again and re-baselines the board),
// which costs at most an early quip or a second "first check" of the session.
let watch: Watch | undefined
let isTicking = false
let hasChecked = false
let isQuipBusy = false
let quipAt = -Infinity
/** The session's usage as the last `session.measure` reported it, for the HUD. */
let usage: Usage | undefined
/** The main loop's turn in progress: what it scored and how many tool calls it made; undefined between turns. */
let turn: Omit<TurnStats, 'durationMs'> | undefined
/** This turn's Spinner Word, picked once at its start so the spinner does not flicker between words. */
let spinner: string | undefined
/** Sponsor Mail: when the Watched PR is next looked at, and the looks and posts in flight. */
let mailDueAt = 0
let mailLooks = 0
let posting = 0
/** Bumped when a post starts: a look begun before it may predate Claude's comment and is thrown away. */
let postGen = 0
/** Beast Watch: its timer, whether a look is in flight, and Beast's host for waking on use. */
let beastTimer: { cancel: () => void } | undefined
let isBeastLooking = false
let beastTickCount = 0
let beastHost: string | undefined

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

  // Every live Dispatch is tracked, so one already running is not "started" again when the checkout comes
  // back to its branch; only this run branch's are followed, shown and auto-opened for.
  const live = await runningMetas($, w)
  const metas = live.filter(m => m.run_branch === branch)
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
  w.running = new Set(live.map(m => m.n))

  const rows = boardRows({ branch, running, finished, outcomes, worktreesPresent: present })
  await update($, board, (): BoardState => ({ branch, ctxLimit: w.ctxLimit, rows }))
  return { fates, started }
}

/** The board's pane, if open: placed (drawn), or waiting undrawn for a wider terminal. */
async function boardPane($: EngineInterface) {
  return (await $.ui.panes()).find(p => p.id === PANE)
}

/**
 * One poll: cheap stats always; a full read only while a Dispatch runs, the pane is drawn, or a file grew or
 * came or went. A .json a killed pi-dispatch.py left behind is read once, not every poll.
 */
async function tick($: EngineInterface, force: boolean): Promise<void> {
  const w = watch
  if (!w || !(await $.fs.exists(`${w.root}/.hybrid`))) return
  const hybrid = `${w.root}/.hybrid`
  const sizes = {
    outcomes: await sizeOf($, `${hybrid}/outcomes.jsonl`),
    dispatches: await sizeOf($, `${hybrid}/dispatches.jsonl`),
  }
  const runningDir = `${hybrid}/running`
  const runFiles = (await $.fs.exists(runningDir))
    ? (await $.fs.list(runningDir))
        .map(e => e.name)
        .filter(n => n.endsWith('.json'))
        .sort()
        .join(',')
    : ''
  const hasChanged =
    sizes.outcomes !== w.sizes.outcomes || sizes.dispatches !== w.sizes.dispatches || runFiles !== w.runFiles
  const isDrawn = (await boardPane($))?.isPlaced === true
  if (!(force || hasChanged || w.running.size > 0 || isDrawn)) return
  w.sizes = sizes
  w.runFiles = runFiles
  const { fates, started } = await refresh($, w)
  for (const fate of fates) await award($, dispatchAward(fate.fate, fate.ticket))
  if (started.length === 0 || isDrawn) return
  // Unasked, the pane seats only from 144 columns and otherwise waits undrawn: say so rather than nothing.
  const pane = (await boardPane($)) ?? (await $.ui.open({ id: PANE, title: TITLE }))
  if (!pane.isPlaced) {
    $.ui.toast(`Dispatch #${started.join(', #')} started: /dispatches shows the board`, {
      timeoutMs: TOAST_MS,
    })
  }
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

const TDD_ICON = { RED: '🔴', GREEN: '🟢', REFACTOR: '🔧' } as const
const TDD_COLOR = { RED: 'red', GREEN: 'green', REFACTOR: 'cyan', NONE: 'gray' } as const
const MOOD_COLOR = { good: 'green', bad: 'red', waiting: 'gray' } as const

// -------------------------------------------------------------------------------------- Crawler Points

async function showScore($: EngineInterface): Promise<void> {
  const b = await read($, beast)
  const hud = statusLine(await read($, score), await read($, allTime), usage)
  $.ui.status(b.isAwake && b.reading ? `${hud} · ${beastSegment(b.reading)}` : hud)
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
    $.ui.toast(quip ? `${quip} ${points}` : plain, { timeoutMs: quip ? QUIP_TOAST_MS : TOAST_MS })
  } catch {
    $.ui.toast(plain, { timeoutMs: TOAST_MS }) // the model call failed or timed out: the award still shows
  } finally {
    isQuipBusy = false
  }
}

/** The repository a Branch Guard step runs in, or undefined outside one (or where the directory is unknown). */
async function repoAt($: EngineInterface, dir: string): Promise<Repo | undefined> {
  if (/[$`]/.test(dir)) return undefined
  const home = dir.startsWith('~') ? (await $.process.run(['sh', '-c', 'printf %s "$HOME"'])).stdout : ''
  const at = home ? home + dir.slice(1) : dir
  const git = (...args: string[]) => $.process.run(['git', ...(at ? ['-C', at] : []), ...args])
  const current = await git('branch', '--show-current')
  if (current.exitCode !== 0) return undefined
  // An unborn branch (no commits yet) takes its first commit wherever it must, but keeps its name for a push.
  const isUnborn = (await git('rev-parse', '--verify', '-q', 'HEAD')).exitCode !== 0
  const head = (await git('symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD')).stdout.trim()
  return {
    branch: current.stdout.trim() || undefined,
    defaultBranch: head ? head.slice(head.indexOf('/') + 1) : undefined,
    isUnborn,
  }
}

/** A Check of `key` finished: the Floor Boss it summons, hurts or heals gets a toast, and one it slays an Award. */
async function fight($: EngineInterface, key: string, isGreen: boolean, output: string): Promise<void> {
  const r = onBossCheck(await read($, bosses), key, isGreen, isGreen ? undefined : failingCount(output))
  await update($, bosses, () => r.bosses)
  if (!r.event) return
  if (r.event.kind === 'slain') await award($, slayAward(r.event.boss))
  else $.ui.toast(bossToast(r.event), { timeoutMs: TOAST_MS })
}

async function award($: EngineInterface, a: Award): Promise<void> {
  if (turn) turn = { ...turn, points: turn.points + a.points, events: [...turn.events, a.event] }
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
  const u = await $.session.usage()
  usage = { contextPercent: u.context.percent, usd: u.cost?.usd, rateLimits: u.rateLimits }
  await showScore($)
}

// ------------------------------------------------------------------------------------------ Sponsor Mail

const MAIL_TICK_MS = 30_000
const MAIL_TITLE = 'Sponsor Mail'
const GH_TIMEOUT_MS = 20_000

async function tell($: EngineInterface, text: string, title: string): Promise<void> {
  const sent = await $.ui.notify(text, { title }).catch(() => undefined)
  if (!sent?.isSent) $.ui.toast(`${title}: ${text}`, { timeoutMs: TOAST_MS })
}

async function lookAtPr($: EngineInterface, w: Pick<MailWatch, 'url' | 'root'>): Promise<Pr | undefined> {
  const r = await $.process.run(prQueryArgv(w.url), { cwd: w.root, timeoutMs: GH_TIMEOUT_MS })
  return r.exitCode === 0 ? parsePr(r.stdout) : undefined
}

/** Starts the watch on the PR at `url`, or this branch's PR; says what came of it. */
async function beginMail($: EngineInterface, url?: string): Promise<string> {
  const root = (await $.process.run(['git', 'rev-parse', '--show-toplevel'])).stdout.trim()
  if (!root) return 'Sponsor Mail: not inside a git repository.'
  const found =
    url ??
    (await $.process.run(['gh', 'pr', 'view', '--json', 'url', '-q', '.url'], { cwd: root, timeoutMs: GH_TIMEOUT_MS }))
      .stdout.trim()
  if (!prRefOf(found)) return 'Sponsor Mail: no pull request for this branch.'
  const pr = await lookAtPr($, { url: found, root })
  if (!pr) return `Sponsor Mail: gh could not read ${found}.`
  if (pr.state !== 'OPEN') return `Sponsor Mail: PR #${pr.number} is ${pr.state.toLowerCase()}; nothing to watch.`
  const now = await $.clock.now()
  const w = startWatch(pr, root, now)
  await update($, mailWatch, () => w)
  mailDueAt = now + nextPollMs(w, now)
  return `Sponsor Mail: watching PR #${pr.number}.`
}

async function deliver($: EngineInterface, w: MailWatch, ev: MailEvent): Promise<void> {
  if (ev.kind === 'mail') await tell($, mailNotice(w, ev.mail), MAIL_TITLE)
  else if (ev.kind === 'answered') await award($, answeredAward(w, ev.count))
  else if (ev.kind === 'red') {
    await tell($, redNotice(w, ev.names), MAIL_TITLE)
    await award($, redAward(w, ev.names))
  } else if (ev.kind === 'green') $.ui.toast(`PR #${w.number}: every check is green`, { timeoutMs: TOAST_MS })
  else if (ev.kind === 'merged') await award($, mergeAward(w))
  else $.ui.toast(`PR #${w.number} was closed: Sponsor Mail stops watching it`, { timeoutMs: TOAST_MS })
}

/**
 * One look at the Watched PR. `claim` follows a post of Claude's: the viewer's new comments are Claude's and
 * never Mail. An unclaimed look that a post overlapped is thrown away, as it may hold Claude's comment unclaimed.
 */
async function lookMail($: EngineInterface, claim: boolean): Promise<void> {
  const before = await read($, mailWatch)
  if (!before) return
  mailLooks++
  const gen = postGen
  try {
    const branch = await $.process.run(['git', '-C', before.root, 'branch', '--show-current'])
    const now = await $.clock.now()
    const at = branch.stdout.trim()
    if (branch.exitCode === 0 && at !== '' && at !== before.branch) {
      await update($, mailWatch, () => null)
      $.ui.toast(`Left ${before.branch}: Sponsor Mail stops watching PR #${before.number}`, { timeoutMs: TOAST_MS })
      return
    }
    const pr = await lookAtPr($, before)
    if (!claim && (gen !== postGen || posting > 0)) return
    mailDueAt = now + nextPollMs(before, now)
    const w = await read($, mailWatch)
    if (!pr || !w || w.number !== pr.number) return
    const r = step(claim ? claimMine(w, pr) : w, pr, now)
    await update($, mailWatch, () => r.watch ?? null)
    if (r.watch) mailDueAt = now + nextPollMs(r.watch, now)
    for (const ev of r.events) await deliver($, w, ev)
  } finally {
    mailLooks--
  }
}

function startMail($: EngineInterface): void {
  mailDueAt = 0
  $.clock.every(MAIL_TICK_MS, () => {
    if (mailLooks > 0 || posting > 0) return
    void $.clock
      .now()
      .then(now => (now >= mailDueAt ? lookMail($, false) : undefined))
      .catch(() => undefined)
  })
}

// ------------------------------------------------------------------------------------------- Beast Watch

const BEAST_TICK_MS = 60_000
/** Every this many ticks the look sends a token too: often enough to catch Wedged, rare enough to spare the cache. */
const BEAST_TOKEN_EVERY = 5
const BEAST_TITLE = 'Beast Watch'
const PI_ENV = 'cat "${PI_IMPLEMENTER_HOME:-$HOME/.config/pi-implementer}/env" 2>/dev/null'

async function piEnv($: EngineInterface): Promise<string> {
  return (await $.process.run(['sh', '-c', PI_ENV])).stdout
}

/**
 * One look at Beast: nvidia-smi over ssh, llama-server's /health and, on a router, the Dispatches' model; then,
 * when that model is loaded and nothing would queue it, one token. `isQuick` leaves the token out.
 */
async function lookAtBeast($: EngineInterface, isQuick = false): Promise<Reading> {
  const env = await piEnv($)
  const url = llamaUrlOf(env)
  const host = url && hostOf(url)
  if (!url || !host) return { state: 'down', reason: 'no LLAMA_URL in pi-implementer env' }
  beastHost = host
  // The API key goes in on stdin (`-H @-`), never on argv where ps would show it.
  const key = llamaKeyOf(env)
  const curl = (...args: string[]) =>
    $.process.run(['curl', '-s', '-H', '@-', ...args], {
      stdin: key ? `Authorization: Bearer ${key}\n` : '',
      timeoutMs: 25_000,
    })
  const alias = modelAliasOf(env)
  const [smi, health, models] = await Promise.all([
    $.process.run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', host, SMI_QUERY], { timeoutMs: 15_000 }),
    curl('-m', '5', '-w', '\n%{http_code}', `${url}/health`),
    curl('-m', '5', `${url}/v1/models`),
  ])
  const probe: Probe = { smi, health: healthOf(health.stdout), model: modelStateOf(models.stdout, alias) }
  // Never a token to a model that is not loaded: on a router it would load it, evicting whatever is.
  const isProbed = !isQuick && smi.exitCode === 0 && probe.health.code === 200 && (probe.model ?? 'loaded') === 'loaded'
  if (isProbed) {
    const query = alias ? `?model=${encodeURIComponent(alias)}` : ''
    const isDispatching = (watch?.running.size ?? 0) > 0 || isBusy((await curl('-m', '5', `${url}/slots${query}`)).stdout)
    if (isDispatching) probe.completion = 'skipped'
    else {
      const body = JSON.stringify({ ...(alias ? { model: alias } : {}), prompt: 'hi', max_tokens: 1 })
      const r = await curl('-m', '20', '-o', '/dev/null', '-w', '%{http_code}', '-H', 'Content-Type: application/json',
        '-d', body, `${url}/v1/completions`)
      probe.completion = r.exitCode === 28 ? 'timeout' : r.exitCode === 0 && r.stdout.trim() === '200' ? 'ok' : 'error'
    }
  }
  return judge(probe)
}

/** Looks at Beast, keeps the reading, and tells of it going Down or coming back. */
async function checkBeast($: EngineInterface, isQuick = false): Promise<Reading> {
  const looked = await lookAtBeast($, isQuick)
  const before = (await read($, beast)).reading
  // A look without the token cannot see Wedged: it leaves a Wedged Beast Wedged until a token gets through.
  const r = isQuick && looked.state === 'up' && before?.reason === 'wedged' ? before : looked
  await update($, beast, b => ({ ...b, reading: r }))
  const t = transition(before, r)
  if (t === 'down') await tell($, `Beast is Down: ${r.reason ?? 'unknown'}`, BEAST_TITLE)
  else if (t === 'recovered') $.ui.toast('Beast is back Up', { timeoutMs: TOAST_MS })
  await showScore($)
  return r
}

function beastTicks($: EngineInterface): void {
  beastTimer?.cancel()
  beastTimer = $.clock.every(BEAST_TICK_MS, () => {
    if (isBeastLooking) return
    isBeastLooking = true
    void checkBeast($, ++beastTickCount % BEAST_TOKEN_EVERY !== 0)
      .catch(() => undefined)
      .finally(() => {
        isBeastLooking = false
      })
  })
}

/** The first use of Beast wakes the watch: a look now, and one a minute after. */
async function wakeBeast($: EngineInterface): Promise<Reading> {
  const b = await read($, beast)
  if (!b.isAwake) {
    await update($, beast, x => ({ ...x, isAwake: true }))
    beastTicks($)
  }
  return checkBeast($)
}

const LOADING_POLL_S = 5

/**
 * The Beast Guard's verdict on a guarded line: a fresh look and, while Beast is Loading, a wait for it to end.
 * The wait sleeps in a process, as time spent in `$` calls is not the hook's own.
 */
async function guardBeast($: EngineInterface, line: string): Promise<string | undefined> {
  let r = await wakeBeast($)
  for (let waited = 0; r.state === 'loading' && waited < LOADING_WAIT_MS; waited += LOADING_POLL_S * 1000) {
    await $.process.run(['sleep', String(LOADING_POLL_S)])
    r = await lookAtBeast($, true)
  }
  if (r.state !== 'loading') r = await checkBeast($)
  const g = beastGuard(line, r)
  if (g.kind === 'deny') return g.reason
  if (g.kind === 'wait') return `Beast Guard: Beast is still Loading after ${LOADING_WAIT_MS / 60_000} minutes; try again soon.`
  return undefined
}

// ------------------------------------------------------------------------------------------- the voice

/** The Verdict for a Notable Turn: a model-written line when the quip writer is free, the plain one otherwise. */
async function verdict($: EngineInterface, stats: TurnStats): Promise<string> {
  if (isQuipBusy) return verdictLine(fallbackVerdict(stats), stats, false)
  isQuipBusy = true
  quipAt = await $.clock.now()
  try {
    const r = await $.model.complete({
      model: QUIP_MODEL,
      system: VERDICT_SYSTEM,
      prompt: verdictPrompt(stats),
      maxTokens: 80,
      effort: 'low',
      timeoutMs: VERDICT_TIMEOUT_MS,
    })
    const line = r.isAnswered ? cleanQuip(r.text) : undefined
    return line ? verdictLine(line, stats, true) : verdictLine(fallbackVerdict(stats), stats, false)
  } catch {
    return verdictLine(fallbackVerdict(stats), stats, false)
  } finally {
    isQuipBusy = false
  }
}

// ------------------------------------------------------------------------------------------------ hooks

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await startPoints($)
    await startBoard($)
    await $.command.register({ name: 'tdd', description: 'Show or hide the TDD Band above the prompt' })
    await $.command.register({ name: 'watch-pr', description: "Sponsor Mail: watch this branch's PR" })
    await $.command.register({ name: 'unwatch-pr', description: 'Sponsor Mail: stop watching the PR' })
    await $.command.register({ name: 'beast', description: "Beast Watch: look at Beast's health now" })
    startMail($)
    beastHost = hostOf(llamaUrlOf(await piEnv($)) ?? '')
    if ((await read($, beast)).isAwake) beastTicks($)
    return next(e)
  })

  // -------------------------------------------------------------------------------------- Beast Guard

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!isGuarded(e.command)) return next(e)
    const reason = await guardBeast($, e.command)
    return reason ? { deny: reason } : next(e)
  }).catch(($, e, next) => next(e)) // a broken guard fails open: the line runs as written

  on('command.run', { command: 'beast' }, async $ => {
    const r = await wakeBeast($)
    return { text: `${beastSegment(r)}${r.state === 'up' ? '' : ' (Beast Guard refuses Dispatches while Down)'}` }
  })

  // ------------------------------------------------------------------------------------- Sponsor Mail

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (isBeastUse(e.command, beastHost) && !(await read($, beast)).isAwake) {
      $.clock.after(0, () => void wakeBeast($).catch(() => undefined))
    }
    const isPosting = isPost(e.command) && (await read($, mailWatch)) !== null
    if (isPosting) {
      posting++
      postGen++
    }
    let ran: Awaited<ReturnType<typeof next>>
    try {
      ran = await next(e)
    } finally {
      if (isPosting) posting--
    }
    const result = ran.result as { backgroundTaskId?: string; stdout?: string } | undefined
    const isDone = ran.deny === undefined && ran.isError !== true && !result?.backgroundTaskId
    try {
      if (isDone && isPosting) await lookMail($, true)
      else if (isDone && isPrCreate(e.command)) {
        const url = result?.stdout?.match(/https:\/\/\S+\/pull\/\d+/)?.[0]
        $.clock.after(0, () => void beginMail($, url).then(text => $.ui.toast(text, { timeoutMs: TOAST_MS })).catch(() => undefined))
      }
    } catch {
      // the line ran: a failed look leaves Sponsor Mail to its next tick
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'watch-pr' }, async $ => ({ text: await beginMail($) }))

  on('command.run', { command: 'unwatch-pr' }, async $ => {
    const w = await read($, mailWatch)
    await update($, mailWatch, () => null)
    return { text: w ? `Sponsor Mail: stopped watching PR #${w.number}.` : 'Sponsor Mail: no PR was watched.' }
  })

  // ------------------------------------------------------------------------------------- Podman Guard

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const g = guard(e.command)
    if (g.kind === 'pass') return next(e)
    if (g.kind === 'deny') return { deny: g.reason }
    const ran = await next({ ...e, command: g.command })
    if (ran.deny !== undefined) return ran
    return { ...ran, context: [...(ran.context ?? []), rewriteNote(e.command, g.command)] }
  }).catch(($, e, next) => next(e)) // a broken guard fails open: the line runs as written

  // ------------------------------------------------------------------------------------- Branch Guard

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const steps = gitSteps(e.command)
    if (steps.length === 0) return next(e)
    const repos = new Map<string, Repo | undefined>()
    for (const dir of new Set(steps.map(s => s.dir))) repos.set(dir, await repoAt($, dir))
    const g = branchGuard(e.command, dir => repos.get(dir))
    return g.kind === 'deny' ? { deny: g.reason } : next(e)
  }).catch(($, e, next) => next(e)) // a broken guard fails open: the line runs as written

  // ----------------------------------------------------------------------------------------------- HUD

  on('session.measure', async ($, e, next) => {
    usage = { contextPercent: e.context.percent, usd: e.cost?.usd, rateLimits: e.rateLimits }
    await showScore($)
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId || r.skip !== undefined) return r
    const a = compactAward(e.trigger, usage?.contextPercent)
    if (a) await award($, a)
    return r
  }).catch(($, e, next) => next(e))

  // ------------------------------------------------------------------------------------------ TDD Band

  on('agent.spawn', async ($, e, next) => {
    await update($, tdd, t => onAgent(t, e.subagentType))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'tdd' }, async $ => {
    const t = await update($, tdd, toggle)
    return { text: `TDD Band ${isShown(t) ? 'shown' : 'hidden'}.` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const t = await read($, tdd)
    const fight = newestBoss(await read($, bosses))
    const w = await read($, mailWatch)
    if (!isShown(t) && !fight && !w) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const checks = w && tally(w.checks)
    const mailRow = w && checks && (
      <Box key="mail" gap={1}>
        <Text bold color="cyan">
          📬 PR #{w.number}
        </Text>
        {checks.total > 0 && (
          <Text color={checks.failed.length > 0 ? 'red' : checks.pending.length > 0 ? 'yellow' : 'green'}>
            ✅ {checks.passed}/{checks.total}
          </Text>
        )}
        {checks.pending.length > 0 && <Text color="yellow">⏳ {checks.pending.length}</Text>}
        {checks.failed.length > 0 && (
          <Text color="red" wrap="truncate-end">
            ❌ {checks.failed.join(', ')}
          </Text>
        )}
        {w.mail.length > 0 && <Text bold>💬 {w.mail.length} unanswered</Text>}
        {w.mail.length > 0 && (
          <Button
            hotkey="a"
            label="Address them"
            plain
            onPress={() => void $.prompt.submit({ text: addressPrompt(w) }).catch(() => undefined)}
          />
        )}
        {checks.failed.length > 0 && (
          <Button
            hotkey="f"
            label="Fix it"
            plain
            onPress={() => void $.prompt.submit({ text: fixPrompt(w) }).catch(() => undefined)}
          />
        )}
      </Box>
    )
    const v = verdictOf(t)
    const bossRow = fight && (
      <Box key="boss" gap={1}>
        <Text bold color="red">
          ☠ FLOOR BOSS
        </Text>
        <Text bold>{fight.boss.name}</Text>
        <Text color="red">{hpBar(fight.boss)}</Text>
        <Text dimColor wrap="truncate-end">
          {fight.key}
          {fight.others > 0 ? ` · +${fight.others} more` : ''}
        </Text>
      </Box>
    )
    const tddRow = isShown(t) && (
      <Box key="tdd" gap={1}>
        <Text bold color={TDD_COLOR[t.phase ?? 'NONE']}>
          {t.phase ? `${TDD_ICON[t.phase]} ${t.phase}` : '· TDD'}
        </Text>
        <Text color={MOOD_COLOR[v.mood]} wrap="truncate-end">
          {v.note}
        </Text>
        {DRAFTS.map(d => (
          <Button
            key={d.hotkey}
            hotkey={d.hotkey}
            label={d.label}
            plain
            onPress={() => void $.prompt.fill({ text: d.draft }).catch(() => undefined)}
          />
        ))}
      </Box>
    )
    const rows = [bossRow, mailRow, tddRow].filter(r => !!r)
    if (rows.length === 0) return next(e)
    return rows.length === 1 ? rows[0]! : <Box flexDirection="column">{rows}</Box>
  })

  // ------------------------------------------------------------------------------------------ the voice

  on('turn.start', async ($, e, next) => {
    turn = { toolCalls: 0, points: 0, events: [] }
    const mood = moodOf({
      contextPercent: usage?.contextPercent,
      debuff: (await read($, score)).debuff,
      isDispatching: (watch?.running.size ?? 0) > 0,
    })
    spinner = spinnerWord(mood, Math.random())
    return next(e)
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) =>
    e.surface === 'terminal' && spinner ? next({ ...e, props: { ...e.props, word: spinner } }) : next(e),
  )

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    const stats = turn && { ...turn, durationMs: e.durationMs }
    if (e.agentId) return r
    turn = undefined
    spinner = undefined
    if (!stats || e.reason !== 'answer' || !isNotable(stats)) return r
    return { ...r, text: await verdict($, stats) }
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
    if (turn && !e.agentId) turn = { ...turn, toolCalls: turn.toolCalls + 1 }
    const ran = await next(e)
    const isDenied = ran.deny !== undefined
    if (e.tool === 'Bash') {
      const result = ran.result as { backgroundTaskId?: string; stdout?: string; stderr?: string } | undefined
      if (!isDenied && result?.backgroundTaskId) return ran // still running: nothing to score yet
      if (isDenied) {
        await award($, errorAward('Bash', true))
        return ran
      }
      let checked: boolean | undefined
      for (const a of bashAwards(e.command, ran.isError === true, await read($, score), !hasChecked)) {
        if (a.isGreen !== undefined) {
          hasChecked = true
          const isGreen = a.isGreen
          checked = isGreen
          await update($, tdd, t => onCheck(t, isGreen))
        }
        await award($, a)
      }
      const key = checkKey(e.command)
      if (key && checked !== undefined) await fight($, key, checked, `${result?.stdout ?? ''}\n${result?.stderr ?? ''}`)
      return ran
    }
    if (isDenied || ran.isError === true) await award($, errorAward(String(e.tool), isDenied))
    return ran
  })
}
