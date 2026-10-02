import { describe, expect, test } from 'claude-code/testing'

import { apply, bashAward, classify, cleanQuip, level, statusLine, type Award, type Score } from './points'

// A small seeded generator, so a failing case reproduces.
const rng = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T
const RUNS = 300

const CHECKS = [
  'go test ./...',
  'go build ./cmd/x',
  'pytest -q',
  'npm run test',
  'cargo test',
  'make lint',
  'tsc -p .',
]
const NOISE = ['ls -la', 'cat README.md', 'echo hi', 'rg foo', 'git status', 'git log --oneline']
const PUSHES = ['git push -f', 'git push --force origin main', 'git push --force-with-lease']

describe('classify', () => {
  test('a force push wins over anything chained around it', () => {
    const r = rng(1)
    for (let i = 0; i < RUNS; i++) {
      const parts = [pick(r, [...CHECKS, ...NOISE, 'git commit -m x', 'gh pr create']), pick(r, PUSHES)]
      if (r() < 0.5) parts.reverse()
      expect(classify(parts.join(' && '))).toBe('force-push')
    }
  })

  test('plain commands do not score', () => {
    for (const c of NOISE) expect(classify(c)).toBe('other')
  })

  test('test and build commands are checks', () => {
    for (const c of CHECKS) expect(classify(c)).toBe('check')
  })
})

describe('apply', () => {
  const randomAward = (r: () => number, score: Score): Award =>
    r() < 0.7
      ? (bashAward(pick(r, CHECKS), r() < 0.3, score, false) as Award)
      : { points: Math.round(r() * 400 - 200), event: 'something' }

  test('the session total is the sum of the awards, and the streak counts the trailing greens', () => {
    const r = rng(2)
    for (let i = 0; i < RUNS; i++) {
      let score: Score = { session: 0, streak: 0 }
      let sum = 0
      let greens = 0
      for (let j = 0; j < 20; j++) {
        const a = randomAward(r, score)
        score = apply(score, a)
        sum += a.points
        greens = a.isGreen === true ? greens + 1 : a.isGreen === false ? 0 : greens
        expect(score.session).toBe(sum)
        expect(score.streak).toBe(greens)
        expect(score.streak).toBeGreaterThanOrEqual(0)
      }
    }
  })

  test('a green clears the debuff, a red sets one', () => {
    const red = apply(
      { session: 0, streak: 3 },
      bashAward('go test ./...', true, { session: 0, streak: 3 }, false)!,
    )
    expect(red.debuff).toBeDefined()
    const green = apply(red, bashAward('go test ./...', false, red, false)!)
    expect(green.debuff).toBeUndefined()
  })
})

describe('bashAward', () => {
  test('only the first check of a session, green, unlocks Compiled On The First Try', () => {
    const s = { session: 0, streak: 0 }
    expect(bashAward('go test ./...', false, s, true)?.achievement).toBe('Compiled On The First Try')
    expect(bashAward('go test ./...', true, s, true)?.achievement).toBeUndefined()
    expect(bashAward('go test ./...', false, s, false)?.achievement).toBeUndefined()
  })

  test('failed commits and PRs do not score; a failed force push still costs', () => {
    const s = { session: 0, streak: 0 }
    expect(bashAward('git commit -m x', true, s, false)).toBeUndefined()
    expect(bashAward('gh pr create --fill', true, s, false)).toBeUndefined()
    expect(bashAward('git push -f', true, s, false)?.points).toBe(-200)
  })
})

describe('level and status line', () => {
  test('level never drops as points grow and steps at each square of ten', () => {
    let prev = level(0)
    for (let p = 0; p <= 50_000; p += 37) {
      expect(level(p)).toBeGreaterThanOrEqual(prev)
      prev = level(p)
    }
    for (let n = 0; n < 20; n++) expect(level(n * n * 100)).toBe(n + 1)
  })

  test('the status line names the session score and shows the debuff only when set', () => {
    expect(statusLine({ session: 1250, streak: 0 }, 0)).toContain('1,250 CP')
    expect(statusLine({ session: 5, streak: 2, debuff: 'Hubris' }, 0)).toContain('Debuff: Hubris')
    expect(statusLine({ session: 5, streak: 0 }, 0)).not.toContain('Debuff')
  })
})

describe('cleanQuip', () => {
  test('answers one line of at most 140 characters, or nothing for an empty reply', () => {
    const r = rng(3)
    for (let i = 0; i < RUNS; i++) {
      const lines = Array.from({ length: 1 + Math.floor(r() * 4) }, () =>
        'x'.repeat(Math.floor(r() * 300)),
      ).join('\n')
      const q = cleanQuip(lines)
      if (q !== undefined) {
        expect(q.includes('\n')).toBe(false)
        expect(q.length).toBeLessThanOrEqual(140)
      }
    }
    expect(cleanQuip('  \n \n')).toBeUndefined()
  })
})
