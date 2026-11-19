import { describe, expect, mock, test } from 'claude-code/testing'

import { REVIEW_HATCH, gateResult, reviewVerdict, reviewGate } from './review-gate'

const rng = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T
const RUNS = 300

const PREFIXES = ['', 'cd x && ', 'git status && ', 'sudo ', 'FOO=1 ', 'cd /tmp; ']
const FLAGS = ['', '--fill', '--title "t" --body "b"', '--draft', '-R owner/repo']

describe('which lines the PR Gate looks at', () => {
  test('a gh pr create is checked, with its -B or --base in any spelling, and nothing else is', () => {
    const r = rng(1)
    for (let i = 0; i < RUNS; i++) {
      const prefix = pick(r, ['', 'cd x && ', 'git status && '])
      const flags = pick(r, FLAGS)
      const spelling = pick(r, ['-B develop', '-Bdevelop', '-B=develop', '--base develop', '--base=develop', '-B "develop"'])
      const c = reviewGate(`${prefix}gh pr create ${flags} ${spelling}`)
      expect(c.kind).toBe('check')
      if (c.kind === 'check') expect(c.base).toBe('develop')
      const none = reviewGate(`${prefix}gh pr create ${flags}`)
      expect(none.kind).toBe('check')
      if (none.kind === 'check') expect(none.base).toBeUndefined()
    }
  })

  test('the directory a cd moved to rides along, and a computed one is null', () => {
    expect(reviewGate('gh pr create -B main')).toEqual({ kind: 'check', base: 'main', dir: undefined })
    expect(reviewGate('cd x && gh pr create')).toEqual({ kind: 'check', base: undefined, dir: 'x' })
    expect(reviewGate('cd "$DIR" && gh pr create')).toEqual({ kind: 'check', base: undefined, dir: null })
  })

  test('a line that only mentions the command, or any other gh or git command, passes', () => {
    for (const line of [
      'echo "gh pr create"',
      "grep -r 'gh pr create' .",
      'gh pr view 3',
      'gh pr list',
      'gh issue create',
      'git push origin feat/x',
      'git commit -m "gh pr create"',
      "cat > notes.md <<'EOF'\ngh pr create\nEOF",
    ])
      expect(reviewGate(line)).toEqual({ kind: 'pass' })
  })

  test('git commit is never gated, whatever else the line holds', () => {
    const r = rng(2)
    for (let i = 0; i < RUNS; i++)
      expect(reviewGate(`${pick(r, PREFIXES)}git commit ${pick(r, ['-m wip', '-am "fix"', '--amend --no-edit'])}`)).toEqual({ kind: 'pass' })
  })

  test('the Escape Hatch passes a PR creation, and only as an assignment', () => {
    const r = rng(3)
    for (let i = 0; i < RUNS; i++)
      expect(reviewGate(`${REVIEW_HATCH} gh pr create ${pick(r, FLAGS)}`)).toEqual({ kind: 'pass' })
    expect(reviewGate(`gh pr create --title ${REVIEW_HATCH}`).kind).toBe('check')
  })
})

describe('what the gate verdict does', () => {
  const said = (o: object) => ({ exitCode: 0, stdout: JSON.stringify(o) })

  test('required: true is refused, naming the line count, a whole-branch Review on the PR base, and the Hatch', () => {
    const r = rng(4)
    for (let i = 0; i < RUNS; i++) {
      const n = 20 + Math.floor(r() * 500)
      const j = reviewVerdict(said({ required: true, code_lines: n, chain_end: 'abc', base: 'origin/main' }), 'develop')
      expect(j.kind).toBe('deny')
      if (j.kind === 'deny') {
        expect(j.reason).toContain(`This PR's Diff has ${n} changed code lines`)
        expect(j.reason).toContain('review diff --auto --base develop --intent')
        expect(j.reason).toContain(REVIEW_HATCH)
      }
    }
  })

  test('without a base on the line, the message names the gate\'s own, or a placeholder', () => {
    const named = reviewVerdict(said({ required: true, code_lines: 30, base: 'origin/main' }))
    expect(named.kind === 'deny' && named.reason).toContain('--base origin/main')
    const bare = reviewVerdict(said({ required: true, code_lines: 30 }))
    expect(bare.kind === 'deny' && bare.reason).toContain('--base <PR base branch>')
  })

  test('required: false passes', () => {
    expect(reviewVerdict(said({ required: false, code_lines: 3, reason: 'ok' }))).toEqual({ kind: 'pass' })
  })

  test('anything unreadable fails open: a bad exit, non-JSON, an empty or malformed answer', () => {
    const ok = JSON.stringify({ required: true, code_lines: 30 })
    for (const run of [
      { exitCode: 1, stdout: ok },
      { exitCode: 127, stdout: '' },
      { exitCode: 0, stdout: '' },
      { exitCode: 0, stdout: 'Traceback (most recent call last)' },
      { exitCode: 0, stdout: '[]' },
      { exitCode: 0, stdout: 'null' },
      { exitCode: 0, stdout: '{"required": "yes"}' },
    ])
      expect(reviewVerdict(run)).toEqual({ kind: 'pass' })
    expect(gateResult(ok)).toEqual({ required: true, codeLines: 30, base: undefined })
  })
})

