import { describe, expect, test } from 'claude-code/testing'

import { BRANCH_HATCH, branchGuard, gitSteps, protectedBranches, type Repo } from './branch'

const rng = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T
const RUNS = 300

const on = (branch: string | undefined, defaultBranch?: string) => (): Repo => ({ branch, defaultBranch })

const COMMITS = ['git commit -m wip', 'git commit -am "fix it"', 'git -c user.name=x commit --amend --no-edit', 'sudo git commit -m x', 'ls && git commit -m x']
const PROTECTED = ['main', 'master']

describe('Protected Branches', () => {
  test('main, master and the repo default are protected, and nothing else', () => {
    expect([...protectedBranches({ defaultBranch: 'develop' })].sort()).toEqual(['develop', 'main', 'master'])
    expect([...protectedBranches({})].sort()).toEqual(['main', 'master'])
  })
})

describe('the Branch Guard on commits', () => {
  test('a commit on a Protected Branch is refused, naming how to branch and the Escape Hatch', () => {
    const r = rng(1)
    for (let i = 0; i < RUNS; i++) {
      const g = branchGuard(pick(r, COMMITS), on(pick(r, PROTECTED)))
      expect(g.kind).toBe('deny')
      if (g.kind === 'deny') {
        expect(g.reason).toContain('git switch -c')
        expect(g.reason).toContain(BRANCH_HATCH)
      }
    }
    expect(branchGuard('git commit -m x', on('trunk', 'trunk')).kind).toBe('deny')
  })

  test('a commit elsewhere passes: a feature branch, a detached HEAD, or outside a repository', () => {
    for (const line of COMMITS) {
      expect(branchGuard(line, on('feat/x'))).toEqual({ kind: 'pass' })
      expect(branchGuard(line, on(undefined))).toEqual({ kind: 'pass' })
      expect(branchGuard(line, () => undefined)).toEqual({ kind: 'pass' })
    }
  })

  test('the Escape Hatch passes a commit or push on a Protected Branch, and only as an assignment', () => {
    const r = rng(2)
    for (let i = 0; i < RUNS; i++) {
      const line = r() < 0.5 ? pick(r, COMMITS) : 'git push origin main'
      expect(branchGuard(`${BRANCH_HATCH} ${line}`, on('main'))).toEqual({ kind: 'pass' })
    }
    expect(branchGuard(`git commit -m ${BRANCH_HATCH}`, on('main')).kind).toBe('deny')
  })

  test('a line that only mentions a commit is not one', () => {
    for (const line of ['echo "git commit"', 'git log --grep commit', 'git show HEAD', "grep -r 'git push origin main' .", "cat > notes.md <<'EOF'\ngit commit -m x\n(git push origin main)\nEOF"])
      expect(branchGuard(line, on('main'))).toEqual({ kind: 'pass' })
  })

  test('a commit is judged in the directory it runs in, from -C or an earlier cd', () => {
    const repos: Record<string, Repo> = { '': { branch: 'feat/x' }, other: { branch: 'main' } }
    const repoOf = (dir: string) => repos[dir]
    expect(branchGuard('git commit -m x', repoOf).kind).toBe('pass')
    expect(branchGuard('git -C other commit -m x', repoOf).kind).toBe('deny')
    expect(branchGuard('cd other && git commit -m x', repoOf).kind).toBe('deny')
    expect(gitSteps('cd a && cd b && git -C c commit')).toEqual([{ kind: 'commit', dir: 'a/b/c', args: [] }])
  })
})

describe('the Branch Guard on pushes', () => {
  test('a push that names a Protected Branch as its target is refused from any branch', () => {
    const lines = [
      'git push origin main',
      'git push -u origin main',
      'git push origin HEAD:main',
      'git push origin +main',
      'git push origin feat/x:refs/heads/main',
      'git push --force origin master',
      'git push origin --delete main',
      'git push origin :main',
      'git push --all',
      'git push --mirror origin',
      'git push --repo origin origin main',
    ]
    for (const line of lines) for (const branch of ['feat/x', 'main']) expect(branchGuard(line, on(branch)).kind).toBe('deny')
  })

  test('a push without a branch target pushes the current branch, refused only on a Protected Branch', () => {
    for (const line of ['git push', 'git push origin', 'git push -u origin HEAD', 'git push origin @', 'git push --force-with-lease']) {
      expect(branchGuard(line, on('main')).kind).toBe('deny')
      expect(branchGuard(line, on('feat/x')).kind).toBe('pass')
    }
  })

  test('a push to other branches or of tags passes, even from a Protected Branch', () => {
    for (const line of ['git push origin feat/x', 'git push -u origin main:feat/x', 'git push --tags', 'git push origin v1.2.0', 'git push -o ci.skip origin feat/x'])
      expect(branchGuard(line, on('main'))).toEqual({ kind: 'pass' })
  })
})
