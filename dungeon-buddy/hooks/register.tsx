// Buddy: /buddy hatches the Crawler's dungeon pet from their account; it sits at the right of the band above the
// prompt, fidgets at rest and, now and then, says a Bubble about the session's Mishaps and Long Hauls. With
// dotfiles-dev-tools installed it talks back to the System's Cues instead, and a Reroll costs Crawler Points.
//
// Every use of `$` lives in this file (the engine follows `$` into this file's functions, never across an
// import); the rules are in ../mods/buddy.ts.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import {
  accountOf,
  BUBBLE_MS,
  BUDDY_SYSTEM,
  bubblePrompt,
  cannedBubble,
  card,
  cleanBubble,
  cueOf,
  EGG,
  fallbackSoul,
  FIDGET_MS,
  FIDGET_TICK_MS,
  fidgetOf,
  isForced,
  longHaulOf,
  mishapOf,
  parseSoul,
  RARITY_COLOR,
  rerollPrice,
  rerollRefusal,
  restLine,
  roll,
  seedOf,
  soulPrompt,
  SOUL_SYSTEM,
  spriteOf,
  willSpeak,
  type Moment,
  type Soul,
} from '../mods/buddy'
import type { BuddyCueState, BuddyState } from '../types'

// ---------------------------------------------------------------------------------------------- state

const buddy = atom({ plugin: 'dungeon-buddy', key: 'buddy' } as const, { isShown: true } as BuddyState)
const buddyCue = atom({ plugin: 'dungeon-buddy', key: 'cue' } as const, { n: 0 } as BuddyCueState)

const STORE_BUDDY = 'buddy.saved'
const MODEL = 'haiku'
const SOUL_TIMEOUT_MS = 6000
const BUBBLE_TIMEOUT_MS = 4000
const EGG_FRAME_MS = 700
/** The account line of the Crawler's login, read straight from their config; never the whole file. */
const ACCOUNT_LINE = `grep -m1 -o '"emailAddress"[[:space:]]*:[[:space:]]*"[^"]*"' "$HOME/.claude.json" 2>/dev/null`

// Module variables: a hot reload starts them over, which costs at most an early Bubble or a missed Long Haul.
/** When its last Bubble began, whether a Bubble's model call is in flight, and the timer that ends it. */
let bubbleAt = -Infinity
let isBubbleBusy = false
let bubbleTimer: { cancel: () => void } | undefined
let bubbleSeq = 0
/** The fidget ticks, and the timer that ends the fidget it is in. */
let fidgetTimer: { cancel: () => void } | undefined
let poseTimer: { cancel: () => void } | undefined
/** Whether a Reroll is going through: a second one waits out the first, whose price may not be charged yet. */
let isRerolling = false
/** The main loop's tool calls this turn, for a Long Haul; undefined between turns. */
let turnCalls: number | undefined

// ------------------------------------------------------------------------------------------------ Buddy

/** What the Buddy keeps across sessions: the Rerolls made on this machine, its Soul, whether it hides. */
type SavedBuddy = { rerolls: number; soul?: Soul; isHidden?: boolean; account?: string }

async function savedBuddy($: EngineInterface): Promise<SavedBuddy> {
  const v = (await $.store.get(STORE_BUDDY)) as Partial<SavedBuddy> | undefined
  return { ...v, rerolls: Number.isFinite(v?.rerolls) ? Number(v?.rerolls) : 0 }
}

/** The account the Hatch is seeded from: the login's email, else a random one made once and kept. */
async function buddyAccount($: EngineInterface, saved: SavedBuddy): Promise<string> {
  const found = accountOf((await $.process.run(['sh', '-c', ACCOUNT_LINE])).stdout)
  if (found) {
    if (saved.account !== found) await $.store.set(STORE_BUDDY, { ...saved, account: found })
    return found
  }
  if (saved.account) return saved.account
  const made = `anon-${Math.random().toString(36).slice(2)}`
  await $.store.set(STORE_BUDDY, { ...saved, account: made })
  return made
}

