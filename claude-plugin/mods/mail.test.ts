import { describe, expect, test } from 'claude-code/testing'

import {
  addressPrompt,
  claimMine,
  fixPrompt,
  isPost,
  isPrCreate,
  nextPollMs,
  parsePr,
  prRefOf,
  startWatch,
  step,
  tally,
  type Check,
  type Item,
  type Pr,
} from './mail'

const rng = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T
const RUNS = 300

const VIEWER = 'Anthony-Bible'
const AUTHORS = [VIEWER, 'copilot-pull-request-reviewer', 'someone-else']

const pr = (items: Item[], checks: Check[] = [], state: Pr['state'] = 'OPEN'): Pr => ({
  number: 42,
  url: 'https://github.com/o/r/pull/42',
  state,
  branch: 'feat/x',
  viewer: VIEWER,
  checks,
  items,
})

let clock = 0
const item = (r: () => number, thread?: string): Item => {
  clock += 1000
  return { id: `c:${Math.floor(r() * 1e9)}`, author: pick(r, AUTHORS), at: new Date(clock).toISOString(), thread }
}

describe('the Watched PR as GitHub reports it', () => {
  test('comments, review bodies and thread comments are items; an empty review (a thread reply) is not', () => {
    const json = JSON.stringify({
      data: {
        viewer: { login: VIEWER },
        repository: {
          pullRequest: {
            number: 41,
            url: 'https://github.com/o/r/pull/41',
            state: 'OPEN',
            headRefName: 'feat/x',
            comments: { nodes: [{ databaseId: 1, author: { login: 'a' }, createdAt: '2026-10-06T03:00:00Z' }] },
            reviews: {
              nodes: [
                { databaseId: 2, author: { login: 'copilot-pull-request-reviewer' }, createdAt: '2026-10-06T03:10:23Z', body: '## Copilot review' },
                { databaseId: 3, author: { login: VIEWER }, createdAt: '2026-10-07T01:08:20Z', body: '' },
              ],
            },
            reviewThreads: {
              nodes: [
                {
                  isResolved: true,
                  comments: {
                    nodes: [
                      { databaseId: 4, author: { login: 'Copilot' }, createdAt: '2026-10-06T03:10:23Z' },
                      { databaseId: 5, author: { login: VIEWER }, createdAt: '2026-10-07T01:08:20Z' },
                    ],
                  },
                },
              ],
            },
            commits: {
              nodes: [
                {
                  commit: {
                    statusCheckRollup: {
                      contexts: {
                        nodes: [
                          { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' },
                          { __typename: 'CheckRun', name: 'deploy', status: 'COMPLETED', conclusion: 'SKIPPED' },
                          { __typename: 'CheckRun', name: 'lint', status: 'IN_PROGRESS', conclusion: null },
                          { __typename: 'CheckRun', name: 'sec', status: 'COMPLETED', conclusion: 'FAILURE' },
                          { __typename: 'StatusContext', context: 'ci/legacy', state: 'PENDING' },
                          { __typename: 'StatusContext', context: 'ci/old', state: 'ERROR' },
                        ],
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    })
    const p = parsePr(json)
    expect(p?.number).toBe(41)
    expect(p?.viewer).toBe(VIEWER)
    expect(p?.items.map(i => i.id).sort()).toEqual(['c:1', 'r:2', 't:4', 't:5'])
    expect(p?.items.find(i => i.id === 't:5')).toMatchObject({ thread: 't:4', isResolved: true })
    expect(p?.checks).toEqual([
      { name: 'test', state: 'pass' },
      { name: 'deploy', state: 'pass' },
      { name: 'lint', state: 'pending' },
      { name: 'sec', state: 'fail' },
      { name: 'ci/legacy', state: 'pending' },
      { name: 'ci/old', state: 'fail' },
    ])
  })

  test('anything that is not a pull request reads as nothing', () => {
    for (const text of ['', 'not json', '{"data":{"repository":{"pullRequest":null}}}', '{"errors":[{}]}']) {
      expect(parsePr(text)).toBeUndefined()
    }
  })
})

describe('Mail', () => {
  test('what was on the PR when the watch began is never Mail', () => {
    const r = rng(1)
    for (let i = 0; i < RUNS; i++) {
      const before = Array.from({ length: Math.floor(r() * 6) }, () => item(r))
      const w = startWatch(pr(before), '/repo', 0)
      expect(step(w, pr(before), 1).events.filter(e => e.kind === 'mail')).toEqual([])
    }
  })

  test('every new comment is delivered as Mail exactly once, whoever wrote it, except the ones Claude posted', () => {
    const r = rng(2)
    for (let i = 0; i < RUNS; i++) {
      let w = startWatch(pr([]), '/repo', 0)
      const all: Item[] = []
      const claude = new Set<string>()
      const delivered: string[] = []
      for (let k = 0; k < 6; k++) {
        all.push(...Array.from({ length: Math.floor(r() * 3) }, () => item(r)))
        const s = step(w, pr([...all]), k)
        w = s.watch!
        for (const e of s.events) if (e.kind === 'mail') delivered.push(...e.mail.map(m => m.id))
        if (r() < 0.4) {
          // Claude posts as the viewer, and the hook claims it right after the post.
          const posted = { ...item(r), author: VIEWER }
          all.push(posted)
          claude.add(posted.id)
          w = claimMine(w, pr([...all]))
        }
      }
      expect(delivered.sort()).toEqual(all.filter(x => !claude.has(x.id)).map(x => x.id).sort())
    }
  })

  test('Mail is Answered by a resolved thread, or by a later reply of Claude in its thread', () => {
    const copilot = { id: 't:1', author: 'Copilot', at: '2026-10-01T00:00:01Z', thread: 't:1', isResolved: false }
    let w = startWatch(pr([]), '/repo', 0)
    let s = step(w, pr([copilot]), 1)
    expect(s.watch?.mail.map(m => m.id)).toEqual(['t:1'])

    // Someone else's reply answers nothing.
    const other = { id: 't:2', author: 'someone-else', at: '2026-10-01T00:00:02Z', thread: 't:1', isResolved: false }
    s = step(s.watch!, pr([copilot, other]), 2)
    expect(s.watch?.mail.map(m => m.id).sort()).toEqual(['t:1', 't:2'])

    const reply = { id: 't:3', author: VIEWER, at: '2026-10-01T00:00:03Z', thread: 't:1', isResolved: false }
    w = claimMine(s.watch!, pr([copilot, other, reply]))
    s = step(w, pr([copilot, other, reply]), 3)
    expect(s.watch?.mail).toEqual([])
    expect(s.events).toContainEqual({ kind: 'answered', count: 2 })

    const late = { id: 'c:9', author: 'someone-else', at: '2026-10-01T00:00:04Z' }
    const resolved = [copilot, other, reply].map(x => ({ ...x, isResolved: true }))
    s = step(s.watch!, pr([...resolved, late]), 4)
    expect(s.watch?.mail.map(m => m.id)).toEqual(['c:9'])
  })

  test('a top-level comment is Answered by any comment Claude posts after it, never one before it', () => {
    const r = rng(3)
    for (let i = 0; i < RUNS; i++) {
      const top: Item = { id: 'c:1', author: pick(r, AUTHORS), at: '2026-10-01T00:00:05Z' }
      const isAfter = r() < 0.5
      const mine: Item = { id: 'c:2', author: VIEWER, at: isAfter ? '2026-10-01T00:00:09Z' : '2026-10-01T00:00:01Z', thread: r() < 0.5 ? 't:7' : undefined }
      let w = startWatch(pr([]), '/repo', 0)
      w = step(w, pr([top]), 1).watch!
      w = claimMine(w, pr([top, mine]))
      expect(step(w, pr([top, mine]), 2).watch?.mail.length).toBe(isAfter ? 0 : 1)
    }
  })
})

describe("the Watched PR's checks", () => {
  test('a check is reported red once when it turns red, and all-green once when the last one passes', () => {
    let w = startWatch(pr([], [{ name: 'test', state: 'pending' }]), '/repo', 0)
    let s = step(w, pr([], [{ name: 'test', state: 'fail' }, { name: 'lint', state: 'pending' }]), 1)
    expect(s.events).toEqual([{ kind: 'red', names: ['test'] }])
    s = step(s.watch!, pr([], [{ name: 'test', state: 'fail' }, { name: 'lint', state: 'fail' }]), 2)
    expect(s.events).toEqual([{ kind: 'red', names: ['lint'] }])
    s = step(s.watch!, pr([], [{ name: 'test', state: 'pass' }, { name: 'lint', state: 'pass' }]), 3)
    expect(s.events).toEqual([{ kind: 'green' }])
    s = step(s.watch!, pr([], [{ name: 'test', state: 'pass' }, { name: 'lint', state: 'pass' }]), 4)
    expect(s.events).toEqual([])
    w = s.watch!
    expect(tally(w.checks)).toEqual({ passed: 2, total: 2, failed: [], pending: [] })
  })

  test('merging or closing the PR ends the watch', () => {
    const w = startWatch(pr([]), '/repo', 0)
    expect(step(w, pr([], [], 'MERGED'), 1)).toEqual({ watch: undefined, events: [{ kind: 'merged' }] })
    expect(step(w, pr([], [], 'CLOSED'), 1)).toEqual({ watch: undefined, events: [{ kind: 'closed' }] })
  })
})

describe('the poll', () => {
  test('30s while a check runs, 2 min otherwise, 10 min after an hour without change', () => {
    const r = rng(4)
    const STATES = ['pass', 'fail', 'pending'] as const
    for (let i = 0; i < RUNS; i++) {
      const checks = Array.from({ length: Math.floor(r() * 4) }, (_, k) => ({ name: `c${k}`, state: pick(r, STATES) }))
      const w = { ...startWatch(pr([], checks), '/repo', 0), changedAt: 0 }
      const now = Math.floor(r() * 3 * 3600_000)
      const ms = nextPollMs(w, now)
      if (checks.some(c => c.state === 'pending')) expect(ms).toBe(30_000)
      else expect(ms).toBe(now > 3600_000 ? 600_000 : 120_000)
    }
  })
})

describe("a PR's URL", () => {
  test('names its repository and number, wherever it sits in gh output', () => {
    expect(prRefOf('Creating pull request...\nhttps://github.com/Anthony-Bible/gemini-live/pull/45\n')).toEqual({
      owner: 'Anthony-Bible',
      repo: 'gemini-live',
      number: 45,
    })
    expect(prRefOf('https://github.com/o/r/issues/4')).toBeUndefined()
  })
})

describe('the Bash lines Sponsor Mail reads', () => {
  test('gh pr create opens the watch; a line that only mentions it does not', () => {
    expect(isPrCreate('git push -u origin HEAD && gh pr create --fill')).toBe(true)
    expect(isPrCreate('cd x && gh pr create -t "t" -b "$(cat body.md)"')).toBe(true)
    for (const line of ['echo "gh pr create"', 'gh pr view', 'gh pr list | grep create']) expect(isPrCreate(line)).toBe(false)
  })

  test('posting a comment, a review or a write through gh api is a post; reading is not', () => {
    for (const line of [
      'gh pr comment 42 --body "done"',
      'gh pr review 42 --comment -b "x"',
      'gh api repos/{owner}/{repo}/pulls/42/comments/1/replies -f body="fixed"',
      'gh api -X PATCH repos/o/r/issues/comments/1 --input b.json',
      `gh api graphql -f query='mutation { addPullRequestReviewThreadReply(input: {}) { comment { id } } }'`,
    ]) {
      expect(isPost(line)).toBe(true)
    }
    for (const line of [
      'gh pr view 42 --comments',
      'gh api repos/o/r/pulls/42/comments',
      `gh api graphql -f query='query { viewer { login } }'`,
      'gh api -X GET search/issues -f q=x',
      'echo "gh pr comment 1"',
      `echo mutation && gh api graphql -f query='query { viewer { login } }'`,
    ]) {
      expect(isPost(line)).toBe(false)
    }
  })
})

describe('the prompts the buttons queue', () => {
  test('name the PR and who wrote the Mail, or the failing checks', () => {
    let w = startWatch(pr([]), '/repo', 0)
    w = step(w, pr([{ id: 'c:1', author: 'Copilot', at: 'x' }, { id: 'c:2', author: 'Copilot', at: 'y' }]), 1).watch!
    expect(addressPrompt(w)).toContain('PR #42')
    expect(addressPrompt(w)).toContain('2 unanswered')
    expect(addressPrompt(w)).toContain('Copilot')
    w = step(w, pr(w.mail.map(m => ({ id: m.id, author: m.author, at: 'x' })), [{ name: 'lint', state: 'fail' }]), 2).watch!
    expect(fixPrompt(w)).toContain('lint')
    expect(fixPrompt(w)).toContain('PR #42')
  })
})
