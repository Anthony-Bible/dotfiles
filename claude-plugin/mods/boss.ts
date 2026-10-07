// The Floor Boss's pure half: which Check command a line is, how many tests its output says failed, and the
// bosses that red runs summon and green ones slay. No `$` here.

import { classify, type Award } from './points'
import { words, type Word } from './shell'

/** A Floor Boss appears on this many red runs in a row of one Check command. */
export const SUMMON_AT = 3

export const BOSS_NAMES = [
  'The Flaky Assertion, Devourer of CI',
  'Null Pointer Prime',
  'The Off-By-One Twins',
  'Grand Regent of Race Conditions',
  'The Undefined Behemoth',
  'Lord Segfault the Unflushed',
  'The Mocking Hydra',
  'Heisenbug, Who Vanishes When Watched',
  'The Timeout Lich',
  'Deadlock, Warden of the Mutex',
  'The Stale Cache Wyrm',
  'Queen Regression the Returning',
  'The Snapshot Mimic',
  'Captain Import Cycle',
  'The Floating-Point Phantom',
  'Brother Unhandled Rejection',
  'The Leaky Abstraction Ooze',
  'Typo, Bane of Compilers',
  'The Dependency Hell Hound',
  'The Memory-Leak Mantaur',
] as const

/** `order`: when it appeared, counting from 1 in the session, so the newest one leads the band. */
export type Boss = { name: string; hp: number; maxHp: number; order: number }
/** One Check command's run of reds since its last green, and the boss they summoned. */
export type Foe = { reds: number; boss?: Boss }
export type Bosses = { foes: Record<string, Foe>; summoned: number }

export const initialBosses: Bosses = { foes: {}, summoned: 0 }

export type BossEvent =
  | { kind: 'spawned'; boss: Boss }
  | { kind: 'damaged'; boss: Boss; by: number }
  | { kind: 'healed'; boss: Boss; by: number }
  | { kind: 'slain'; boss: Boss }

/** A redirection word: `>`, `2>`, `&>` alone take the next word as their target; `2>/dev/null` holds its own. */
const REDIRECT = /^(?:\d*|&)[<>]/
const BARE_REDIRECT = /^(?:\d*|&)[<>]+&?$/

/** A simple command's words as written, without its redirections. */
const cleaned = (line: string, group: readonly Word[]): string => {
  const kept: string[] = []
  for (let i = 0; i < group.length; i++) {
    const w = group[i] as Word
    if (BARE_REDIRECT.test(w.text)) i++
    else if (!REDIRECT.test(w.text)) kept.push(line.slice(w.start, w.end))
  }
  return kept.join(' ')
}

/**
 * The foe a Bash line fights: its Check commands and the `cd`s before them, without what their output is piped
 * through or redirected to; undefined when the line runs no Check.
 */
export const checkKey = (line: string): string | undefined => {
  const groups: Word[][] = []
  for (const w of words(line)) {
    if (w.startsCommand || groups.length === 0) groups.push([])
    ;(groups[groups.length - 1] as Word[]).push(w)
  }
  const parts = groups.map(g => cleaned(line, g)).filter(Boolean)
  const kinds = parts.map(p => (p.startsWith('cd ') || p === 'cd' ? 'cd' : classify(p)))
  const last = kinds.lastIndexOf('check')
  if (last < 0) return undefined
  return parts.filter((_, i) => i <= last && (kinds[i] === 'check' || kinds[i] === 'cd')).join(' && ')
}

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0)

/** How many tests a red Check's output says failed, by the runners' own summaries; undefined when none says. */
export const failingCount = (output: string): number | undefined => {
  const jest = /^\s*Tests:?\s+(\d+) failed/m.exec(output) // jest, vitest
  if (jest) return Number(jest[1])
  const goFails = output.match(/^--- FAIL:/gm) // go test: top-level tests only, not subtests
  if (goFails) return goFails.length
  const cargo = [...output.matchAll(/^test result: FAILED\..*?(\d+) failed/gm)]
  if (cargo.length > 0) return sum(cargo.map(m => Number(m[1])))
  const pytest = /\b(\d+) failed\b[^\n]* in [\d.]+s\b/.exec(output)
  if (pytest) return Number(pytest[1])
  const bun = /^\s*(\d+) fail$/m.exec(output) // bun test, claude plugin test
  if (bun) return Number(bun[1])
  return undefined
}