/** Whether dotfiles-dev-tools runs this session: it writes its Cue as it starts. */
async function hasShow($: EngineInterface): Promise<boolean> {
  return (await $.state.get({ plugin: 'dotfiles-dev-tools', key: 'cue' })).version > 0
}

/** Tells dotfiles-dev-tools what the Buddy did, for it to price. */
async function announce($: EngineInterface, cue: NonNullable<BuddyCueState['cue']>): Promise<void> {
  await update($, buddyCue, c => ({ n: c.n + 1, cue }))
}

async function startBuddy($: EngineInterface): Promise<void> {
  bubbleAt = -Infinity
  fidgetTicks($)
  await restoreBuddy($, await savedBuddy($))
}

/** Puts the kept Buddy back in the session's state; false when none is kept for this account's seed. */
async function restoreBuddy($: EngineInterface, saved: SavedBuddy): Promise<boolean> {
  if (!saved.soul) return false
  const seed = seedOf(await buddyAccount($, saved), saved.rerolls)
  // A Soul written for another seed (another login) is not this Buddy's: /buddy hatches the right one.
  if (saved.soul.seed !== seed) return false
  await update($, buddy, () => ({ seed, name: saved.soul!.name, isShown: !saved.isHidden }))
  return true
}

async function writeSoul($: EngineInterface, seed: string): Promise<Soul> {
  const hatch = roll(seed)
  try {
    const r = await $.model.complete({
      model: MODEL,
      system: SOUL_SYSTEM,
      prompt: soulPrompt(hatch),
      maxTokens: 80,
      effort: 'low',
      timeoutMs: SOUL_TIMEOUT_MS,
    })
    return (r.isAnswered && parseSoul(r.text, seed)) || fallbackSoul(hatch, seed)
  } catch {
    return fallbackSoul(hatch, seed)
  }
}

/**
 * Hatches the Buddy for `seed`: its Soul written and kept, then, `delayMs` on, the egg cracking above the
 * prompt and the Buddy greeting the Crawler. Answers the stat card.
 */
async function hatchBuddy($: EngineInterface, seed: string, delayMs: number): Promise<string> {
  const soul = await writeSoul($, seed)
  // Read again: finding the account may have just kept a made-up one.
  await $.store.set(STORE_BUDDY, { ...(await savedBuddy($)), soul, isHidden: false })
  const hatch = roll(seed)
  const frame = (n: number, fn: () => Promise<unknown>) =>
    $.clock.after(delayMs + n * EGG_FRAME_MS, () => void fn().catch(() => undefined))
  EGG.forEach((_, n) => frame(n, () => update($, buddy, b => ({ ...b, isShown: true, bubble: undefined, egg: n }))))
  frame(EGG.length, async () => {
    await update($, buddy, () => ({ seed, name: soul.name, isShown: true }))
    await say($, { kind: 'hatched' })
    if (hatch.rarity === 'legendary') await announce($, { kind: 'legendary', species: hatch.species })
  })
  return card(hatch, soul)
}

/** Now and then, CHAOS-weighted, the Buddy at rest fidgets for a moment and settles back. */
function fidgetTicks($: EngineInterface): void {
  fidgetTimer?.cancel()
  fidgetTimer = $.clock.every(FIDGET_TICK_MS, () => void fidget($).catch(() => undefined))
}

async function fidget($: EngineInterface): Promise<void> {
  const b = await read($, buddy)
  if (!b.seed || !b.name || !b.isShown || b.egg !== undefined || b.bubble || b.pose !== undefined) return
  const pose = fidgetOf(roll(b.seed), Math.random(), Math.random())
  if (pose === undefined) return
  await update($, buddy, x => ({ ...x, pose }))
  poseTimer?.cancel()
  poseTimer = $.clock.after(FIDGET_MS, () => void update($, buddy, x => ({ ...x, pose: undefined })).catch(() => undefined))
}

/** The Buddy speaks of `m` off the caller's dispatch: a tool call never waits on a Bubble. */
function sayLater($: EngineInterface, m: Moment): void {
  $.clock.after(0, () => void say($, m).catch(() => undefined))
}

