import { describe, expect, test } from 'claude-code/testing'

import {
  BOSS_NAMES,
  checkKey,
  failingCount,
  initialBosses,
  newestBoss,
  onBossCheck,
  slayAward,
  SUMMON_AT,
  type Bosses,
} from './boss'

const rng = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T
const RUNS = 300

describe('a Check command as a foe', () => {
  test('the same Check is the same foe, whatever its output is piped through or redirected to', () => {
    const r = rng(1)
    const CHECKS = ['go test ./mods/...', 'npm run test', 'cd claude-plugin && claude plugin test .', "pytest -k 'not slow'"]
    const TAILS = ['', ' 2>&1', ' | tail -20', ' 2>&1 | tail -n 40', ' > out.log', ' 2>/dev/null | grep FAIL', ' | head']
    for (let i = 0; i < RUNS; i++) {
      const c = pick(r, CHECKS)
      expect(checkKey(c + pick(r, TAILS))).toBe(checkKey(c))
    }
    expect(checkKey('go test ./a')).not.toBe(checkKey('go test ./b'))
    expect(checkKey("pytest -k 'a'")).not.toBe(checkKey("pytest -k 'b'"))
    expect(checkKey('cd a && go test ./...')).not.toBe(checkKey('cd b && go test ./...'))
  })

  test('a line that runs no Check is no foe', () => {
    for (const line of ['git status', 'echo "go test ./..."', 'ls | grep test']) expect(checkKey(line)).toBeUndefined()
  })
})

describe('Boss HP from a red Check', () => {
  test('counts the failing tests each runner reports', () => {
    const go = ['=== RUN   TestA', '--- FAIL: TestA (0.00s)', '    --- FAIL: TestA/sub (0.00s)', '--- FAIL: TestB (0.00s)', 'FAIL', 'FAIL\tx/mods\t0.1s'].join('\n')
    expect(failingCount(go)).toBe(2)
    expect(failingCount('========= 3 failed, 12 passed in 0.52s =========')).toBe(3)
    expect(failingCount('Test Suites: 1 failed, 1 total\nTests:       2 failed, 5 passed, 7 total')).toBe(2)
    expect(failingCount(' Test Files  1 failed (1)\n      Tests  4 failed | 10 passed (14)')).toBe(4)
    expect(failingCount('test result: FAILED. 1 passed; 2 failed; 0 ignored\ntest result: FAILED. 0 passed; 3 failed; 0 ignored')).toBe(5)
    expect(failingCount(' 38 pass\n 2 fail\nRan 40 tests across 6 files.')).toBe(2)
  })

  test('an output that names no count tells nothing', () => {
    for (const out of ['', 'error: cannot find module', 'make: *** [all] Error 1']) expect(failingCount(out)).toBeUndefined()
  })
})

describe('the Floor Boss', () => {
  type Step = { key: string; isGreen: boolean; failing?: number }
  const KEYS = ['go test ./a', 'go test ./b', 'npm test']
  const randomStep = (r: () => number): Step => ({
    key: pick(r, KEYS),
    isGreen: r() < 0.3,
    failing: r() < 0.3 ? undefined : 1 + Math.floor(r() * 9),
  })

  test('appears on the third red in a row of one command, lives until its next green, and keeps the last HP', () => {
    const r = rng(2)
    for (let i = 0; i < RUNS; i++) {
      let s: Bosses = initialBosses
      const reds: Record<string, number> = {}
      const hp: Record<string, number> = {}
      for (let j = 0; j < 30; j++) {
        const step = randomStep(r)
        const hadBoss = s.foes[step.key]?.boss !== undefined
        const out = onBossCheck(s, step.key, step.isGreen, step.failing)
        s = out.bosses
        if (step.isGreen) {
          reds[step.key] = 0
          expect(s.foes[step.key]).toBeUndefined()
          expect(out.event?.kind === 'slain').toBe(hadBoss)
          continue
        }
        reds[step.key] = (reds[step.key] ?? 0) + 1
        hp[step.key] = step.failing ?? (hadBoss ? (hp[step.key] as number) : 1)
        const boss = s.foes[step.key]?.boss
        expect(boss !== undefined).toBe((reds[step.key] as number) >= SUMMON_AT)
        expect(out.event?.kind === 'spawned').toBe(reds[step.key] === SUMMON_AT)
        if (boss) {
          expect(boss.hp).toBe(hp[step.key])
          expect(boss.maxHp).toBeGreaterThanOrEqual(boss.hp)
        }
      }
    }
  })

  test('a red run with fewer failing tests damages it, with more heals it', () => {
    let s = initialBosses
    for (const n of [5, 5, 5]) s = onBossCheck(s, 'k', false, n).bosses
    const hit = onBossCheck(s, 'k', false, 2)
    expect(hit.event).toEqual({ kind: 'damaged', boss: hit.bosses.foes.k?.boss, by: 3 })
    const heal = onBossCheck(hit.bosses, 'k', false, 4)
    expect(heal.event).toEqual({ kind: 'healed', boss: heal.bosses.foes.k?.boss, by: 2 })
    expect(heal.bosses.foes.k?.boss?.maxHp).toBe(5)
  })

  test('living bosses never share a name, and a command summons the same name while it is free', () => {
    const r = rng(3)
    for (let i = 0; i < 50; i++) {
      let s = initialBosses
      const keys = Array.from({ length: 1 + Math.floor(r() * 8) }, (_, k) => `go test ./p${Math.floor(r() * 1000)}-${k}`)
      for (const k of keys) for (let j = 0; j < SUMMON_AT; j++) s = onBossCheck(s, k, false).bosses
      const names = Object.values(s.foes).map(f => f.boss?.name)
      expect(new Set(names).size).toBe(names.length)
      for (const name of names) expect(BOSS_NAMES).toContain(name)
    }
    const alone = (k: string) => {
      let s = initialBosses
      for (let j = 0; j < SUMMON_AT; j++) s = onBossCheck(s, k, false).bosses
      return s.foes[k]?.boss?.name
    }
    expect(alone('go test ./x')).toBe(alone('go test ./x'))
  })

  test('the band shows the newest boss and counts the rest', () => {
    let s = initialBosses
    expect(newestBoss(s)).toBeUndefined()
    for (const k of ['a', 'b', 'c']) for (let j = 0; j < SUMMON_AT; j++) s = onBossCheck(s, k, false).bosses
    expect(newestBoss(s)).toEqual({ key: 'c', boss: s.foes.c?.boss, others: 2 })
    s = onBossCheck(s, 'c', true).bosses
    expect(newestBoss(s)?.key).toBe('b')
  })

  test('slaying one pays 100 CP and an Achievement named after it', () => {
    const name = BOSS_NAMES[0] as string
    expect(slayAward({ name, hp: 1, maxHp: 3, order: 1 })).toEqual({
      points: 100,
      event: `slew the Floor Boss ${name}`,
      achievement: `Slew ${name}`,
    })
  })
})
