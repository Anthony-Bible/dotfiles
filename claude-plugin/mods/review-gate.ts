// The PR Gate's pure half: which Bash lines open a pull request, what the second-opinion gate said about the
// branch, and the refusal. Only `gh pr create` is gated, never `git commit`. No `$` here.

import { CREATE_VALUE_FLAGS, createDirsOf, prCreates } from './mail'
import { words, type Word } from './shell'

export type Judged = { kind: 'pass' } | { kind: 'deny'; reason: string }

/** The Review Escape Hatch: an assignment of it in a gh pr create's own prefix (`REVIEW_OK=1 gh pr create`,
 *  `env REVIEW_OK=1 gh pr create`) exempts that command, and only that one. */
export const REVIEW_HATCH = 'REVIEW_OK=1'

/**
 * What to ask the gate about: the PR's base branch if the line names one, and every directory it may run in
 * (undefined is where the line starts). A directory the shell computes is not listed: the gate has no say there.
 */
export type GateCheck = {
  kind: 'check'
  base?: string
  /** The PR's head branch (`-H` / `--head`) when the line names one; the gate then judges that ref, not HEAD. */
  head?: string
  /** An earlier command on the line can move HEAD or the branch, so the gate would judge the wrong tree. */
  movesHead?: true
  dirs: (string | undefined)[]
}

