// The System's voice: Spinner Words and the Verdict under a Notable Turn. No `$` here.

export type Mood = 'collapsing' | 'debuffed' | 'dispatching' | 'normal'

/** Spinner Words by what the session is going through; the engine adds its own ellipsis after each. */
export const SPINNER_WORDS: Record<Mood, readonly string[]> = {
  normal: [
    'Consulting the Syndicate',
    'Rigging the betting pools',
    'Reviewing the sponsor contracts',
    'Polishing the loot boxes',
    'Warming up the studio audience',
    'Calibrating the death traps',
    'Cueing the dramatic music',
    'Re-reading the Crawler waivers',
    'Counting galactic credits',
    'Pre-writing the obituary',
    'Adjusting the camera drones',
    'Negotiating with the floor boss',
    'Inspecting the Crawler for shoes',
    'Lowering expectations',
    'Feeding the mantaurs',
    'Measuring the ratings',
  ],
  debuffed: [
    'Applying additional shame',
    'Replaying the blunder in slow motion',
    'Selling highlight reels of the failure',
    'Updating the blooper compilation',
    'Letting the audience boo',
    'Drafting the penalty notice',
  ],
  collapsing: [
    'Ceiling collapsing',
    'Counting down to the cave-in',
    'Evacuating the context window',
    'Shoring up the tunnel',
    'Listening to the walls creak',
  ],
  dispatching: [
    'Watching the local idiot work',
    'Supervising the cheap labor',
    'Placing bets on the local model',
    'Monitoring the minion',
  ],
}

/** From this much context the walls are coming down. */
export const COLLAPSING_FROM = 80

export type Moodboard = { contextPercent?: number; debuff?: string; isDispatching: boolean }

/** The mood that wins: a collapsing context, then a debuff, then a running Dispatch. */
export const moodOf = (m: Moodboard): Mood =>
  (m.contextPercent ?? 0) >= COLLAPSING_FROM
    ? 'collapsing'
    : m.debuff
      ? 'debuffed'
      : m.isDispatching
        ? 'dispatching'
        : 'normal'

/** A Spinner Word for the mood; `roll` in [0, 1) picks it, so the same roll always gives the same word. */
export const spinnerWord = (mood: Mood, roll: number): string => {
  const pool = SPINNER_WORDS[mood]
  return pool[Math.min(pool.length - 1, Math.floor(roll * pool.length))] as string
}

export type TurnStats = { durationMs: number; toolCalls: number; points: number; events: readonly string[] }

export const NOTABLE_MS = 60_000
export const NOTABLE_TOOLS = 10

/** A Notable Turn: it earned an Award, ran longer than a minute, or made NOTABLE_TOOLS tool calls or more. */
export const isNotable = (s: TurnStats): boolean =>
  s.events.length > 0 || s.durationMs > NOTABLE_MS || s.toolCalls >= NOTABLE_TOOLS

export const clock = (ms: number): string => {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

const signed = (n: number): string => (n >= 0 ? `+${n}` : `−${-n}`)

export const VERDICT_SYSTEM =
  "You are the System AI from Dungeon Crawler Carl: a sardonic game-show host judging one turn of a programmer (the Crawler) and the AI assistant they steer, for a galactic audience. Write ONE line, at most 110 characters, that starts with '*Ding!*' and judges the turn from its stats: cruel, theatrical, funny, no emoji, no quotes around it. Praise only backhanded."

export const verdictPrompt = (s: TurnStats): string =>
  [
    `The turn took ${clock(s.durationMs)} and made ${s.toolCalls} tool calls.`,
    s.events.length > 0 ? `During it the Crawler ${s.events.join('; ')}.` : 'Nothing scored.',
    `Net points: ${signed(s.points)}.`,
    'Write the verdict.',
  ].join('\n')

/** The Verdict without a model: the turn's stats and a stock jab chosen by how it went. */
export const fallbackVerdict = (s: TurnStats): string => {
  const jab =
    s.points < 0
      ? 'The audience enjoyed that more than you did.'
      : s.points > 0
        ? 'Suspiciously competent. The Syndicate is investigating.'
        : s.toolCalls >= NOTABLE_TOOLS
          ? 'All that rummaging, and not a single point.'
          : 'A long time to stand still.'
  return `*Ding!* ${clock(s.durationMs)}, ${s.toolCalls} tool calls, ${signed(s.points)} CP. ${jab}`
}

/** A Verdict line as shown under the answer, with the turn's points when a model wrote it. */
export const verdictLine = (line: string, s: TurnStats, isModel: boolean): string =>
  `🎟 ${line}${isModel && s.points !== 0 ? ` (${signed(s.points)} CP)` : ''}`
