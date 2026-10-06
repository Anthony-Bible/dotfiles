// The TDD Band's pure half: the TDD Phase that subagent spawns and Checks lead to, and what the band says.
// No `$` here.

export type TddPhase = 'RED' | 'GREEN' | 'REFACTOR'

/** `auto`: hidden until the first Check or TDD subagent; `shown`/`hidden`: what it is now, `/tdd` flips it. */
export type BandVisibility = 'auto' | 'shown' | 'hidden'

export type Tdd = {
  phase?: TddPhase
  /** The last Check since the phase was set: true green, false red, absent none yet. */
  lastCheck?: boolean
  /** True once a TDD subagent set the phase; until then Checks alone set it. */
  isAgentLed: boolean
  visibility: BandVisibility
}

export const initialTdd: Tdd = { isAgentLed: false, visibility: 'auto' }

/** The TDD subagents, by their name without the plugin prefix, and the phase each starts. */
export const AGENT_PHASE: Record<string, TddPhase> = {
  'red-phase-tester': 'RED',
  'green-phase-implementer': 'GREEN',
  'tdd-refactor-specialist': 'REFACTOR',
}

/** The band's buttons: hotkey, label, and the prompt draft it puts in the box. */
export const DRAFTS = [
  { hotkey: '1', label: 'Red', agent: 'red-phase-tester' },
  { hotkey: '2', label: 'Green', agent: 'green-phase-implementer' },
  { hotkey: '3', label: 'Refactor', agent: 'tdd-refactor-specialist' },
].map(d => ({ ...d, draft: `Use the ${d.agent} agent to ` }))

const appear = (v: BandVisibility): BandVisibility => (v === 'auto' ? 'shown' : v)

/** The phase a subagent type starts, `dotfiles-dev-tools:red-phase-tester` and `red-phase-tester` alike. */
export const agentPhase = (subagentType: string): TddPhase | undefined =>
  AGENT_PHASE[subagentType.slice(subagentType.lastIndexOf(':') + 1)]

/** A subagent started: a TDD one sets the phase and waits for its Check; any other changes nothing. */
export const onAgent = (t: Tdd, subagentType: string): Tdd => {
  const phase = agentPhase(subagentType)
  return phase ? { phase, isAgentLed: true, visibility: appear(t.visibility) } : t
}

/** A Check finished: it confirms or contradicts an agent-led phase, and alone sets RED or GREEN. */
export const onCheck = (t: Tdd, isGreen: boolean): Tdd => ({
  ...t,
  phase: t.isAgentLed ? t.phase : isGreen ? 'GREEN' : 'RED',
  lastCheck: isGreen,
  visibility: appear(t.visibility),
})

export const toggle = (t: Tdd): Tdd => ({ ...t, visibility: t.visibility === 'shown' ? 'hidden' : 'shown' })

export const isShown = (t: Tdd): boolean => t.visibility === 'shown'

export type Mood = 'good' | 'bad' | 'waiting'

/**
 * What the band says beside the phase. RED wants a red Check (the new test fails first), GREEN and REFACTOR a
 * green one; a phase the Checks set alone always agrees with them.
 */
export const verdictOf = (t: Tdd): { mood: Mood; note: string } => {
  if (t.lastCheck === undefined) return { mood: 'waiting', note: 'awaiting a Check' }
  if (!t.isAgentLed) return t.lastCheck ? { mood: 'good', note: 'Check ✔' } : { mood: 'bad', note: 'Check ✖' }
  switch (t.phase) {
    case 'RED':
      return t.lastCheck
        ? { mood: 'bad', note: '⚠ tests pass already: they test nothing new' }
        : { mood: 'good', note: '✔ failing, as a fresh test should' }
    case 'GREEN':
      return t.lastCheck ? { mood: 'good', note: '✔ green' } : { mood: 'bad', note: '✖ still red' }
    default:
      return t.lastCheck ? { mood: 'good', note: '✔ still green' } : { mood: 'bad', note: '✖ broke it' }
  }
}
