import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// What the mod shows and keeps, seen from beneath it: the status line it sets and the store it writes.
const watch = (on: On) => {
  const seen = { statuses: [] as (string | undefined)[], store: new Map<string, unknown>() }
  on('ui.status', async (_$, e) => {
    seen.statuses.push(e.text)
    return { value: undefined }
  })
  on('store.get', async (_$, e) => ({ value: seen.store.get(e.key) as never }))
  on('store.set', async (_$, e) => {
    seen.store.set(e.key, e.value)
    return { value: undefined }
  })
  return seen
}

// Bash that ends the way the test says, without running anything.
const bash = (on: On, isRed: () => boolean) =>
  on('tool.call', { tool: 'Bash' }, async () =>
    isRed()
      ? { isError: true as const, result: { stdout: '', stderr: 'FAIL', interrupted: false } }
      : { result: { stdout: '', stderr: '', interrupted: false } },
  )

// git as the Branch Guard asks it, with the checkout on `branch()` and origin's default branch main; an unborn
// checkout has no HEAD commit to verify.
const git = (on: On, branch: () => string, isBorn: () => boolean = () => true) =>
  on('process.run', async (_$, e) => {
    const args = e.argv.join(' ')
    const stdout = args.includes('--show-current') ? `${branch()}\n` : args.includes('symbolic-ref') ? 'origin/main\n' : ''
    const exitCode = args.includes('rev-parse') && !isBorn() ? 1 : 0
    return { value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

describe('Crawler Points scores tool calls', () => {
  test('a green check, a red check, a commit and a force push move the score, streak and debuff', async ($, on) => {
    mock.clock(on)
    const seen = watch(on)
    let isRed = false
    git(on, () => 'feat/x')
    bash(on, () => isRed)

    await $.tool.call({ tool: 'Bash', command: 'go test ./...' })
    expect(seen.statuses.at(-1)).toBe('🎟 10 CP · Lv 1 · 🔥1')

    isRed = true
    await $.tool.call({ tool: 'Bash', command: 'go test ./...' })
    expect(seen.statuses.at(-1)).toBe('🎟 -5 CP · Lv 1 · Debuff: Red Build')

    isRed = false
    await $.tool.call({ tool: 'Bash', command: 'git commit -m "x"' })
    await $.tool.call({ tool: 'Bash', command: 'git push --force origin feat/x' })
    expect(seen.statuses.at(-1)).toBe('🎟 -180 CP · Lv 1 · Debuff: Shame')
    expect(seen.store.get('crawler-points.allTime')).toBe(-180)
    expect(seen.store.get('crawler-points.unlocked')).toEqual(['Compiled On The First Try'])
  })

  test('a failing command that is not a check or a milestone does not score', async ($, on) => {
    mock.clock(on)
    const seen = watch(on)
    bash(on, () => true)
    await $.tool.call({ tool: 'Bash', command: 'rg needle' })
    expect(seen.statuses).toEqual([])
  })
})

describe('the Podman Guard', () => {
  test('docker runs as podman, with a note for the model; a Daemon-Only Command never runs', async ($, on) => {
    mock.clock(on)
    watch(on)
    const ran: string[] = []
    on('tool.call', { tool: 'Bash' }, async (_$, e) => {
      ran.push(e.command)
      return { result: { stdout: '', stderr: '', interrupted: false } }
    })

    const rewritten = await $.tool.call({ tool: 'Bash', command: 'docker compose up -d && echo "docker ok"' })
    expect(ran).toEqual(['podman compose up -d && echo "docker ok"'])
    expect(rewritten.context?.some(c => c.includes('Podman Guard'))).toBe(true)

    const denied = await $.tool.call({ tool: 'Bash', command: 'docker context use remote' })
    expect(denied.deny).toContain('DOCKER_OK=1')

    await $.tool.call({ tool: 'Bash', command: 'DOCKER_OK=1 docker context use remote' })
    expect(ran.at(-1)).toBe('DOCKER_OK=1 docker context use remote')
  })
})

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: {} as never, view: {} as never },
} as const

describe('the TDD Band', () => {
  test('hidden until a Check, then shows its phase; a button drafts the prompt for its subagent', async ($, on) => {
    mock.clock(on)
    watch(on)
    bash(on, () => true)
    const filled: string[] = []
    on('prompt.fill', async (_$, e) => {
      filled.push(e.text)
      return { isFilled: true } as never
    })

    on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
      const { Box } = $.ui.resolve(e)
      return <Box key="engine" />
    }) // the engine's band: empty
    const before = await $.ui.mount({ plugin: 'dotfiles-dev-tools', surface: 'terminal', ...BAND })
    expect(await before.find({ text: /RED|GREEN/ })).toBeUndefined()
    await before.unmount()

    await $.tool.call({ tool: 'Bash', command: 'go test ./...' })
    const ui = await $.ui.mount({ plugin: 'dotfiles-dev-tools', surface: 'terminal', ...BAND })
    expect(await ui.find({ type: 'Text', text: /RED/ })).toBeDefined()
    await ui.press({ key: '2' })
    expect(filled).toEqual(['Use the green-phase-implementer agent to '])
  })
})

