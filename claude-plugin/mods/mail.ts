// Sponsor Mail's pure half: the Watched PR as GitHub reports it, which of its comments are Mail, when Mail is
// Answered, what its checks did since the last look, and which Bash lines open the watch or post as Claude.
// No `$` here.

import { argsOf, words } from './shell'
import type { Award } from './points'

export type CheckState = 'pass' | 'fail' | 'pending'
export type Check = { name: string; state: CheckState }

/**
 * One comment on the PR: `c:` a top-level comment, `r:` a review's body, `t:` a review thread's comment. A thread's
 * comments carry `thread`, the id of its first comment, and whether the thread is resolved.
 */
export type Item = { id: string; author: string; at: string; thread?: string; isResolved?: boolean }

export type Pr = {
  number: number
  url: string
  state: 'OPEN' | 'MERGED' | 'CLOSED'
  branch: string
  /** The login gh speaks as, which is also the login Claude posts as. */
  viewer: string
  checks: Check[]
  items: Item[]
}

export type MailEntry = { id: string; author: string }

export type MailWatch = {
  number: number
  url: string
  branch: string
  /** The repository's root, where every gh call of the watch runs. */
  root: string
  /** Every item already looked at: the baseline, delivered Mail and Claude's own. */
  seen: string[]
  /** The items Claude posted. */
  mine: string[]
  /** Delivered Mail not yet Answered. */
  mail: MailEntry[]
  checks: Check[]
  /** When the PR last changed, for slowing the poll down. */
  changedAt: number
}

export type MailEvent =
  | { kind: 'mail'; mail: MailEntry[] }
  | { kind: 'answered'; count: number }
  | { kind: 'red'; names: string[] }
  | { kind: 'green' }
  | { kind: 'merged' }
  | { kind: 'closed' }

/** One GraphQL call answers everything a poll needs; `$n` is the PR's number. */
export const PR_QUERY = `query($owner:String!,$repo:String!,$n:Int!){viewer{login} repository(owner:$owner,name:$repo){pullRequest(number:$n){number url state headRefName
comments(last:100){nodes{databaseId author{login} createdAt}}
reviews(last:100){nodes{databaseId author{login} createdAt body}}
reviewThreads(last:100){nodes{isResolved comments(first:100){nodes{databaseId author{login} createdAt}}}}
commits(last:1){nodes{commit{statusCheckRollup{contexts(first:100){nodes{__typename ... on CheckRun{name status conclusion} ... on StatusContext{context state}}}}}}}}}}`

/** A PR's URL as `{ owner, repo, number }`, or undefined for anything else. */
export const prRefOf = (text: string): { owner: string; repo: string; number: number } | undefined => {
  const m = text.match(/https:\/\/[^/\s]+\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/)
  return m ? { owner: m[1]!, repo: m[2]!, number: Number(m[3]) } : undefined
}

/** The gh argv for one look at the PR at `url`. */
export const prQueryArgv = (url: string): string[] => {
  const ref = prRefOf(url)
  return [
    'gh', 'api', 'graphql',
    '-F', `owner=${ref?.owner ?? '{owner}'}`, '-F', `repo=${ref?.repo ?? '{repo}'}`, '-F', `n=${ref?.number ?? 0}`,
    '-f', `query=${PR_QUERY}`,
  ]
}

type Node = { databaseId?: number; author?: { login?: string } | null; createdAt?: string; body?: string }

const PASSING = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED'])

const checkOf = (n: Record<string, unknown>): Check | undefined => {
  if (n.__typename === 'CheckRun') {
    const state: CheckState = n.status !== 'COMPLETED' ? 'pending' : PASSING.has(String(n.conclusion)) ? 'pass' : 'fail'
    return { name: String(n.name), state }
  }
  if (n.__typename === 'StatusContext') {
    const s = String(n.state)
    return { name: String(n.context), state: s === 'SUCCESS' ? 'pass' : s === 'PENDING' || s === 'EXPECTED' ? 'pending' : 'fail' }
  }
  return undefined
}

const itemOf = (prefix: string, n: Node, thread?: Pick<Item, 'thread' | 'isResolved'>): Item => ({
  id: `${prefix}:${n.databaseId}`,
  author: n.author?.login ?? 'ghost',
  at: n.createdAt ?? '',
  ...thread,
})

