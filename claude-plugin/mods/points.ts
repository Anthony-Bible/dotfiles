// Crawler Points' pure half: which Bash commands and Dispatch fates score, for how much, and what the HUD
// says. No `$` here.

export type Score = {
  session: number
  streak: number
  debuff?: string
}

export type Award = {
  /** Points added (negative for a penalty). */
  points: number
  /** What happened, for the quip writer and the fallback toast. */
  event: string
  /** Set when the award also unlocks a named achievement. */
  achievement?: string
  /** true: a green test/build (extends the streak); false: a red one (breaks it); absent: neither. */
  isGreen?: boolean
  debuff?: string
}

export type CommandKind = 'commit' | 'pr' | 'force-push' | 'check' | 'other'

const FORCE_PUSH = /\bgit\s+push\b[^|;&]*\s(?:-f\b|--force\b|--force-with-lease\b)/
const COMMIT = /\bgit\s+commit\b/
const PR = /\bgh\s+pr\s+create\b/
const CHECK =
  /\b(?:go\s+(?:test|build|vet)|pytest|cargo\s+(?:test|build|check|clippy)|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|build|typecheck|lint)|tsc|make|nix\s+(?:build|flake\s+check)|golangci-lint|shellcheck)\b/

/** The command with its quoted strings blanked, so a commit message or an echo never reads as a command. */
const unquoted = (command: string): string => command.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, "''")

/** The commands a shell line chains with `;`, `&&`, `||` or newlines; a pipeline stays one. */
export const segments = (command: string): string[] =>
  unquoted(command)
    .split(/&&|\|\||;|\n/)
    .map(c => c.trim())
    .filter(Boolean)

/** What a Bash command is, for scoring. A force push wins over everything else in the same command. */
export const classify = (raw: string): CommandKind => {
  const command = unquoted(raw)
  return FORCE_PUSH.test(command)
    ? 'force-push'
    : PR.test(command)
      ? 'pr'
      : COMMIT.test(command)
        ? 'commit'
        : CHECK.test(command)
          ? 'check'
          : 'other'
}

export const STREAK_MILESTONES = [5, 10, 25] as const

/**
 * The awards for a finished foreground Bash call, one per kind its chained commands hold (none when nothing
 * scores). The exit status is the whole line's: a failed line costs its check (the likeliest culprit) and
 * any force push, and earns no milestone, since which command failed is unknown. `isFirstCheck` is true for
 * the session's first test/build run.
 */
export const bashAwards = (
  command: string,
  isError: boolean,
  score: Score,
  isFirstCheck: boolean,
): Award[] => {
  const kinds = new Set(segments(command).map(classify))
  const order: CommandKind[] = isError ? ['force-push', 'check'] : ['force-push', 'pr', 'commit', 'check']
  return order
    .filter(k => kinds.has(k))
    .map(k => kindAward(k, isError, score, isFirstCheck))
    .filter((a): a is Award => a !== undefined)
}

const kindAward = (
  kind: CommandKind,
  isError: boolean,
  score: Score,
  isFirstCheck: boolean,
): Award | undefined => {
  if (kind === 'force-push') {
    return { points: -200, event: 'force-pushed over shared history', debuff: 'Shame' }
  }
  if (kind === 'pr') {
    return isError ? undefined : { points: 150, event: 'opened a pull request', achievement: 'Floor Cleared' }
  }
  if (kind === 'commit') {
    return isError ? undefined : { points: 25, event: 'made a git commit' }
  }
  if (kind === 'check') {
    if (isError) {
      return { points: -15, event: 'ran a test/build that failed', isGreen: false, debuff: 'Red Build' }
    }
    const streak = score.streak + 1
    const isMilestone = (STREAK_MILESTONES as readonly number[]).includes(streak)
    return {
      points: 10 + (isMilestone ? streak * 5 : 0),
      event: isMilestone ? `hit a ${streak}-green streak` : 'ran a test/build that passed',
      isGreen: true,
      achievement: isFirstCheck
        ? 'Compiled On The First Try'
        : isMilestone
          ? `${streak} Greens In A Row`
          : undefined,
    }
  }
  return undefined
}

/** A tool call that errored or was denied, outside the commands bashAwards scores. */
export const errorAward = (tool: string, isDenied: boolean): Award => ({
  points: -5,
  event: isDenied ? `had a ${tool} call denied` : `had a ${tool} call error out`,
  debuff: 'Hubris',
})

/** A Dispatch fate the Dispatch Board noticed after it started watching: a new Outcome, or a capped end. */
export type Fate = { fate: 'landed' | 'dropped' | 'conflict' | 'timeout' | 'turn cap'; ticket: string }

/** The award for a Dispatch's Outcome or end, from pi-implementer's files. */
export const dispatchAward = (fate: Fate['fate'], ticket: string): Award =>
  ({
    landed: { points: 100, event: `landed the local model's Ticket ${ticket}`, achievement: 'Loot Secured' },
    dropped: { points: -50, event: `dropped the local model's Ticket ${ticket}` },
    conflict: { points: -75, event: `hit a cherry-pick conflict landing ${ticket}`, debuff: 'Merge Hell' },
    timeout: { points: -25, event: `let the local model time out on ${ticket}` },
    'turn cap': { points: -25, event: `let the local model hit its turn cap on ${ticket}` },
  })[fate]