describe('the Branch Guard', () => {
  test('a commit on main never runs unless it carries the Escape Hatch; on a feature branch it runs', async ($, on) => {
    mock.clock(on)
    watch(on)
    let branch = 'main'
    git(on, () => branch)
    const ran: string[] = []
    on('tool.call', { tool: 'Bash' }, async (_$, e) => {
      ran.push(e.command)
      return { result: { stdout: '', stderr: '', interrupted: false } }
    })

    const denied = await $.tool.call({ tool: 'Bash', command: 'git add -A && git commit -m wip' })
    expect(denied.deny).toContain('BRANCH_OK=1')
    expect(ran).toEqual([])

    await $.tool.call({ tool: 'Bash', command: 'BRANCH_OK=1 git commit -m wip' })
    branch = 'feat/x'
    await $.tool.call({ tool: 'Bash', command: 'git commit -m wip' })
    expect(ran).toEqual(['BRANCH_OK=1 git commit -m wip', 'git commit -m wip'])
  })

  test("an unborn main takes its first commit, but a push of it in the same line never runs", async ($, on) => {
    mock.clock(on)
    watch(on)
    git(on, () => 'main', () => false)
    const ran: string[] = []
    on('tool.call', { tool: 'Bash' }, async (_$, e) => {
      ran.push(e.command)
      return { result: { stdout: '', stderr: '', interrupted: false } }
    })

    const denied = await $.tool.call({ tool: 'Bash', command: 'git commit --allow-empty -m init && git push -u origin HEAD' })
    expect(denied.deny).toContain('main')
    await $.tool.call({ tool: 'Bash', command: 'git commit --allow-empty -m init' })
    expect(ran).toEqual(['git commit --allow-empty -m init'])
  })
})

describe('the Floor Boss', () => {
  test('three reds of one Check summon it above the prompt; a green run slays it for an Achievement', async ($, on) => {
    mock.clock(on)
    const seen = watch(on)
    let failing = 3
    on('tool.call', { tool: 'Bash' }, async () =>
      failing > 0
        ? { isError: true as const, result: { stdout: `Tests:  ${failing} failed, 2 passed`, stderr: '', interrupted: false } }
        : { result: { stdout: '', stderr: '', interrupted: false } },
    )
    on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
      const { Box } = $.ui.resolve(e)
      return <Box key="engine" />
    }) // the engine's band: empty
    const band = async () => {
      const ui = await $.ui.mount({ plugin: 'dotfiles-dev-tools', surface: 'terminal', ...BAND })
      const found = {
        boss: await ui.find({ type: 'Text', text: /FLOOR BOSS/ }),
        hp: await ui.find({ type: 'Text', text: /♥/ }),
      }
      await ui.unmount()
      return found
    }

    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    await $.tool.call({ tool: 'Bash', command: 'npm test 2>&1 | tail' })
    expect((await band()).boss).toBeUndefined()
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    const up = await band()
    expect(up.boss).toBeDefined()
    expect(up.hp?.text).toBe('♥♥♥')

    failing = 1
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    expect((await band()).hp?.text).toBe('♥♡♡')

    failing = 0
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    expect((await band()).boss).toBeUndefined()
    expect((seen.store.get('crawler-points.unlocked') as string[]).some(a => a.startsWith('Slew '))).toBe(true)
  })
})