/** The PR in a `PR_QUERY` answer; undefined for an error or anything that is not one. */
export const parsePr = (text: string): Pr | undefined => {
  let d: any
  try {
    d = JSON.parse(text)
  } catch {
    return undefined
  }
  const p = d?.data?.repository?.pullRequest
  if (!p || typeof p.number !== 'number') return undefined
  const threads: { isResolved?: boolean; comments?: { nodes?: Node[] } }[] = p.reviewThreads?.nodes ?? []
  const items: Item[] = [
    ...((p.comments?.nodes ?? []) as Node[]).map(n => itemOf('c', n)),
    // A review with no body is the wrapper GitHub makes around thread comments; the comments are the items.
    ...((p.reviews?.nodes ?? []) as Node[]).filter(n => (n.body ?? '').trim() !== '').map(n => itemOf('r', n)),
    ...threads.flatMap(t => {
      const nodes = t.comments?.nodes ?? []
      const thread = nodes[0] ? `t:${nodes[0].databaseId}` : undefined
      return nodes.map(n => itemOf('t', n, { thread, isResolved: t.isResolved === true }))
    }),
  ]
  const contexts: Record<string, unknown>[] = p.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? []
  return {
    number: p.number,
    url: String(p.url ?? ''),
    state: p.state === 'MERGED' || p.state === 'CLOSED' ? p.state : 'OPEN',
    branch: String(p.headRefName ?? ''),
    viewer: String(d.data.viewer?.login ?? ''),
    checks: contexts.map(checkOf).filter((c): c is Check => c !== undefined),
    items,
  }
}

export const startWatch = (pr: Pr, root: string, now: number): MailWatch => ({
  number: pr.number,
  url: pr.url,
  branch: pr.branch,
  root,
  seen: pr.items.map(i => i.id),
  mine: [],
  mail: [],
  checks: pr.checks,
  changedAt: now,
})

/** Right after Claude posted: the viewer's items that appeared since the last look are Claude's. */
export const claimMine = (w: MailWatch, pr: Pr): MailWatch => {
  const seen = new Set(w.seen)
  const posted = pr.items.filter(i => !seen.has(i.id) && i.author === pr.viewer).map(i => i.id)
  return posted.length === 0 ? w : { ...w, seen: [...w.seen, ...posted], mine: [...w.mine, ...posted] }
}

const isAnswered = (item: Item, pr: Pr, mine: ReadonlySet<string>): boolean => {
  if (item.thread !== undefined && item.isResolved) return true
  return pr.items.some(
    m => mine.has(m.id) && m.at > item.at && (item.thread === undefined || m.thread === item.thread),
  )
}

export const tally = (checks: readonly Check[]) => ({
  passed: checks.filter(c => c.state === 'pass').length,
  total: checks.length,
  failed: checks.filter(c => c.state === 'fail').map(c => c.name),
  pending: checks.filter(c => c.state === 'pending').map(c => c.name),
})

const isAllGreen = (checks: readonly Check[]): boolean => checks.length > 0 && checks.every(c => c.state === 'pass')

/** One look at the PR: the watch after it (undefined once the PR is merged or closed) and what happened. */
export const step = (w: MailWatch, pr: Pr, now: number): { watch?: MailWatch; events: MailEvent[] } => {
  if (pr.state === 'MERGED') return { watch: undefined, events: [{ kind: 'merged' }] }
  if (pr.state === 'CLOSED') return { watch: undefined, events: [{ kind: 'closed' }] }
  const events: MailEvent[] = []
  const seen = new Set(w.seen)
  const mine = new Set(w.mine)
  const byId = new Map(pr.items.map(i => [i.id, i]))

  const fresh = pr.items.filter(i => !seen.has(i.id) && !mine.has(i.id)).map(i => ({ id: i.id, author: i.author }))
  if (fresh.length > 0) events.push({ kind: 'mail', mail: fresh })

  const open = (m: MailEntry) => {
    const item = byId.get(m.id)
    return item !== undefined && !isAnswered(item, pr, mine)
  }
  const answered = w.mail.filter(m => byId.has(m.id) && !open(m)).length
  if (answered > 0) events.push({ kind: 'answered', count: answered })
  const mail = [...w.mail, ...fresh].filter(open)

  const wasFailing = new Set(w.checks.filter(c => c.state === 'fail').map(c => c.name))
  const red = pr.checks.filter(c => c.state === 'fail' && !wasFailing.has(c.name)).map(c => c.name)
  if (red.length > 0) events.push({ kind: 'red', names: red })
  if (isAllGreen(pr.checks) && !isAllGreen(w.checks)) events.push({ kind: 'green' })

  const isChanged = events.length > 0 || JSON.stringify(pr.checks) !== JSON.stringify(w.checks)
  return {
    watch: {
      ...w,
      seen: [...w.seen, ...fresh.map(m => m.id)],
      mail,
      checks: pr.checks,
      changedAt: isChanged ? now : w.changedAt,
    },
    events,
  }
}