/** A Mishap or Long Haul, said only without dotfiles-dev-tools: with it, its Cues tell of the same events. */
function sayOwnLater($: EngineInterface, m: Moment): void {
  $.clock.after(0, () => void (async () => (await hasShow($)) || (await say($, m)))().catch(() => undefined))
}

/** The Buddy says a Bubble about `m`, when it is shown, out of the gap and its CHAOS lets it. */
async function say($: EngineInterface, m: Moment): Promise<void> {
  const b = await read($, buddy)
  if (!b.seed || !b.name || !b.isShown || b.egg !== undefined) return
  const hatch = roll(b.seed)
  const now = await $.clock.now()
  if (!willSpeak(hatch, m, now, bubbleAt, Math.random()) || (isBubbleBusy && !isForced(m))) return
  bubbleAt = now
  const seq = ++bubbleSeq
  let text = cannedBubble(m, Math.random())
  if (m.kind !== 'pet' && !isBubbleBusy) {
    isBubbleBusy = true
    try {
      const soul = (await savedBuddy($)).soul
      const r = await $.model.complete({
        model: MODEL,
        system: BUDDY_SYSTEM,
        prompt: bubblePrompt(hatch, { name: b.name, personality: soul?.personality ?? '' }, m),
        maxTokens: 40,
        effort: 'low',
        timeoutMs: BUBBLE_TIMEOUT_MS,
      })
      if (seq !== bubbleSeq) return
      text = (r.isAnswered && cleanBubble(r.text)) || text
    } catch {
      // the model call failed or timed out: the canned Bubble stands
    } finally {
      isBubbleBusy = false
    }
  }
  if (seq !== bubbleSeq) return
  await update($, buddy, x => ({ ...x, bubble: text }))
  bubbleTimer?.cancel()
  bubbleTimer = $.clock.after(BUBBLE_MS, () => void update($, buddy, x => ({ ...x, bubble: undefined })).catch(() => undefined))
}

async function setShown($: EngineInterface, isShown: boolean): Promise<void> {
  if (!isShown) {
    bubbleTimer?.cancel()
    bubbleTimer = undefined
  }
  await update($, buddy, b => ({ ...b, isShown, ...(isShown ? {} : { bubble: undefined }) }))
  await $.store.set(STORE_BUDDY, { ...(await savedBuddy($)), isHidden: !isShown })
}

/** Why a Reroll can't happen now: only dotfiles-dev-tools' Crawler Points can refuse one. */
async function refusal($: EngineInterface): Promise<string | undefined> {
  if (!(await hasShow($))) return undefined
  return rerollRefusal(Number((await $.state.get({ plugin: 'dotfiles-dev-tools', key: 'allTime' })).value ?? 0))
}

const NO_BUDDY = 'No Buddy yet: /buddy hatches one.'

/** `/buddy [pet | hide | show | reroll [confirm]]`. */
async function buddyCommand($: EngineInterface, args: string): Promise<string> {
  const saved = await savedBuddy($)
  const b = await read($, buddy)
  const verb = args.trim().toLowerCase().replace(/\s+/g, ' ')
  if (verb === '') {
    if (b.egg !== undefined) return 'Your egg is hatching!'
    // The state may have lost a kept Buddy (a /clear): bring it back rather than hatch over its Soul.
    if (await restoreBuddy($, saved)) {
      await setShown($, true)
      return card(roll(saved.soul!.seed), saved.soul!)
    }
    return hatchBuddy($, seedOf(await buddyAccount($, saved), saved.rerolls), 0)
  }
  if (!b.seed || !b.name) return NO_BUDDY
  switch (verb) {
    case 'pet':
      await say($, { kind: 'pet' })
      return `You pet ${b.name}. ♥`
    case 'hide':
      await setShown($, false)
      return `${b.name} hides. /buddy show brings them back.`
    case 'show':
      await setShown($, true)
      return `${b.name} is back.`
    case 'reroll':
      return (
        (await refusal($)) ??
        `A Reroll abandons ${b.name} for a new Hatch (${rerollPrice(await hasShow($))}). /buddy reroll confirm to go through with it.`
      )
    case 'reroll confirm': {
      if (b.egg !== undefined || isRerolling) return 'Wait for your egg to hatch first.'
      isRerolling = true
      try {
        const refused = await refusal($)
        if (refused) return refused
        await announce($, { kind: 'reroll' })
        await say($, { kind: 'reroll' })
        const next = { ...saved, rerolls: saved.rerolls + 1 }
        await $.store.set(STORE_BUDDY, next)
        // The goodbye Bubble shows first; the new egg cracks once it has been read.
        return `${b.name} is gone.\n\n${await hatchBuddy($, seedOf(await buddyAccount($, next), next.rerolls), 4000)}`
      } finally {
        isRerolling = false
      }
    }
    default:
      return 'Usage: /buddy [pet | hide | show | reroll]'
  }
}