// The hook itself, with the gate script's process mocked.
const GATE = (o: object) => ({ value: { exitCode: 0, stdout: JSON.stringify(o), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

describe('the PR Gate hook', () => {
  const setup = ($: unknown, on: Parameters<typeof mock.clock>[0], answer: () => ReturnType<typeof GATE> | Promise<never>) => {
    mock.clock(on)
    const asked: { argv: readonly string[]; cwd?: string; timeoutMs?: number }[] = []
    const ran: string[] = []
    // The gate script answers as the test says; any other process (the Branch Guard's git) sees a feature branch.
    on('process.run', async (_$, e) => {
      if (!e.argv.includes('gate'))
        return { value: { exitCode: 0, stdout: 'feat/x\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      asked.push({ argv: e.argv, cwd: e.init?.cwd, timeoutMs: e.init?.timeoutMs })
      return answer() as never
    })
    on('store.get', async () => ({ value: undefined as never }))
    on('store.set', async () => ({ value: undefined }))
    on('tool.call', { tool: 'Bash' }, async (_$, e) => {
      ran.push(e.command)
      return { result: { stdout: '', stderr: '', interrupted: false } }
    })
    return { asked, ran }
  }

  test('a required Review refuses gh pr create before it runs, asking the gate with the line\'s base and directory', async ($, on) => {
    const { asked, ran } = setup($, on, () => GATE({ required: true, code_lines: 42, base: 'develop' }))
    const denied = await $.tool.call({ tool: 'Bash', command: 'cd sub && gh pr create -B develop --fill' })
    expect(denied.deny).toContain("This PR's Diff has 42 changed code lines")
    expect(ran).toEqual([])
    expect(asked).toHaveLength(1)
    expect(asked[0]?.argv.slice(0, 1)).toEqual(['python3'])
    expect(asked[0]?.argv.slice(-3)).toEqual(['gate', '--base', 'develop'])
    expect(asked[0]?.argv.some(a => a.endsWith('skills/second-opinion/scripts/second-opinion.py'))).toBe(true)
    expect(asked[0]?.cwd).toBe('sub')
    expect(asked[0]?.timeoutMs).toBe(15000)
  })

  test('a Covered branch, the Hatch, a git commit and an echo all run, and only the first two lines ask the gate', async ($, on) => {
    const { asked, ran } = setup($, on, () => GATE({ required: false, code_lines: 0 }))
    const lines = ['gh pr create --fill', `${REVIEW_HATCH} gh pr create --fill`, 'git commit -m x', 'echo "gh pr create"']
    for (const command of lines) expect((await $.tool.call({ tool: 'Bash', command })).deny).toBeUndefined()
    expect(ran).toEqual(lines)
    expect(asked).toHaveLength(1)
  })

  test('the Hatch never asks the gate, even when it would refuse', async ($, on) => {
    const { asked, ran } = setup($, on, () => GATE({ required: true, code_lines: 99 }))
    await $.tool.call({ tool: 'Bash', command: `${REVIEW_HATCH} gh pr create` })
    expect(asked).toEqual([])
    expect(ran).toEqual([`${REVIEW_HATCH} gh pr create`])
  })

  test('a failing, timing-out or garbled gate lets the line run', async ($, on) => {
    let answer: () => unknown = () => Promise.reject(new Error('timed out'))
    const { ran } = setup($, on, () => answer() as never)
    await $.tool.call({ tool: 'Bash', command: 'gh pr create' })
    answer = () => ({ value: { exitCode: 0, stdout: 'not json', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    await $.tool.call({ tool: 'Bash', command: 'gh pr create' })
    answer = () => ({ value: { exitCode: 3, stdout: '', stderr: 'boom', isStdoutTruncated: false, isStderrTruncated: false } })
    await $.tool.call({ tool: 'Bash', command: 'gh pr create' })
    expect(ran).toEqual(['gh pr create', 'gh pr create', 'gh pr create'])
  })

  test('a directory the shell computes is not asked about', async ($, on) => {
    const { asked, ran } = setup($, on, () => GATE({ required: true, code_lines: 99 }))
    await $.tool.call({ tool: 'Bash', command: 'cd "$DIR" && gh pr create' })
    expect(asked).toEqual([])
    expect(ran).toHaveLength(1)
  })
})