export const POLL_PENDING_MS = 30_000
export const POLL_MS = 120_000
export const POLL_QUIET_MS = 600_000
const QUIET_AFTER_MS = 3600_000

/** How long until the next look: quick while a check runs, slow once the PR has been quiet for an hour. */
export const nextPollMs = (w: MailWatch, now: number): number =>
  w.checks.some(c => c.state === 'pending') ? POLL_PENDING_MS : now - w.changedAt > QUIET_AFTER_MS ? POLL_QUIET_MS : POLL_MS

// ---------------------------------------------------------------------------------------- Bash lines

/** Each gh command the line runs: its argument words (quoted text masked) and its own span of the line. */
const ghCommands = (line: string): { args: string[]; text: string }[] => {
  const ws = words(line)
  return ws.flatMap((w, i) => {
    if (!w.isCommand || w.text !== 'gh') return []
    const args = argsOf(ws, i)
    return [{ args: args.map(a => a.text.replace(/^["']|["']$/g, '')), text: line.slice(w.start, (args.at(-1) ?? w).end) }]
  })
}

export const isPrCreate = (line: string): boolean => ghCommands(line).some(({ args: a }) => a[0] === 'pr' && a[1] === 'create')

const WRITE_FLAGS = new Set(['-f', '-F', '--field', '--raw-field', '--input'])

/** The line posts to GitHub as the viewer: a PR comment or review, or a write through gh api. */
export const isPost = (line: string): boolean =>
  ghCommands(line).some(({ args: a, text }) => {
    if (a[0] === 'pr') return a[1] === 'comment' || a[1] === 'review'
    if (a[0] !== 'api') return false
    if (a.includes('graphql')) return /\bmutation\b/.test(text)
    const method = a.findIndex(x => x === '-X' || x === '--method')
    if (method >= 0) return (a[method + 1] ?? '').toUpperCase() !== 'GET'
    const attached = a.find(x => /^(?:-X|--method=)/.test(x) && x.length > 2)
    if (attached) return !/GET$/i.test(attached)
    return a.some(x => WRITE_FLAGS.has(x) || /^--(?:field|raw-field|input)=/.test(x))
  })

// ------------------------------------------------------------------------------------ what it says

const authorsOf = (mail: readonly MailEntry[]): string => {
  const counts = new Map<string, number>()
  for (const m of mail) counts.set(m.author, (counts.get(m.author) ?? 0) + 1)
  return [...counts].map(([a, n]) => (n > 1 ? `${a} ×${n}` : a)).join(', ')
}

export const mailNotice = (w: MailWatch, mail: readonly MailEntry[]): string =>
  `${mail.length} new on PR #${w.number} from ${authorsOf(mail)}`

export const redNotice = (w: MailWatch, names: readonly string[]): string =>
  `${names.join(', ')} went red on PR #${w.number}`

export const addressPrompt = (w: MailWatch): string =>
  `Address the new review comments on PR #${w.number} (${w.url}): ${w.mail.length} unanswered, from ` +
  `${authorsOf(w.mail)}. Read them with gh, fix what is warranted, and reply in each thread saying what you did.`

export const fixPrompt = (w: MailWatch): string =>
  `Investigate the failing CI check${tally(w.checks).failed.length === 1 ? '' : 's'} ` +
  `${tally(w.checks).failed.join(', ')} on PR #${w.number} (gh pr checks ${w.number}) and fix ` +
  `${tally(w.checks).failed.length === 1 ? 'it' : 'them'}.`

// ------------------------------------------------------------------------------------------- awards

export const mergeAward = (w: Pick<MailWatch, 'number'>): Award => ({
  points: 50,
  event: `merged PR #${w.number}: the sponsors are thrilled`,
  achievement: 'Sponsored Content',
})

export const redAward = (w: Pick<MailWatch, 'number'>, names: readonly string[]): Award => ({
  points: -10,
  event: `CI check ${names.join(', ')} went red on PR #${w.number}`,
})

export const answeredAward = (w: Pick<MailWatch, 'number'>, count: number): Award => ({
  points: 5 * count,
  event: `answered ${count} piece${count === 1 ? '' : 's'} of Sponsor Mail on PR #${w.number}`,
})
