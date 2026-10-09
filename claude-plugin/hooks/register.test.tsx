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

const ran = (stdout: string, exitCode = 0) => ({
  value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})

// What the mod tells the Crawler: notifications (always delivered) and toasts.
const told = (on: On) => {
  const seen = { notes: [] as string[], toasts: [] as string[] }
  on('ui.notify', async (_$, e) => {
    seen.notes.push(e.text)
    return { value: { isSent: true } } as never
  })
  on('ui.toast', async (_$, e) => {
    seen.toasts.push(e.text)
    return { value: undefined } as never
  })
  return seen
}

const START = { cwd: '/repo', surface: 'terminal', isInteractive: true } as const

describe('Sponsor Mail', () => {
  test("watches the PR gh pr create opened: Mail notifies, Claude's reply is not Mail but answers it", async ($, on) => {
    const clock = mock.clock(on)
    const seen = watch(on)
    const tell = told(on)
    const pr = {
      state: 'OPEN',
      comments: [{ databaseId: 1, author: { login: 'me' }, createdAt: '2026-10-09T10:00:00Z' }],
    }
    on('process.run', async (_$, e) => {
      const args = e.argv.join(' ')
      if (args.includes('--show-toplevel')) return ran('/repo\n')
      if (args.includes('--show-current')) return ran('feat/x\n')
      if (args.startsWith('gh api graphql')) {
        const pullRequest = {
          number: 45, url: 'https://github.com/o/r/pull/45', state: pr.state, headRefName: 'feat/x',
          comments: { nodes: pr.comments }, reviews: { nodes: [] }, reviewThreads: { nodes: [] },
          commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [
            { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' },
          ] } } } }] },
        }
        return ran(JSON.stringify({ data: { viewer: { login: 'me' }, repository: { pullRequest } } }))
      }
      return ran('', 1)
    })
    on('tool.call', { tool: 'Bash' }, async (_$, e) => {
      if (e.command.startsWith('gh pr comment')) {
        pr.comments.push({ databaseId: 3, author: { login: 'me' }, createdAt: '2026-10-09T10:05:00Z' })
      }
      const stdout = e.command.startsWith('gh pr create') ? 'https://github.com/o/r/pull/45\n' : ''
      return { result: { stdout, stderr: '', interrupted: false } }
    })
    on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
      const { Box } = $.ui.resolve(e)
      return <Box key="engine" />
    })
    const band = async () => {
      const ui = await $.ui.mount({ plugin: 'dotfiles-dev-tools', surface: 'terminal', ...BAND })
      const texts = [/PR #45/, /✅ 1\/1/, /unanswered/].map(async t => (await ui.find({ type: 'Text', text: t })) !== undefined)
      const shown = await Promise.all(texts)
      await ui.unmount()
      return shown
    }

    on('session.start', async (_$, e) => ({ cwd: e.cwd })) // the engine's start: nothing to do
    on('command.register', async () => ({ value: {} as never }))
    on('session.usage', async () => ({ value: { context: { percent: 1 }, rateLimits: [] } as never }))
    await $.session.start(START)
    await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' })
    await clock.settle()
    expect(await band()).toEqual([true, true, false]) // the comment already there is no Mail

    pr.comments.push({ databaseId: 2, author: { login: 'copilot' }, createdAt: '2026-10-09T10:01:00Z' })
    await clock.advance(120_000)
    expect(tell.notes).toEqual(['1 new on PR #45 from copilot'])
    expect(await band()).toEqual([true, true, true])

    const cp = () => Number(seen.statuses.at(-1)?.match(/^🎟 (-?\d+) CP/)?.[1])
    const before = cp()
    await $.tool.call({ tool: 'Bash', command: 'gh pr comment 45 --body "fixed"' })
    expect(tell.notes).toHaveLength(1) // Claude's own reply is never Mail
    expect(await band()).toEqual([true, true, false])
    expect(cp() - before).toBe(5) // the Mail it answered

    pr.state = 'MERGED'
    await clock.advance(600_000)
    expect(seen.store.get('crawler-points.unlocked')).toContain('Sponsored Content')
    expect(await band()).toEqual([false, false, false])
  })
})

describe('the Beast Guard', () => {
  test('refuses a Dispatch while Beast is Down unless it carries the Escape Hatch, and tells of it once', async ($, on) => {
    mock.clock(on)
    const seen = watch(on)
    const tell = told(on)
    let smi = { exitCode: 15, stdout: '', stderr: 'Unable to determine the device handle for GPU0: GPU is lost.' }
    on('process.run', async (_$, e) => {
      const args = e.argv.join(' ')
      if (args.includes('pi-implementer')) return ran('LLAMA_URL=http://10.0.0.9:8080\n')
      if (e.argv[0] === 'ssh') return { value: { ...smi, isStdoutTruncated: false, isStderrTruncated: false } }
      if (args.endsWith('/health')) return ran('{"status":"ok"}\n200')
      if (args.endsWith('/slots')) return ran('[]')
      if (args.endsWith('/v1/completions')) return ran('200')
      return ran('', 1)
    })
    const dispatched: string[] = []
    on('tool.call', { tool: 'Bash' }, async (_$, e) => {
      dispatched.push(e.command)
      return { result: { stdout: '', stderr: '', interrupted: false } }
    })
    const line = 'python3 pi-dispatch.py dispatch t.md'

    const denied = await $.tool.call({ tool: 'Bash', command: line })
    expect(denied.deny).toContain('GPU lost')
    expect(tell.notes).toEqual(['Beast is Down: GPU lost'])
    expect(seen.statuses.at(-1)).toMatch(/beast 🔴 GPU lost$/)

    await $.tool.call({ tool: 'Bash', command: `BEAST_OK=1 ${line}` })
    expect(dispatched).toEqual([`BEAST_OK=1 ${line}`])
    expect(tell.notes).toHaveLength(1)

    smi = { exitCode: 0, stdout: '21034, 24576\n', stderr: '' }
    await $.tool.call({ tool: 'Bash', command: line })
    expect(dispatched.at(-1)).toBe(line)
    expect(tell.toasts).toContain('Beast is back Up')
    expect(seen.statuses.at(-1)).toMatch(/beast 🟢 21\/24GB$/)
  })

  test('holds a Dispatch while its model is Loading and lets it go once loaded, never probing it before', async ($, on) => {
    mock.clock(on)
    watch(on)
    let sleeps = 0
    const probed: string[] = []
    on('process.run', async (_$, e) => {
      const args = e.argv.join(' ')
      if (args.includes('pi-implementer')) return ran('LLAMA_URL=http://10.0.0.9:8080\nMODEL_ALIAS=blend\n')
      if (e.argv[0] === 'sleep') {
        sleeps++
        return ran('')
      }
      if (e.argv[0] === 'ssh') return ran('21034, 24576\n')
      if (args.endsWith('/health')) return ran('{"status":"ok"}\n200')
      if (args.endsWith('/v1/models')) {
        const value = sleeps >= 2 ? 'loaded' : 'loading'
        return ran(JSON.stringify({ data: [{ id: 'blend', status: { value } }] }))
      }
      if (args.includes('/slots')) return ran('[]')
      if (args.endsWith('/v1/completions')) {
        probed.push(sleeps >= 2 ? 'loaded' : 'loading')
        return ran('200')
      }
      return ran('', 1)
    })
    bash(on, () => false)
    const r = await $.tool.call({ tool: 'Bash', command: 'pi-dispatch.py dispatch t.md' })
    expect(r.deny).toBeUndefined()
    expect(sleeps).toBe(2)
    expect(probed).toEqual(['loaded'])
  })
})
