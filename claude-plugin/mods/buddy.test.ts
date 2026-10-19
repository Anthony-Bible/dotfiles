import { describe, expect, test } from 'claude-code/testing'

import {
  accountOf,
  BUBBLE_GAP_MS,
  BUBBLE_MAX,
  cannedBubble,
  card,
  cleanBubble,
  fallbackSoul,
  momentOfAward,
  parseSoul,
  RARITIES,
  RARITY_FLOOR,
  rerollRefusal,
  REROLL_COST,
  roll,
  seedOf,
  SPECIES,
  spriteOf,
  STATS,
  willSpeak,
  type Moment,
} from './buddy'
import { apply, type Award } from './points'

const rng = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}
const RUNS = 2000
const seeds = (n: number) => Array.from({ length: n }, (_, i) => `crawler${i}@dungeon.example`)

describe('the Hatch', () => {
  test('a seed always rolls the same Hatch', () => {
    for (const s of seeds(300)) expect(roll(s)).toEqual(roll(s))
  })

  test('every stat lies between its tier floor and 100, and commons wear no hat', () => {
    for (const s of seeds(RUNS)) {
      const h = roll(s)
      for (const stat of STATS) {
        expect(h.stats[stat]).toBeGreaterThanOrEqual(RARITY_FLOOR[h.rarity])
        expect(h.stats[stat]).toBeLessThanOrEqual(100)
      }
      if (h.rarity === 'common') expect(h.hat).toBeUndefined()
      else expect(h.hat).toBeDefined()
    }
  })

  test('across many accounts every species shows up and the tiers come out rarest last', () => {
    const hatches = seeds(20_000).map(roll)
    expect(new Set(hatches.map(h => h.species)).size).toBe(SPECIES.length)
    const counts = RARITIES.map(r => hatches.filter(h => h.rarity === r).length)
    for (let i = 1; i < counts.length; i++) expect(counts[i]!).toBeLessThan(counts[i - 1]!)
    expect(counts[4]!).toBeGreaterThan(0)
    const shiny = hatches.filter(h => h.isShiny).length
    expect(shiny).toBeGreaterThan(50)
    expect(shiny).toBeLessThan(400)
  })

  test('a Reroll rolls from a new seed; none keeps the account itself as the seed', () => {
    expect(seedOf('a@b.c', 0)).toBe('a@b.c')
    const seen = new Set<string>()
    for (let n = 0; n < 50; n++) seen.add(seedOf('a@b.c', n))
    expect(seen.size).toBe(50)
  })

  test('the account comes out of the emailAddress line, lower-cased; nothing when absent', () => {
    expect(accountOf('  "emailAddress": "Crawler@Dungeon.Example",')).toBe('crawler@dungeon.example')
    expect(accountOf('{"oauthAccount": {}}')).toBeUndefined()
    expect(accountOf('')).toBeUndefined()
  })
})

describe('drawing', () => {
  test('every sprite is four lines, five with a hat, and the card names the stats', () => {
    for (const s of seeds(500)) {
      const h = roll(s)
      expect(spriteOf(h).length).toBe(h.hat ? 5 : 4)
      const c = card(h, fallbackSoul(h, s))
      for (const stat of STATS) expect(c).toContain(stat)
    }
  })
})

describe('the Soul', () => {
  test('two lines make a Soul for its seed; anything less is no Soul', () => {
    expect(parseSoul('Sir Honk\nA goose of great menace.', 's')).toEqual({
      seed: 's',
      name: 'Sir Honk',
      personality: 'A goose of great menace.',
    })
    expect(parseSoul('Sir Honk', 's')).toBeUndefined()
    expect(parseSoul('', 's')).toBeUndefined()
  })

  test('the stock Soul is fixed by the seed', () => {
    for (const s of seeds(200)) expect(fallbackSoul(roll(s), s)).toEqual(fallbackSoul(roll(s), s))
  })
})

describe('Bubbles', () => {
  test('a cleaned Bubble is one line of at most BUBBLE_MAX', () => {
    const r = rng(7)
    for (let i = 0; i < RUNS; i++) {
      const text = Array.from({ length: Math.floor(r() * 4) }, () => 'x'.repeat(Math.floor(r() * 120))).join('\n')
      const b = cleanBubble(text)
      if (b === undefined) continue
      expect(b.includes('\n')).toBe(false)
      expect(b.length).toBeLessThanOrEqual(BUBBLE_MAX)
    }
  })

  test('every canned Bubble fits the bubble', () => {
    const kinds: Moment[] = [
      { kind: 'hatched' },
      { kind: 'pet' },
      { kind: 'reroll' },
      { kind: 'boss-summoned', name: 'x' },
      { kind: 'boss-slain', name: 'x' },
      { kind: 'achievement', name: 'x' },
      { kind: 'debuff', name: 'x' },
      { kind: 'streak', count: 5 },
      { kind: 'streak-broken', count: 5 },
      { kind: 'collapse' },
      { kind: 'mail', author: 'x' },
      { kind: 'red-pr', names: ['x'] },
      { kind: 'verdict', text: 'x' },
    ]
    for (const m of kinds) for (let r = 0; r < 1; r += 0.05) expect(cannedBubble(m, r).length).toBeLessThanOrEqual(BUBBLE_MAX)
  })

  test('a forced moment always speaks; any other never inside the gap, and more often the more chaotic', () => {
    const r = rng(3)
    for (const s of seeds(300)) {
      const h = roll(s)
      const now = 1_000_000
      expect(willSpeak(h, { kind: 'pet' }, now, now, r())).toBe(true)
      expect(willSpeak(h, { kind: 'collapse' }, now, now - BUBBLE_GAP_MS + 1, 0)).toBe(false)
      expect(willSpeak(h, { kind: 'collapse' }, now, now - BUBBLE_GAP_MS, 0)).toBe(true)
      expect(willSpeak(h, { kind: 'collapse' }, now, 0, 0.999)).toBe(false)
    }
    const calm = { ...roll('a'), stats: { ...roll('a').stats, CHAOS: 1 } }
    const wild = { ...calm, stats: { ...calm.stats, CHAOS: 100 } }
    const speaks = (h: typeof calm) => Array.from({ length: 1000 }, (_, i) => willSpeak(h, { kind: 'collapse' }, 1e9, 0, i / 1000)).filter(Boolean).length
    expect(speaks(wild)).toBeGreaterThan(speaks(calm))
  })
})

describe('what an Award gives the Buddy to say', () => {
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
        const m = momentOfAward(a, s, after)
        if (a.isGreen === false && s.streak >= 3) expect(m).toEqual({ kind: 'streak-broken', count: s.streak })
        else if (a.debuff && a.debuff === s.debuff && !a.achievement) expect(m).toBeUndefined()
        if (a.event === 'nothing') expect(m).toBeUndefined()
        if (m?.kind === 'streak') expect([5, 10, 25]).toContain(after.streak)
        s = after
      }
    }
  })
})

describe('the Reroll', () => {
  test('refused exactly when the all-time total is under its price', () => {
    for (let t = -1000; t < 2000; t += 37) expect(rerollRefusal(t) === undefined).toBe(t >= REROLL_COST)
  })
})
