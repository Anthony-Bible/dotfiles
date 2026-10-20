import { describe, expect, test } from 'claude-code/testing'

import { awardOfBuddyCue, cueOfAward, legendaryAward, REROLL_COST, rerollAward } from './cue'
import { apply, type Award } from './points'

const rng = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}
const RUNS = 2000

describe('the Cue an Award makes', () => {
  const awards: Award[] = [
    { points: 10, event: 'green', isGreen: true },
    { points: -15, event: 'red', isGreen: false, debuff: 'Red Build' },
    { points: 150, event: 'pr', achievement: 'Floor Cleared' },
    { points: -200, event: 'force', debuff: 'Shame' },
    { points: 1, event: 'nothing' },
  ]

  test('a streak of three or more broken by red is mourned; a repeated Debuff is not news; plain awards are silent', () => {
    const r = rng(11)
    for (let i = 0; i < RUNS; i++) {
      let s = { session: 0, streak: 0 } as ReturnType<typeof apply>
      for (let j = 0; j < 30; j++) {
        const a = awards[Math.floor(r() * awards.length)]!
        const after = apply(s, a)
        const c = cueOfAward(a, s, after)
        if (a.isGreen === false && s.streak >= 3) expect(c).toEqual({ kind: 'streak-broken', count: s.streak })
        else if (a.debuff && a.debuff === s.debuff && !a.achievement) expect(c).toBeUndefined()
        if (a.event === 'nothing') expect(c).toBeUndefined()
        if (c?.kind === 'streak') expect([5, 10, 25]).toContain(after.streak)
        s = after
      }
    }
  })
})

describe("the Buddy's Cues", () => {
  test('a Reroll costs its price and a Debuff; a legendary Hatch is an Achievement', () => {
    expect(awardOfBuddyCue({ n: 1, cue: { kind: 'reroll' } })).toEqual(rerollAward)
    expect(rerollAward.points).toBe(-REROLL_COST)
    expect(rerollAward.debuff).toBeDefined()
    expect(awardOfBuddyCue({ n: 2, cue: { kind: 'legendary', species: 'goose' } })).toEqual(legendaryAward('goose'))
    expect(legendaryAward('goose').achievement).toBeDefined()
  })

  test('anything else dungeon-buddy might write earns nothing', () => {
    for (const v of [undefined, null, 0, 'reroll', {}, { n: 0 }, { cue: {} }, { cue: { kind: 'pet' } }, { cue: { kind: 'legendary' } }, { cue: { kind: 'legendary', species: 7 } }]) {
      expect(awardOfBuddyCue(v)).toBeUndefined()
    }
  })
})