const hash = (s: string): number => {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

/** The name a command's boss takes: one from its hash, stepping past names living bosses already hold. */
const bossName = (key: string, taken: ReadonlySet<string>): string => {
  const start = hash(key) % BOSS_NAMES.length
  for (let i = 0; i < BOSS_NAMES.length; i++) {
    const name = BOSS_NAMES[(start + i) % BOSS_NAMES.length] as string
    if (!taken.has(name)) return name
  }
  return BOSS_NAMES[start] as string
}

/**
 * A Check of the command `key` finished. A green one ends its foe (slaying any boss); a red one extends the run
 * of reds, summons a boss on the SUMMON_AT-th, and sets a living boss's HP to `failing` when the output said.
 */
export const onBossCheck = (
  s: Bosses,
  key: string,
  isGreen: boolean,
  failing?: number,
): { bosses: Bosses; event?: BossEvent } => {
  const foe = s.foes[key]
  if (isGreen) {
    const { [key]: _, ...foes } = s.foes
    return { bosses: { ...s, foes }, event: foe?.boss && { kind: 'slain', boss: foe.boss } }
  }
  const reds = (foe?.reds ?? 0) + 1
  const was = foe?.boss
  if (was) {
    const hp = failing ?? was.hp
    const boss = { ...was, hp, maxHp: Math.max(was.maxHp, hp) }
    const bosses = { ...s, foes: { ...s.foes, [key]: { reds, boss } } }
    const event: BossEvent | undefined =
      hp < was.hp ? { kind: 'damaged', boss, by: was.hp - hp } : hp > was.hp ? { kind: 'healed', boss, by: hp - was.hp } : undefined
    return { bosses, event }
  }
  if (reds < SUMMON_AT) return { bosses: { ...s, foes: { ...s.foes, [key]: { reds } } } }
  const taken = new Set(Object.values(s.foes).flatMap(f => (f.boss ? [f.boss.name] : [])))
  const hp = failing ?? 1
  const boss = { name: bossName(key, taken), hp, maxHp: hp, order: s.summoned + 1 }
  return {
    bosses: { foes: { ...s.foes, [key]: { reds, boss } }, summoned: boss.order },
    event: { kind: 'spawned', boss },
  }
}

/** The boss the band shows, the newest living one, and how many more are alive. */
export const newestBoss = (s: Bosses): { key: string; boss: Boss; others: number } | undefined => {
  const living = Object.entries(s.foes).flatMap(([key, f]) => (f.boss ? [{ key, boss: f.boss }] : []))
  if (living.length === 0) return undefined
  const newest = living.reduce((a, b) => (b.boss.order > a.boss.order ? b : a))
  return { ...newest, others: living.length - 1 }
}

export const slayAward = (boss: Boss): Award => ({
  points: 100,
  event: `slew the Floor Boss ${boss.name}`,
  achievement: `Slew ${boss.name}`,
})

/** The HP bar the band draws: one heart per point up to ten, then a count. */
export const hpBar = (b: Boss): string => (b.maxHp <= 10 ? '♥'.repeat(b.hp) + '♡'.repeat(b.maxHp - b.hp) : `HP ${b.hp}/${b.maxHp}`)

/** The toast for a boss event, in the System's voice. */
export const bossToast = (e: BossEvent): string =>
  ({
    spawned: `*Ding!* A Floor Boss appears: ${e.boss.name} (HP ${e.boss.hp}). The audience is on its feet.`,
    damaged: `*Ding!* ${e.boss.name} takes ${'by' in e ? e.by : 0} damage. HP ${e.boss.hp}/${e.boss.maxHp}.`,
    healed: `*Ding!* ${e.boss.name} regenerates ${'by' in e ? e.by : 0} HP. The Crawler made it stronger.`,
    slain: `*Ding!* ${e.boss.name} has been slain!`,
  })[e.kind]
