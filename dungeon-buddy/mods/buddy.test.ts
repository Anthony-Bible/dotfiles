import { describe, expect, test } from 'claude-code/testing'

import {
  accountOf,
  BUBBLE_GAP_MS,
  BUBBLE_MAX,
  cannedBubble,
  card,
  cleanBubble,
  cueOf,
  fallbackSoul,
  faceOf,
  fidgetOdds,
  fidgetOf,
  FIDGET_POSES,
  LONG_HAUL_CALLS,
  LONG_HAUL_MS,
  longHaulOf,
  mishapOf,
  NAMES,
  parseSoul,
  RARITIES,
  RARITY_FLOOR,
  rerollRefusal,
  REROLL_COST,
  rerollPrice,
  roll,
  seedOf,
  SPECIES,
  spriteOf,
  STATS,
  willSpeak,
  type Cue,
  type Moment,
} from './buddy'

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

  test('strips common labels and numbering, but keeps the seed and limits', () => {
    expect(parseSoul('Name: Sir Honk\nPersonality: A goose of great menace.', 's')).toEqual({
      seed: 's',
      name: 'Sir Honk',
      personality: 'A goose of great menace.',
    })
    expect(parseSoul('1. Sir Honk\n2. A goose of great menace.', 's')).toEqual({
      seed: 's',
      name: 'Sir Honk',
      personality: 'A goose of great menace.',
    })
  })

  test('all species fallback names are reachable across seeds', () => {
    const seen = new Set<string>()
    for (const s of seeds(10_000)) seen.add(fallbackSoul(roll(s), s).name)
    for (const names of Object.values(NAMES)) {
      for (const n of names) expect(seen.has(n)).toBe(true)
    }
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
      { kind: 'mishap', command: 'x' },
      { kind: 'long-haul', toolCalls: 20, minutes: 5 },
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

describe('Cues from dotfiles-dev-tools', () => {
  const cues: Cue[] = [
    { kind: 'boss-summoned', name: 'Flaky Fred' },
    { kind: 'boss-slain', name: 'Flaky Fred' },
    { kind: 'achievement', name: 'Floor Cleared' },
    { kind: 'debuff', name: 'Shame' },
    { kind: 'streak', count: 5 },
    { kind: 'streak-broken', count: 3 },
    { kind: 'collapse' },
    { kind: 'mail', author: 'octocat' },
    { kind: 'red-pr', names: ['lint', 'test'] },
    { kind: 'verdict', text: 'Mediocre.' },
  ]

  test('every Cue the show writes comes through whole', () => {
    for (const cue of cues) expect(cueOf({ n: 1, cue })).toEqual(cue)
  })

  test('anything else, or a Cue missing what it names, is no Cue', () => {
    const junk = [undefined, null, 1, 'boss', {}, { n: 0 }, { cue: null }, { cue: { kind: 'pet' } }, { cue: { kind: 'hatched' } }]
    for (const v of junk) expect(cueOf(v)).toBeUndefined()
    for (const cue of cues) {
      for (const field of Object.keys(cue).filter(k => k !== 'kind')) {
        expect(cueOf({ cue: { ...cue, [field]: undefined } })).toBeUndefined()
      }
    }
  })
})

describe('Mishaps and Long Hauls', () => {
  test('a turn is a Long Haul exactly at 20 tool calls or five minutes', () => {
    const r = rng(5)
    for (let i = 0; i < RUNS; i++) {
      const calls = Math.floor(r() * 40)
      const ms = Math.floor(r() * 2 * LONG_HAUL_MS)
      const m = longHaulOf(calls, ms)
      expect(m !== undefined).toBe(calls >= LONG_HAUL_CALLS || ms >= LONG_HAUL_MS)
      if (m?.kind === 'long-haul') expect(m.toolCalls).toBe(calls)
    }
  })

  test('a Mishap quotes the first line of the command, cut short', () => {
    const r = rng(9)
    for (let i = 0; i < RUNS; i++) {
      const command = Array.from({ length: 1 + Math.floor(r() * 3) }, () => 'x'.repeat(Math.floor(r() * 120))).join('\n')
      const m = mishapOf(command)
      if (m.kind !== 'mishap') throw new Error('not a Mishap')
      expect(m.command.includes('\n')).toBe(false)
      expect(m.command.length).toBeLessThanOrEqual(60)
    }
    expect(mishapOf('  go test ./...\necho done')).toEqual({ kind: 'mishap', command: 'go test ./...' })
  })
})

describe('the Reroll', () => {
  test('refused exactly when the all-time total is under its price', () => {
    for (let t = -1000; t < 2000; t += 37) expect(rerollRefusal(t) === undefined).toBe(t >= REROLL_COST)
  })

  test('costs CP and a Debuff while Points runs, and nothing without it', () => {
    expect(rerollPrice(true)).toContain(`${REROLL_COST} CP`)
    expect(rerollPrice(false)).toBe('free')
  })
})

describe('the fidget', () => {
  // One Hatch of each species, so every face is drawn.
  const hatches = SPECIES.map(species => ({ ...roll('fidget@dungeon.example'), species }))

  test('every pose is a different face exactly as wide as the face at rest, so the band never jumps', () => {
    for (const h of hatches) {
      const rest = [...faceOf(h)]
      for (let p = 0; p < FIDGET_POSES; p++) {
        const face = [...faceOf(h, p)]
        expect(face.join('')).not.toBe(rest.join(''))
        expect(face.length).toBe(rest.length)
      }
    }
  })

  test('a tick fidgets at the Hatch odds, which grow with CHAOS, into a pose that exists', () => {
    const r = rng(7)
    for (const s of seeds(200)) {
      const h = roll(s)
      expect(fidgetOdds(h)).toBeGreaterThanOrEqual(0.15)
      expect(fidgetOdds(h)).toBeLessThanOrEqual(0.5)
      const calmer = { ...h, stats: { ...h.stats, CHAOS: Math.max(0, h.stats.CHAOS - 10) } }
      expect(fidgetOdds(calmer)).toBeLessThanOrEqual(fidgetOdds(h))
      for (let i = 0; i < 20; i++) {
        const roll1 = r()
        const pose = fidgetOf(h, roll1, r())
        expect(pose === undefined).toBe(roll1 >= fidgetOdds(h))
        if (pose !== undefined) expect(pose >= 0 && pose < FIDGET_POSES).toBe(true)
      }
    }
  })
})
