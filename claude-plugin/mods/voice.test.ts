import { describe, expect, test } from 'claude-code/testing'

import {
  COLLAPSING_FROM,
  fallbackVerdict,
  isNotable,
  moodOf,
  NOTABLE_MS,
  NOTABLE_TOOLS,
  SPINNER_WORDS,
  spinnerWord,
  type Mood,
} from './voice'

const rng = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}
const RUNS = 300

describe('Spinner Words', () => {
  test('every roll picks a word of the mood, never one ending in an ellipsis', () => {
    const r = rng(1)
    for (const mood of Object.keys(SPINNER_WORDS) as Mood[]) {
      for (let i = 0; i < RUNS; i++) {
        const w = spinnerWord(mood, r())
        expect(SPINNER_WORDS[mood]).toContain(w)
        expect(/[.…]$/.test(w)).toBe(false)
      }
      expect(SPINNER_WORDS[mood]).toContain(spinnerWord(mood, 0.999999))
    }
  })

  test('a collapsing context outranks a debuff, which outranks a running Dispatch', () => {
    const r = rng(2)
    for (let i = 0; i < RUNS; i++) {
      const m = {
        contextPercent: r() < 0.2 ? undefined : r() * 100,
        debuff: r() < 0.5 ? 'Hubris' : undefined,
        isDispatching: r() < 0.5,
      }
      const expected =
        (m.contextPercent ?? 0) >= COLLAPSING_FROM
          ? 'collapsing'
          : m.debuff
            ? 'debuffed'
            : m.isDispatching
              ? 'dispatching'
              : 'normal'
      expect(moodOf(m)).toBe(expected)
    }
  })
})

describe('Verdicts', () => {
  test('a turn is notable exactly when it scored, ran past a minute, or made enough tool calls', () => {
    const r = rng(3)
    for (let i = 0; i < RUNS; i++) {
      const s = {
        durationMs: Math.floor(r() * 2 * NOTABLE_MS),
        toolCalls: Math.floor(r() * 2 * NOTABLE_TOOLS),
        points: 0,
        events: r() < 0.3 ? ['made a git commit'] : [],
      }
      expect(isNotable(s)).toBe(s.events.length > 0 || s.durationMs > NOTABLE_MS || s.toolCalls >= NOTABLE_TOOLS)
    }
  })

  test('the fallback names the stats and starts with the ding', () => {
    const v = fallbackVerdict({ durationMs: 125_000, toolCalls: 14, points: -15, events: ['ran a failing test'] })
    expect(v.startsWith('*Ding!* 2m05s, 14 tool calls, −15 CP.')).toBe(true)
  })
})
