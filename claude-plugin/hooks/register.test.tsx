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

describe('Crawler Points scores tool calls', () => {
  test('a green check, a red check, a commit and a force push move the score, streak and debuff', async ($, on) => {
    mock.clock(on)
    const seen = watch(on)
    let isRed = false
    bash(on, () => isRed)

    await $.tool.call({ tool: 'Bash', command: 'go test ./...' })
    expect(seen.statuses.at(-1)).toBe('🎟 10 CP · Lv 1 · 🔥1')

    isRed = true
    await $.tool.call({ tool: 'Bash', command: 'go test ./...' })
    expect(seen.statuses.at(-1)).toBe('🎟 -5 CP · Lv 1 · Debuff: Red Build')

    isRed = false
    await $.tool.call({ tool: 'Bash', command: 'git commit -m "x"' })
    await $.tool.call({ tool: 'Bash', command: 'git push --force origin main' })
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