/** The score after an award: points add, a green extends the streak and clears the debuff, a red resets it. */
export const apply = (score: Score, award: Award): Score => ({
  session: score.session + award.points,
  streak: award.isGreen === true ? score.streak + 1 : award.isGreen === false ? 0 : score.streak,
  debuff: award.debuff ?? (award.isGreen === true ? undefined : score.debuff),
})

/** Level from all-time points: 1 below 100, then one more at each square of ten (100, 400, 900, ...). */
export const level = (allTime: number): number => Math.floor(Math.sqrt(Math.max(0, allTime) / 100)) + 1

/** What the HUD shows of the session's usage, as `session.measure` and `$.session.usage()` report it. */
export type Usage = {
  /** How full the context window is, 0 to 100; absent before the first response. */
  contextPercent?: number
  usd?: number
  rateLimits: readonly { kind: string; percentUsed: number }[]
}

/** A rate-limit window is shown from this much used, and only the fullest one. */
export const RATE_LIMIT_SHOWN_FROM = 50

const WINDOW_NAMES: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }

/** The fullest rate-limit window once it reaches RATE_LIMIT_SHOWN_FROM, as the HUD names it. */
export const hottestLimit = (rateLimits: Usage['rateLimits']): string | undefined => {
  const hot = rateLimits
    .filter(l => l.percentUsed >= RATE_LIMIT_SHOWN_FROM)
    .reduce<Usage['rateLimits'][number] | undefined>((a, l) => (!a || l.percentUsed > a.percentUsed ? l : a), undefined)
  return hot && `${WINDOW_NAMES[hot.kind] ?? hot.kind} ${Math.round(hot.percentUsed)}%`
}

export const statusLine = (score: Score, allTime: number, usage?: Usage): string =>
  [
    `🎟 ${score.session.toLocaleString('en-US')} CP`,
    `Lv ${level(allTime)}`,
    score.streak > 0 ? `🔥${score.streak}` : undefined,
    score.debuff ? `Debuff: ${score.debuff}` : undefined,
    usage?.contextPercent !== undefined ? `ctx ${Math.round(usage.contextPercent)}%` : undefined,
    usage ? hottestLimit(usage.rateLimits) : undefined,
    usage?.usd !== undefined ? `$${usage.usd.toFixed(2)}` : undefined,
  ]
    .filter(Boolean)
    .join(' · ')

/** A manual compaction counts as a Strategic Retreat below this much context. */
export const RETREAT_BELOW = 90

/**
 * The award for a compaction of the main conversation: a Dungeon Collapse (automatic) costs, a Strategic Retreat
 * (manual, below RETREAT_BELOW) earns, and anything else, or a manual one whose fill is unknown, scores nothing.
 */
export const compactAward = (trigger: string, contextPercent: number | undefined): Award | undefined =>
  trigger === 'auto'
    ? { points: -50, event: 'let the dungeon collapse: Claude Code compacted the context itself', debuff: 'Amnesia' }
    : trigger === 'manual' && contextPercent !== undefined && contextPercent < RETREAT_BELOW
      ? {
          points: 20,
          event: `compacted at ${Math.round(contextPercent)}% context, before the ceiling came down`,
          achievement: 'Strategic Retreat',
        }
      : undefined

const signed = (n: number): string => (n >= 0 ? `+${n}` : `−${-n}`)

/** The toast shown while no model quip is available (throttled, failed, or still on its way). */
export const fallbackToast = (award: Award): string =>
  award.achievement
    ? `*Ding!* Achievement Unlocked: ${award.achievement} (${signed(award.points)} CP)`
    : `*Ding!* ${signed(award.points)} CP: the Crawler ${award.event}.`

/** The prompt that asks the model for a one-line quip about an award. */
export const quipPrompt = (award: Award, score: Score): string =>
  [
    `Event: the Crawler ${award.event}.`,
    `Points: ${signed(award.points)} (session total ${score.session}, green streak ${score.streak}).`,
    award.achievement ? `Achievement unlocked: "${award.achievement}".` : '',
    award.debuff ? `Debuff applied: ${award.debuff}.` : '',
    'Write the toast.',
  ]
    .filter(Boolean)
    .join('\n')

export const QUIP_SYSTEM =
  "You are the System AI from Dungeon Crawler Carl: a sardonic game-show host narrating a programmer (the Crawler) for a galactic audience. Write ONE line, at most 110 characters, that starts with '*Ding!*' and reacts to the event: cruel, theatrical, funny, no emoji, no quotes around it. Praise only backhanded."

/** A model reply cut down to one toast-sized line, or undefined when nothing usable came back. */
export const cleanQuip = (text: string): string | undefined => {
  const line = text
    .split('\n')
    .map(l => l.trim().replace(/^["'“]|["'”]$/g, ''))
    .find(Boolean)
  if (!line) return undefined
  return line.length > 140 ? `${line.slice(0, 139)}…` : line
}