const unquoted = (line: string, w: Word): string => line.slice(w.start, w.end).replace(/["']/g, '')

/**
 * The value of a flag in every spelling (`-B main`, `-Bmain`, `-B=main`, `--base=main`). The last one wins; the
 * values of other flags (`--title "--base=x"`) and anything after `--` are not flags.
 */
const flagValue = (line: string, nth: number, short: string, long: string): string | undefined => {
  const rest = prCreates(line)[nth]?.rest ?? []
  let value: string | undefined
  for (let i = 0; i < rest.length; i++) {
    const t = unquoted(line, rest[i] as Word)
    if (t === '--') break
    if (t === short || t === long) {
      const next = rest[i + 1]
      if (next) value = unquoted(line, next)
      i++
    } else if (t.startsWith(`${long}=`)) value = t.slice(long.length + 1)
    else if (t.startsWith(short) && !t.startsWith('--')) value = t.slice(short.length).replace(/^=/, '')
    else if (CREATE_VALUE_FLAGS.has(t)) i++
  }
  return value || undefined
}

const baseOf = (line: string, nth = 0): string | undefined => flagValue(line, nth, '-B', '--base')
const headOf = (line: string, nth = 0): string | undefined => flagValue(line, nth, '-H', '--head')

/** Git subcommands that move HEAD or the checked-out branch. */
const HEAD_MOVERS = new Set(['commit', 'merge', 'rebase', 'cherry-pick', 'revert', 'am', 'pull', 'reset', 'checkout', 'switch'])
/** Those that, given `--` and a path, only touch files. */
const PATH_FORMS = new Set(['checkout', 'reset'])
const GIT_VALUE_FLAGS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix', '--config-env'])

/**
 * Whether a git command before word `at` can move what the gate would judge: HEAD, the checked-out branch, a
 * branch ref (`branch -f`, `update-ref`), or, when the PR names its head, a ref a push or fetch writes (a refspec
 * with `:`). The hook runs before the line does, so the gate would see the refs as they are now.
 */
const movesHead = (line: string, ws: readonly Word[], at: number, namesHead: boolean): boolean => {
  for (let i = 0; i < at; i++) {
    const w = ws[i] as Word
    if (!w.isCommand || unquoted(line, w).replace(/^.*\//, '') !== 'git') continue
    let j = i + 1
    const arg = (k: number): string | undefined => {
      const a = ws[k]
      return a && !a.startsCommand ? unquoted(line, a) : undefined
    }
    for (let t = arg(j); t !== undefined && t.startsWith('-'); t = arg(j)) j += GIT_VALUE_FLAGS.has(t) ? 2 : 1
    const sub = arg(j)
    if (sub === undefined) continue
    const args: string[] = []
    for (let k = j + 1; arg(k) !== undefined; k++) args.push(arg(k) as string)
    if (PATH_FORMS.has(sub) && args.includes('--')) continue
    if (HEAD_MOVERS.has(sub) || sub === 'update-ref') return true
    if (sub === 'branch' && args.some(a => a === '--force' || /^-[A-Za-z]*[fmMC]/.test(a) && !a.startsWith('--'))) return true
    if (namesHead && (sub === 'push' || sub === 'fetch') && args.some(a => !a.startsWith('-') && a.includes(':') && !a.includes('@') && !a.includes('://'))) return true
  }
  return false
}

/**
 * Whether the line opens a pull request the gate must look at: a `gh pr create` not carrying the Review Escape
 * Hatch. A line that only mentions the command (`echo "gh pr create"`) is not one.
 */
export const reviewGate = (line: string): { kind: 'pass' } | GateCheck => {
  const first = reviewChecks(line)[0]
  return first ?? { kind: 'pass' }
}

/** Whether the command at word `at` carries the Hatch among the assignments and wrappers of its own simple command. */
const hatched = (line: string, ws: readonly Word[], at: number): boolean => {
  if ((ws[at] as Word).startsCommand) return false // nothing before it belongs to this command
  for (let i = at - 1; i >= 0 && (ws[i] as Word).isCommand; i--) {
    if (unquoted(line, ws[i] as Word) === REVIEW_HATCH) return true
    if ((ws[i] as Word).startsCommand) break
  }
  return false
}

/** A directory the PR was created from, with a leading `~` or `~/` resolved against `home`; null when it names another user's home (computed, so unknown). */
export const expandHome = (dir: string | undefined, home: string): string | null | undefined => {
  if (dir === undefined || !dir.startsWith('~')) return dir
  if (dir === '~') return home
  return dir.startsWith('~/') ? home + dir.slice(1) : null
}

/** Every pull request the line opens, each with its own base and directories; none when the line passes. */
export const reviewChecks = (line: string): GateCheck[] => {
  const ws = words(line)
  return prCreates(line).flatMap(({ at }, nth) =>
    hatched(line, ws, at)
      ? []
      : [
          {
            kind: 'check' as const,
            base: baseOf(line, nth),
            ...(headOf(line, nth) ? { head: headOf(line, nth) } : {}),
            ...(movesHead(line, ws, at, headOf(line, nth) !== undefined) ? { movesHead: true as const } : {}),
            dirs: createDirsOf(line, nth).filter((d): d is string | undefined => d !== null),
          },
        ],
  )
}

/** What the gate script printed, reduced to what the guard needs; undefined for anything that is not its JSON. */
export const gateResult = (stdout: string): { required: boolean; codeLines: number; base?: string } | undefined => {
  try {
    const r = JSON.parse(stdout) as unknown
    if (typeof r !== 'object' || r === null || typeof (r as { required?: unknown }).required !== 'boolean') return undefined
    const { required, code_lines, base } = r as { required: boolean; code_lines?: unknown; base?: unknown }
    return {
      required,
      codeLines: typeof code_lines === 'number' ? code_lines : 0,
      base: typeof base === 'string' && base ? base : undefined,
    }
  } catch {
    return undefined
  }
}

/** Deny when the gate says a Review is required; anything else, a failed or unreadable run included, passes. */
export const reviewVerdict = (run: { exitCode: number; stdout: string }, base?: string): Judged => {
  const g = run.exitCode === 0 ? gateResult(run.stdout) : undefined
  if (!g?.required) return { kind: 'pass' }
  return {
    kind: 'deny',
    reason:
      `This PR's Diff has ${g.codeLines} changed code lines that no second-opinion Review covers. ` +
      `Run the second-opinion skill (\`review diff --auto --base ${g.base ?? base ?? '<PR base branch>'} --intent …\`) first. ` +
      `${REVIEW_HATCH} bypasses this only when the user says so.`,
  }
}