// ------------------------------------------------------------------------------------------------ hooks

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'buddy', description: 'Buddy: hatch or show your dungeon pet (pet, hide, show, reroll)' })
    await startBuddy($)
    return next(e)
  })

  // A /clear starts the session over with fresh state and no session.start: the kept Buddy comes back here.
  on('classic.SessionStart', async ($, e, next) => {
    const r = await next(e)
    if (e.source === 'clear') await startBuddy($)
    return r
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'buddy' }, async ($, e) => ({ text: await buddyCommand($, e.args) }))

  // dotfiles-dev-tools announced a Cue: the Buddy may talk back to it.
  on('state.set', { plugin: 'dotfiles-dev-tools', key: 'cue' }, async ($, e, next) => {
    const r = await next(e)
    const cue = cueOf(e.value)
    if (cue) sayLater($, cue)
    return r
  }).catch(($, e, next) => next(e))

  // --------------------------------------------------------------------------- Mishaps and Long Hauls

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) turnCalls = 0
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (turnCalls !== undefined && !e.agentId) turnCalls++
    const ran = await next(e)
    if (e.tool !== 'Bash' || ran.deny !== undefined || ran.isError !== true) return ran
    const result = ran.result as { backgroundTaskId?: string } | undefined
    if (!result?.backgroundTaskId) sayOwnLater($, mishapOf(e.command))
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) return r
    const calls = turnCalls ?? 0
    turnCalls = undefined
    const m = e.reason === 'answer' ? longHaulOf(calls, e.durationMs) : undefined
    if (m) sayOwnLater($, m)
    return r
  })

  // ------------------------------------------------------------------------------------------- the band

  // At the right of the band, under whatever the plugins beneath (the System's rows) draw there.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const b = await read($, buddy)
    const hatch = b.seed ? roll(b.seed) : undefined
    if (!b.isShown || (b.egg === undefined && (!hatch || !b.name))) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const tint = hatch && (hatch.isShiny ? 'cyan' : RARITY_COLOR[hatch.rarity])
    const sprite = (lines: readonly string[], color?: string) => (
      <Box flexDirection="column">
        {lines.map((l, i) => (
          <Text key={`s${i}`} color={color}>
            {l}
          </Text>
        ))}
      </Box>
    )
    const row =
      b.egg !== undefined ? (
        <Box key="buddy" justifyContent="flex-end">
          {sprite(EGG[b.egg] ?? EGG[0]!)}
        </Box>
      ) : hatch && b.bubble ? (
        <Box key="buddy" justifyContent="flex-end" alignItems="center" gap={1}>
          <Box borderStyle="round" paddingX={1}>
            <Text wrap="truncate-end">{b.bubble}</Text>
          </Box>
          {sprite(spriteOf(hatch), tint)}
        </Box>
      ) : (
        hatch && (
          <Box key="buddy" justifyContent="flex-end">
            <Text color={tint}>{restLine(hatch, b.name!, b.pose)}</Text>
          </Box>
        )
      )
    const below = await next(e)
    return (
      <Box flexDirection="column">
        {below}
        {row}
      </Box>
    )
  })
}
