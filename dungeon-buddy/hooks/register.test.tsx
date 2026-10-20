import { describe, expect, mock, test, type Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { BUBBLE_GAP_MS, faceOf, FIDGET_MS, FIDGET_TICK_MS, LONG_HAUL_MS, roll, seedOf } from '../mods/buddy'

const ACCOUNT = 'crawler@dungeon.example'
const START = { cwd: '/repo', surface: 'terminal', isInteractive: true } as const
const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: {} as never, view: {} as never },
} as const

// What the mod keeps, seen from beneath it.
const watch = (on: On) => {
  const store = new Map<string, unknown>()
  on('store.get', async (_$, e) => ({ value: store.get(e.key) as never }))
  on('store.set', async (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  return store
}

// The login's email line, and the model naming the Buddy or speaking for it.
const world = (on: On, hasLogin = true) => {
  on('process.run', async (_$, e) => ({
    value: {
      exitCode: 0,
      stdout: hasLogin && e.argv.join(' ').includes('emailAddress') ? `"emailAddress": "${ACCOUNT}"` : '',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('model.complete', async (_$, e) => ({
    value: {
      isAnswered: true,
      text: e.system?.includes('You name') ? 'Sir Test\nA very testy pet.' : 'Boo, System!',
      usage: { input_tokens: 1, output_tokens: 1 },
    } as never,
  }))
  on('command.register', async () => ({ value: {} as never }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('classic.SessionStart', async () => ({})) // no settings hook beneath
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="beneath">the System's rows</Text>
  })
}

// dotfiles-dev-tools installed beside it, its all-time Crawler Points `allTime()`, as the Buddy reads them.
const withShow = (on: On, allTime: () => number) => {
  on('state.get', { plugin: 'dotfiles-dev-tools', key: 'cue' } as never, async () => ({ value: { value: { n: 1 }, version: 1 } }) as never)
  on('state.get', { plugin: 'dotfiles-dev-tools', key: 'allTime' } as never, async () => ({ value: { value: allTime(), version: 1 } }) as never)
}

// Bash that fails or passes as the test says, without running anything.
const bash = (on: On, isRed: () => boolean) =>
  on('tool.call', { tool: 'Bash' }, async () =>
    isRed()
      ? { isError: true as const, result: { stdout: '', stderr: 'FAIL', interrupted: false } }
      : { result: { stdout: '', stderr: '', interrupted: false } },
  )

// /buddy as the Crawler types it at the prompt.
const buddy = (args = '') =>
  ({ command: 'buddy', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } }) as const

const shows = async ($: Engine, text: RegExp) => {
  const ui = await $.ui.mount({ plugin: 'dungeon-buddy', surface: 'terminal', ...BAND })
  const found = (await ui.find({ type: 'Text', text })) !== undefined
  await ui.unmount()
  return found
}

/** Hatches the Buddy and waits out its greeting. */
const hatched = async ($: Engine, clock: ReturnType<typeof mock.clock>) => {
  await $.session.start(START)
  await $.command.run(buddy())
  await clock.advance(16_000)
}

/** Raises `make` once a gap apart, up to 20 times (a Buddy speaks at 40% odds or better), until a Bubble shows. */
const bubbles = async ($: Engine, clock: ReturnType<typeof mock.clock>, make: () => Promise<unknown>) => {
  for (let i = 0; i < 20; i++) {
    await clock.advance(BUBBLE_GAP_MS)
    await make()
    await clock.advance(10)
    if (await shows($, /Boo, System!/)) return true
  }
  return false
}

describe('the Buddy', () => {
  test('/buddy hatches the Hatch the account rolls; it greets, then rests as its face and name', async ($, on) => {
    const clock = mock.clock(on)
    const store = watch(on)
    world(on)
    await $.session.start(START)
    expect(await shows($, /Sir Test/)).toBe(false) // nothing before the first /buddy

    const hatch = roll(seedOf(ACCOUNT, 0))
    const r = await $.command.run(buddy())
    expect(r.text).toContain(`Sir Test the ${hatch.isShiny ? 'shiny ' : ''}${hatch.species}`)
    expect((store.get('buddy.saved') as { soul: { name: string } }).soul.name).toBe('Sir Test')

    await clock.advance(3000)
    expect(await shows($, /Boo, System!/)).toBe(true) // the greeting Bubble
    await clock.advance(13_000)
    expect(await shows($, /Boo, System!/)).toBe(false)
    expect(await shows($, /Sir Test/)).toBe(true)

    await $.command.run(buddy('hide'))
    expect(await shows($, /Sir Test/)).toBe(false)
  })

  test("it sits under what the plugins beneath draw in the band, never hiding it", async ($, on) => {
    const clock = mock.clock(on)
    watch(on)
    world(on)
    await hatched($, clock)
    expect(await shows($, /the System's rows/)).toBe(true)
    expect(await shows($, /Sir Test/)).toBe(true)
  })

  test('at rest the Buddy now and then fidgets its face, then settles back, its name never leaving', async ($, on) => {
    const clock = mock.clock(on)
    watch(on)
    world(on)
    await hatched($, clock)
    const hatch = roll(seedOf(ACCOUNT, 0))
    const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const rest = new RegExp(`^${escape(faceOf(hatch))} Sir Test`)
    let fidgets = 0
    // At 15% odds or better a tick, 60 ticks all still is a 1-in-17,000 fluke.
    for (let i = 0; i < 60 && fidgets === 0; i++) {
      await clock.advance(FIDGET_TICK_MS)
      expect(await shows($, /Sir Test/)).toBe(true)
      if (!(await shows($, rest))) fidgets++
    }
    expect(fidgets).toBeGreaterThan(0)
    await clock.advance(FIDGET_MS)
    expect(await shows($, rest)).toBe(true)
  })

  test('without a login the Buddy is seeded once, made up, and the same Buddy comes back next session', async ($, on) => {
    const clock = mock.clock(on)
    const store = watch(on)
    world(on, false)
    await $.session.start(START)
    await $.command.run(buddy())
    await clock.advance(3000)
    const saved = store.get('buddy.saved') as { account: string; soul: { seed: string } }
    expect(saved.account).toMatch(/^anon-/)
    expect(saved.soul.seed).toBe(saved.account)

    await $.session.start(START)
    await clock.advance(13_000)
    expect(await shows($, /Sir Test/)).toBe(true)
  })

  // A /clear starts a fresh session with fresh state and no session.start: only the classic SessionStart.
  const kept = { rerolls: 0, account: ACCOUNT, soul: { seed: seedOf(ACCOUNT, 0), name: 'Old Faithful', personality: 'Loyal.' } }

  test('after a /clear the kept Buddy is back above the prompt', async ($, on) => {
    mock.clock(on)
    const store = watch(on)
    world(on)
    store.set('buddy.saved', kept)
    await $.classic.SessionStart({ source: 'clear' })
    expect(await shows($, /Old Faithful/)).toBe(true)
  })

  test('/buddy with a kept Buddy the state lost shows that Buddy again, never hatching a new one', async ($, on) => {
    mock.clock(on)
    const store = watch(on)
    world(on)
    store.set('buddy.saved', kept)
    const r = await $.command.run(buddy())
    expect(r.text).toContain('Old Faithful')
    expect((store.get('buddy.saved') as { soul: { name: string } }).soul.name).toBe('Old Faithful')
    expect(await shows($, /Old Faithful/)).toBe(true)
  })
})

describe('the Reroll', () => {
  test('on its own it is free: no Points to refuse it, and it rolls a new seed', async ($, on) => {
    const clock = mock.clock(on)
    const store = watch(on)
    world(on)
    await hatched($, clock)
    expect((await $.command.run(buddy('reroll'))).text).toContain('(free)')
    await $.command.run(buddy('reroll confirm'))
    const saved = store.get('buddy.saved') as { rerolls: number; soul: { seed: string } }
    expect(saved.rerolls).toBe(1)
    expect(saved.soul.seed).toBe(seedOf(ACCOUNT, 1))
  })

  test('with dotfiles-dev-tools it is refused under 500 all-time CP and goes through, priced, at 500 or more', async ($, on) => {
    const clock = mock.clock(on)
    const store = watch(on)
    world(on)
    let allTime = 499
    withShow(on, () => allTime)
    await hatched($, clock)

    expect((await $.command.run(buddy('reroll confirm'))).text).toContain('Your Buddy stays')
    expect((store.get('buddy.saved') as { rerolls: number }).rerolls).toBe(0)

    allTime = 500
    expect((await $.command.run(buddy('reroll'))).text).toContain('500 CP and a Debuff')
    await $.command.run(buddy('reroll confirm'))
    expect((store.get('buddy.saved') as { rerolls: number }).rerolls).toBe(1)
  })
})

describe('Mishaps and Long Hauls', () => {
  // The main loop's turns, answered beneath without a model.
  const loop = (on: On) => {
    on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
    on('turn.complete', async (_$, e) => ({ text: e.answer }))
  }
  const turn = async ($: Engine, clock: ReturnType<typeof mock.clock>, calls: number, ms: number) => {
    await $.turn.start({ text: 'go', turnId: 't' })
    for (let i = 0; i < calls; i++) await $.tool.call({ tool: 'Bash', command: 'true' })
    await $.turn.complete({ answer: 'done', durationMs: ms, isAborted: false, turnId: 't', reason: 'answer' })
  }

  test('on its own the Buddy talks about a failed Bash command', async ($, on) => {
    const clock = mock.clock(on)
    watch(on)
    world(on)
    bash(on, () => true)
    await hatched($, clock)
    expect(await bubbles($, clock, () => $.tool.call({ tool: 'Bash', command: 'go test ./...' }))).toBe(true)
  })

  test('on its own the Buddy talks about a Long Haul, but never a short turn', async ($, on) => {
    const clock = mock.clock(on)
    watch(on)
    world(on)
    bash(on, () => false)
    loop(on)
    await hatched($, clock)
    expect(await bubbles($, clock, () => turn($, clock, 3, 1000))).toBe(false)
    expect(await bubbles($, clock, () => turn($, clock, 0, LONG_HAUL_MS))).toBe(true)
  })

  test('with dotfiles-dev-tools it keeps quiet about both: the Cues tell of the same events', async ($, on) => {
    const clock = mock.clock(on)
    watch(on)
    world(on)
    withShow(on, () => 0)
    bash(on, () => true)
    loop(on)
    await hatched($, clock)
    expect(await bubbles($, clock, () => $.tool.call({ tool: 'Bash', command: 'go test ./...' }))).toBe(false)
    expect(await bubbles($, clock, () => turn($, clock, 25, LONG_HAUL_MS))).toBe(false)
  })
})
