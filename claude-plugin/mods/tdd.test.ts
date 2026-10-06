import { describe, expect, test } from 'claude-code/testing'

import { agentPhase, initialTdd, isShown, onAgent, onCheck, toggle, verdictOf, type Tdd } from './tdd'

const rng = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T
const RUNS = 300

const AGENTS = [
  'red-phase-tester',
  'dotfiles-dev-tools:green-phase-implementer',
  'dotfiles-dev-tools:tdd-refactor-specialist',
  'Explore',
  'general-purpose',
  'dotfiles-dev-tools:tdd-review-agent',
]

type Step = { kind: 'agent'; type: string } | { kind: 'check'; isGreen: boolean } | { kind: 'toggle' }
const randomStep = (r: () => number): Step =>
  r() < 0.4 ? { kind: 'agent', type: pick(r, AGENTS) } : r() < 0.9 ? { kind: 'check', isGreen: r() < 0.5 } : { kind: 'toggle' }
const run = (t: Tdd, s: Step): Tdd =>
  s.kind === 'agent' ? onAgent(t, s.type) : s.kind === 'check' ? onCheck(t, s.isGreen) : toggle(t)

describe('the TDD Phase', () => {
  test('once a TDD subagent set it, only another TDD subagent changes it', () => {
    const r = rng(1)
    for (let i = 0; i < RUNS; i++) {
      let t = initialTdd
      let expected: string | undefined
      let isLed = false
      for (let j = 0; j < 25; j++) {
        const s = randomStep(r)
        t = run(t, s)
        if (s.kind === 'agent' && agentPhase(s.type)) {
          expected = agentPhase(s.type)
          isLed = true
        } else if (s.kind === 'check' && !isLed) {
          expected = s.isGreen ? 'GREEN' : 'RED'
        }
        expect(t.phase).toBe(expected)
      }
    }
  })

  test('the band appears on the first Check or TDD subagent, and a hide by /tdd holds', () => {
    const r = rng(2)
    for (let i = 0; i < RUNS; i++) {
      let t = initialTdd
      let toggles = 0
      let hasAppeared = false
      for (let j = 0; j < 25; j++) {
        const s = randomStep(r)
        t = run(t, s)
        if (s.kind === 'toggle') toggles++
        if (!hasAppeared && (s.kind === 'check' || (s.kind === 'agent' && agentPhase(s.type)))) hasAppeared = true
        // Before anything appeared it, each toggle flips from hidden; after, an odd count of toggles hides it.
        if (toggles === 0) expect(isShown(t)).toBe(hasAppeared)
      }
    }
  })

  test('a fresh agent-led phase waits for its Check, which then judges it by TDD rules', () => {
    const red = onAgent(initialTdd, 'red-phase-tester')
    expect(verdictOf(red).mood).toBe('waiting')
    expect(verdictOf(onCheck(red, false)).mood).toBe('good')
    expect(verdictOf(onCheck(red, true)).mood).toBe('bad')
    const refactor = onAgent(onCheck(red, false), 'tdd-refactor-specialist')
    expect(refactor.lastCheck).toBeUndefined()
    expect(verdictOf(onCheck(refactor, false)).note).toContain('broke it')
    expect(verdictOf(onCheck(refactor, true)).mood).toBe('good')
  })
})
