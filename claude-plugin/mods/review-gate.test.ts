import { describe, expect, mock, test } from 'claude-code/testing'

import { REVIEW_HATCH, expandHome, gateResult, reviewChecks, reviewVerdict, reviewGate } from './review-gate'

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

  test('the directories a cd moved to ride along, and a computed one is left out', () => {
    expect(reviewGate('gh pr create -B main')).toEqual({ kind: 'check', base: 'main', dirs: [undefined] })
    expect(reviewGate('cd x && gh pr create')).toEqual({ kind: 'check', base: undefined, dirs: ['x'] })
    expect(reviewGate('cd "$DIR" && gh pr create')).toEqual({ kind: 'check', base: undefined, dirs: [] })
  })

  const dirsOf = (line: string, nth = 0) => (reviewChecks(line)[nth] as { dirs?: unknown } | undefined)?.dirs

  test('a cd followed by || may not have happened: both directories are judged, unless the other side leaves', () => {
    expect(dirsOf('cd A || gh pr create')).toEqual([undefined, 'A'])
    expect(dirsOf('cd A || true; gh pr create')).toEqual([undefined, 'A'])
    expect(dirsOf('cd A; gh pr create')).toEqual(['A'])
    expect(dirsOf('cd A && gh pr create')).toEqual(['A'])
    expect(dirsOf('cd A; cd /abs && gh pr create')).toEqual(['/abs'])
    expect(dirsOf('cd A || true; cd /abs && gh pr create')).toEqual(['/abs'])
    for (const out of ['exit', 'exit 1', 'return', 'return 2', '{ echo no; exit 1; }']) {
      expect(dirsOf(`cd A || ${out}; gh pr create`)).toEqual(['A'])
      expect(dirsOf(`cd A || ${out}\ngh pr create`)).toEqual(['A'])
    }
    expect(dirsOf('cd A || echo exit; gh pr create')).toEqual([undefined, 'A'])
    expect(dirsOf('cd "$D" || exit; gh pr create')).toEqual([])
    expect(dirsOf('cd "$D" || true; gh pr create')).toEqual([undefined])
  })

  test('a cd in a subshell, a pipeline stage or a background job moves no later command', () => {
    expect(dirsOf('(cd x; gh pr create); gh pr create -B dev', 0)).toEqual(['x'])
    expect(dirsOf('(cd x; gh pr create); gh pr create -B dev', 1)).toEqual([undefined])
    expect(reviewChecks('(cd x; gh pr create); gh pr create -B dev').map(c => [c.base, c.dirs])).toEqual([
      [undefined, ['x']],
      ['dev', [undefined]],
    ])
    expect(dirsOf('cd x | gh pr create')).toEqual([undefined])
    expect(dirsOf('cd x | cat; gh pr create')).toEqual([undefined])
    expect(dirsOf('cd x & gh pr create')).toEqual([undefined])
    expect(dirsOf('cd x & cd y; gh pr create')).toEqual(['y'])
    expect(dirsOf('echo $(cd x); gh pr create')).toEqual([undefined])
    expect(dirsOf('echo `cd x`; gh pr create')).toEqual([undefined])
    expect(dirsOf('(cd x) && gh pr create')).toEqual([undefined])
    expect(dirsOf('cd x && (gh pr create)')).toEqual(['x'])
  })

  test('every gh pr create on the line is checked with its own base and directories', () => {
    expect(reviewChecks('gh pr create -B feat --fill; gh pr create --fill')).toEqual([
      { kind: 'check', base: 'feat', dirs: [undefined] },
      { kind: 'check', base: undefined, dirs: [undefined] },
    ])
    expect(reviewChecks('cd a && gh pr create -B x && cd ../b && gh pr create -B y').map(c => [c.base, c.dirs])).toEqual([
      ['x', ['a']],
      ['y', ['a/../b']],
    ])
    expect(reviewChecks('echo hi')).toEqual([])
  })

  test('the Hatch exempts only the gh pr create whose own prefix carries it', () => {
    expect(reviewChecks(`${REVIEW_HATCH} gh pr create`)).toEqual([])
    expect(reviewChecks(`env ${REVIEW_HATCH} gh pr create`)).toEqual([])
    expect(reviewChecks(`FOO=1 ${REVIEW_HATCH} gh pr create`)).toEqual([])
    expect(reviewChecks(`${REVIEW_HATCH} gh pr create; gh pr create -B b`).map(c => c.base)).toEqual(['b'])
    expect(reviewChecks(`gh pr create -B a; ${REVIEW_HATCH} gh pr create`).map(c => c.base)).toEqual(['a'])
    expect(reviewChecks(`${REVIEW_HATCH} echo hi; gh pr create`)).toHaveLength(1)
    expect(reviewChecks(`export ${REVIEW_HATCH}; gh pr create`)).toHaveLength(1)
    expect(reviewChecks(`(${REVIEW_HATCH} gh pr create)`)).toEqual([])
  })

  test('a Hatch before an operator exempts nothing after it', () => {
    for (const line of [`${REVIEW_HATCH}; gh pr create`, `${REVIEW_HATCH} && gh pr create`, `${REVIEW_HATCH} || gh pr create`, `${REVIEW_HATCH} | gh pr create`])
      expect(reviewChecks(line)).toHaveLength(1)
  })

  test('a quoted Hatch exempts like a bare one', () => {
    for (const line of ['REVIEW_OK="1" gh pr create', "REVIEW_OK='1' gh pr create", 'env "REVIEW_OK=1" gh pr create', "env 'REVIEW_OK=1' gh pr create", 'FOO=1 REVIEW_OK="1" gh pr create'])
      expect(reviewChecks(line)).toEqual([])
    for (const line of ['REVIEW_OK="0" gh pr create', 'REVIEW_OK="1"; gh pr create'])
      expect(reviewChecks(line)).toHaveLength(1)
  })

  test('only ~ and ~/ expand to the home directory; ~user and plain paths are not guessed', () => {
    expect(expandHome('~', '/h')).toBe('/h')
    expect(expandHome('~/a/b', '/h')).toBe('/h/a/b')
    expect(expandHome('/x/~y', '/h')).toBe('/x/~y')
    expect(expandHome('rel', '/h')).toBe('rel')
    expect(expandHome(undefined, '/h')).toBeUndefined()
    expect(expandHome('~root/a', '/h')).toBeNull()
    expect(expandHome('~+', '/h')).toBeNull()
  })

  test('--head / -H is carried through, the last one winning, in every spelling', () => {
    const head = (line: string) => reviewChecks(line)[0]?.head
    expect(head('gh pr create --head feat/x --base main')).toBe('feat/x')
    expect(head('gh pr create -H feat/x')).toBe('feat/x')
    expect(head('gh pr create -Hfeat/x')).toBe('feat/x')
    expect(head('gh pr create -H=feat/x')).toBe('feat/x')
    expect(head('gh pr create --head=feat/x')).toBe('feat/x')
    expect(head('gh pr create -H a --head "b"')).toBe('b')
    expect(head('gh pr create --title "--head=x"')).toBeUndefined()
    expect(head('gh pr create --fill')).toBeUndefined()
    expect(reviewChecks('gh pr create -H a')[0]).toEqual({ kind: 'check', head: 'a', dirs: [undefined] })
  })

  test('a command before gh pr create that can move HEAD marks the check, and only such a command does', () => {
    for (const mover of ['git commit -m w', 'git commit -am w', 'git -C ../x commit -m w', 'git -c a=b merge main', 'git rebase main', 'git cherry-pick abc',
      'git revert HEAD', 'git am p.patch', 'git pull', 'git reset --hard x', 'git checkout feat', 'git switch feat', 'git stash pop', 'git stash apply',
      'sudo git commit -m w', 'git add x && git commit -m w && git push'])
      expect(reviewChecks(`${mover} && gh pr create --fill`)[0]?.movesHead, mover).toBe(true)
    for (const calm of ['git push', 'git status', 'git add x', 'git stash', 'git stash list', 'git log', 'echo "git commit"', 'git fetch'])
      expect(reviewChecks(`${calm}; gh pr create --fill`)[0]?.movesHead, calm).toBeUndefined()
    expect(reviewChecks('gh pr create --fill; git commit -m w')[0]?.movesHead).toBeUndefined()
    expect(reviewChecks(`git commit -m w && ${REVIEW_HATCH} gh pr create`)).toEqual([])
  })

  test('help among create\'s own args is no creation, but a flag\'s value that looks like help is', () => {
    for (const line of ['gh pr create --help', 'gh pr create -h', 'gh pr create --fill -h', 'gh pr new --help --fill', 'gh -R o/r pr create -h'])
      expect(reviewChecks(line)).toEqual([])
    for (const line of ['gh pr create -t -h', 'gh pr create --title --help', 'gh pr create -b -h -B main', 'gh pr create -- -h'])
      expect(reviewChecks(line)).toHaveLength(1)
  })

  test('--attach and --recover take a value, so a base-looking word after them is not a base', () => {
    const baseOf = (line: string) => (reviewGate(line) as { base?: string }).base
    expect(baseOf('gh pr create --attach --base=evil')).toBeUndefined()
    expect(baseOf('gh pr create --recover -B evil')).toBeUndefined()
    expect(baseOf('gh pr create --recover x -B real')).toBe('real')
  })

  test('gh asked only for help creates nothing', () => {
    for (const line of ['gh -h pr create', 'gh --help pr create']) expect(reviewGate(line)).toEqual({ kind: 'pass' })
  })

  test('only the base flag names a base: the values of other flags never do, and the last one wins', () => {
    const baseOf = (line: string) => (reviewGate(line) as { base?: string }).base
    expect(baseOf('gh pr create --title "-Bump deps"')).toBeUndefined()
    expect(baseOf('gh pr create --title "--base=evil" --fill')).toBeUndefined()
    expect(baseOf('gh pr create -b "-B evil" -B main')).toBe('main')
    expect(baseOf('gh pr create -B first --base=second')).toBe('second')
    expect(baseOf('gh pr create --base=a -B b')).toBe('b')
    expect(baseOf('gh pr create -t x --body-file -B -B real')).toBe('real')
    expect(baseOf('gh pr create -- -B evil')).toBeUndefined()
    expect(baseOf('gh pr create -Bmain')).toBe('main')
    expect(baseOf('gh -R o/r pr create -B dev')).toBe('dev')
  })

  test('gh by path, inherited flags and the new alias are still the gated command', () => {
    for (const line of [
      '/opt/homebrew/bin/gh pr create',
      'gh pr new --fill',
      'gh -R o/r pr create',
      'gh --repo=o/r pr create',
      'gh pr -R o/r create',
      '/usr/bin/env gh pr create',
      'sudo /usr/local/bin/gh pr create',
    ]) {
      expect(reviewGate(line).kind).toBe('check')
    }
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
        expect(j.reason).toContain('review diff --auto --base origin/main --intent')
        expect(j.reason).toContain(REVIEW_HATCH)
      }
    }
  })

  test('without a base on the line, the message names the gate\'s own, or a placeholder', () => {
    const unresolved = reviewVerdict(said({ required: true, code_lines: 30 }), 'develop')
    expect(unresolved.kind === 'deny' && unresolved.reason).toContain('--base develop')
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
    const clock = mock.clock(on)
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
    return { asked, ran, clock }
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

  test('a second gh pr create on the line is asked about too, with its own base', async ($, on) => {
    const { asked } = setup($, on, () => {
      const base = asked.at(-1)?.argv.at(-1)
      return GATE({ required: base === 'develop', code_lines: 50, base })
    })
    const denied = await $.tool.call({ tool: 'Bash', command: 'gh pr create -B main --fill; gh pr create -B develop --fill' })
    expect(denied.deny).toContain("This PR's Diff has 50 changed code lines")
    expect(asked.map(a => a.argv.at(-1))).toEqual(['main', 'develop'])
  })

  test('a commit before gh pr create on the same line is refused without asking the gate; a push or a status is not', async ($, on) => {
    const { asked, ran } = setup($, on, () => GATE({ required: false, code_lines: 0 }))
    const denied = await $.tool.call({ tool: 'Bash', command: 'git add x && git commit -m w && git push && gh pr create --fill' })
    expect(denied.deny).toContain('in its own Bash call')
    expect(asked).toEqual([])
    for (const command of ['git push && gh pr create --fill', 'git status; gh pr create --fill']) expect((await $.tool.call({ tool: 'Bash', command })).deny).toBeUndefined()
    expect((await $.tool.call({ tool: 'Bash', command: `git commit -m w && ${REVIEW_HATCH} gh pr create` })).deny).toBeUndefined()
    expect(ran).toHaveLength(2 + 1)
  })

  test('--head is passed to the gate after --base', async ($, on) => {
    const { asked } = setup($, on, () => GATE({ required: false, code_lines: 0 }))
    await $.tool.call({ tool: 'Bash', command: 'gh pr create --head feat/x --base main' })
    expect(asked[0]?.argv.slice(-5)).toEqual(['gate', '--base', 'main', '--head', 'feat/x'])
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

  test('every candidate directory is asked about, and any one that requires a Review refuses the line', async ($, on) => {
    const { asked } = setup($, on, () => GATE({ required: asked.at(-1)?.cwd === 'A', code_lines: 31 }))
    const denied = await $.tool.call({ tool: 'Bash', command: 'cd A || true; gh pr create' })
    expect(denied.deny).toContain('31 changed code lines')
    expect(asked.map(a => a.cwd)).toEqual([undefined, 'A'])
  })

  test('a second gh pr create after a subshell cd is asked about in the original directory', async ($, on) => {
    const { asked } = setup($, on, () => GATE({ required: false, code_lines: 0 }))
    await $.tool.call({ tool: 'Bash', command: '(cd x; gh pr create); gh pr create -B dev' })
    expect(asked.map(a => [a.cwd, a.argv.at(-1)])).toEqual([['x', 'gate'], [undefined, 'dev']])
  })

  test('one deadline covers the whole line: what is left bounds each ask, and an expired one lets the rest through', async ($, on) => {
    let clock: { advance: (ms: number) => Promise<unknown> } | undefined
    const ctx = setup($, on, (async () => {
      await clock?.advance(9000)
      return GATE({ required: false, code_lines: 0 })
    }) as never)
    clock = ctx.clock
    const r = await $.tool.call({ tool: 'Bash', command: 'gh pr create -B a; gh pr create -B b; gh pr create -B c' })
    expect(r.deny).toBeUndefined()
    expect(ctx.asked.map(a => [a.argv.at(-1), a.timeoutMs])).toEqual([['a', 15000], ['b', 6000]])
  })

  test('a directory the shell computes is not asked about', async ($, on) => {
    const { asked, ran } = setup($, on, () => GATE({ required: true, code_lines: 99 }))
    await $.tool.call({ tool: 'Bash', command: 'cd "$DIR" && gh pr create' })
    expect(asked).toEqual([])
    expect(ran).toHaveLength(1)
  })
})
