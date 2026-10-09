// The Branch Guard's pure half: which git commits and pushes a Bash line makes, where they run, and which ones
// land on a Protected Branch. No `$` here.

import { argsOf, hasAssignment, words, type Word } from './shell'

export type Judged = { kind: 'pass' } | { kind: 'deny'; reason: string }

/** The Branch Escape Hatch: an assignment of it anywhere in the line leaves the whole line alone. */
export const BRANCH_HATCH = 'BRANCH_OK=1'

/**
 * What the guard needs of a repository: its checked-out branch (absent when detached), its default branch, and
 * whether that branch is unborn (no commits yet), when its first commit may land wherever it must.
 */
export type Repo = { branch?: string; defaultBranch?: string; isUnborn?: boolean }

export const protectedBranches = (repo: Repo): Set<string> =>
  new Set(['main', 'master', ...(repo.defaultBranch ? [repo.defaultBranch] : [])])

/**
 * A git commit or push the line runs: `dir` is where it runs, relative to the session's directory ('' for the
 * directory itself), from earlier `cd`s and `-C`; `args` are the words after the subcommand, unquoted. A `cd`
 * that may have failed leaves one step per directory the command could run in.
 */
export type GitStep = { kind: 'commit' | 'push'; dir: string; args: string[] }

/** git's global options that take the next word as their value, ahead of the subcommand. */
const GIT_VALUE_FLAGS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env'])
/** push's options that take the next word as their value. */
const PUSH_VALUE_FLAGS = new Set(['--repo', '-o', '--push-option', '--receive-pack', '--exec'])

const valueOf = (line: string, w: Word): string => line.slice(w.start, w.end).replace(/["']/g, '')

/** `to` resolved against `from`, both relative to the session's directory. */
const join = (from: string, to: string): string => (to.startsWith('/') || to.startsWith('~') || from === '' ? to : `${from}/${to}`)

const unique = (xs: readonly string[]): string[] => [...new Set(xs)]

export const gitSteps = (line: string): GitStep[] => {
  const ws = words(line)
  const steps: GitStep[] = []
  // Where the next command may run: `dirs` if every `cd` since the chain last broke succeeded, `fallback` if one
  // failed. Only `&&` carries a `cd`'s success forward; any other operator lets a failed one's command run too.
  let dirs = ['']
  let fallback: string[] = []
  ws.forEach((w, i) => {
    if (w.startsCommand && w.joinedBy.replace(/\n/g, '') !== '&&') {
      dirs = unique([...dirs, ...fallback])
      fallback = []
    }
    if (!w.isCommand) return
    const args = argsOf(ws, i)
    if (w.text === 'cd') {
      fallback = unique([...fallback, ...dirs])
      dirs = unique(dirs.map(d => (args[0] ? join(d, valueOf(line, args[0])) : '~')))
      return
    }
    if (w.text !== 'git') return
    let at = dirs
    for (let k = 0; k < args.length; k++) {
      const t = (args[k] as Word).text
      if (!t.startsWith('-')) {
        if (t === 'commit' || t === 'push') {
          const rest = args.slice(k + 1).map(a => valueOf(line, a))
          for (const dir of at) steps.push({ kind: t, dir, args: rest })
        }
        return
      }
      if (t === '-C' && args[k + 1]) {
        const to = valueOf(line, args[k + 1] as Word)
        at = unique(at.map(d => join(d, to)))
      }
      if (GIT_VALUE_FLAGS.has(t)) k++
    }
  })
  return steps
}

/**
 * The branches a push's arguments land on: each refspec's destination, the current branch when none is named
 * (and no `--tags`), or 'all' for `--all`, `--branches` and `--mirror`.
 */
export const pushTargets = (args: readonly string[], current: string | undefined): string[] | 'all' => {
  const positional: string[] = []
  let isTags = false
  for (let i = 0; i < args.length; i++) {
    const t = args[i] as string
    if (t === '--') {
      positional.push(...args.slice(i + 1))
      break
    }
    if (!t.startsWith('-') || t === '-') positional.push(t)
    else if (t === '--all' || t === '--branches' || t === '--mirror') return 'all'
    else if (t === '--tags') isTags = true
    else if (PUSH_VALUE_FLAGS.has(t)) i++
  }
  const refspecs = positional.slice(1)
  if (refspecs.length === 0) return isTags || !current ? [] : [current]
  return refspecs.flatMap(spec => {
    const s = spec.replace(/^\+/, '')
    const dst = s.includes(':') ? s.slice(s.indexOf(':') + 1) : s
    const name = dst === 'HEAD' || dst === '@' ? current : dst.replace(/^refs\/heads\//, '')
    return name ? [name] : []
  })
}

const HATCH_NOTE = `Prefix ${BRANCH_HATCH} only when the Crawler asked for this to land on it.`

/**
 * What the guard does with a Bash line: deny a commit made on a Protected Branch or a push that lands on one,
 * unless the line carries the Branch Escape Hatch. `repoOf` gives the repository at a GitStep's `dir`, or
 * undefined outside one, where the guard has no say.
 */
export const branchGuard = (line: string, repoOf: (dir: string) => Repo | undefined): Judged => {
  if (hasAssignment(words(line), BRANCH_HATCH)) return { kind: 'pass' }
  for (const step of gitSteps(line)) {
    const repo = repoOf(step.dir)
    if (!repo) continue
    const guarded = protectedBranches(repo)
    if (step.kind === 'commit') {
      if (repo.branch && !repo.isUnborn && guarded.has(repo.branch))
        return {
          kind: 'deny',
          reason:
            `Branch Guard: \`git commit\` on \`${repo.branch}\`, a Protected Branch. ` +
            `Branch first with \`git switch -c <name>\` and commit there. ${HATCH_NOTE}`,
        }
      continue
    }
    const targets = pushTargets(step.args, repo.branch)
    const hit = targets === 'all' ? [...guarded].join('`, `') : targets.find(t => guarded.has(t))
    if (hit)
      return {
        kind: 'deny',
        reason:
          `Branch Guard: this \`git push\` lands on \`${hit}\`, a Protected Branch. ` +
          `Push a feature branch (\`git switch -c <name>\`) and open a pull request instead. ${HATCH_NOTE}`,
      }
  }
  return { kind: 'pass' }
}
