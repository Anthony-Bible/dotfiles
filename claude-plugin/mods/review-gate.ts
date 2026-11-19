// The PR Gate's pure half: which Bash lines open a pull request, what the second-opinion gate said about the
// branch, and the refusal. Only `gh pr create` is gated, never `git commit`. No `$` here.

import { createDirOf, isPrCreate } from './mail'
import { argsOf, hasAssignment, words } from './shell'

export type Judged = { kind: 'pass' } | { kind: 'deny'; reason: string }

/** The Review Escape Hatch: an assignment of it anywhere in the line leaves the whole line alone. */
export const REVIEW_HATCH = 'REVIEW_OK=1'

/** What to ask the gate about: the PR's base branch if the line names one, and where the line runs it. */
export type GateCheck = { kind: 'check'; base?: string; dir: string | null | undefined }

/** The branch named by `-B` / `--base`, however it is attached: `-B main`, `-Bmain`, `-B=main`, `--base=main`. */
const baseOf = (line: string): string | undefined => {
  const ws = words(line)
  const at = ws.findIndex((w, i) => {
    const a = argsOf(ws, i)
    return w.isCommand && w.text === 'gh' && a[0]?.text === 'pr' && a[1]?.text === 'create'
  })
  if (at < 0) return undefined
  const args = argsOf(ws, at).map(a => line.slice(a.start, a.end).replace(/["']/g, ''))
  for (let i = 0; i < args.length; i++) {
    const t = args[i] as string
    if (t === '-B' || t === '--base') return args[i + 1]
    const attached = t.match(/^(?:--base=|-B=?)(.+)$/)
    if (attached) return attached[1]
  }
  return undefined
}

/**
 * Whether the line opens a pull request the gate must look at: a `gh pr create` not carrying the Review Escape
 * Hatch. A line that only mentions the command (`echo "gh pr create"`) is not one.
 */
export const reviewGate = (line: string): { kind: 'pass' } | GateCheck => {
  if (!isPrCreate(line) || hasAssignment(words(line), REVIEW_HATCH)) return { kind: 'pass' }
  return { kind: 'check', base: baseOf(line), dir: createDirOf(line) }
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
      `Run the second-opinion skill (\`review diff --auto --base ${base ?? g.base ?? '<PR base branch>'} --intent …\`) first. ` +
      `${REVIEW_HATCH} bypasses this only when the user says so.`,
  }
}
