import { describe, expect, test } from 'claude-code/testing'

import {
  boardRows,
  completeLines,
  emptyCounts,
  foldPiEvents,
  parseJsonl,
  tail,
  type DispatchRow,
  type RunningMeta,
} from './board'

const rng = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}

const assistant = (text: string, input: number, output: number) =>
  JSON.stringify({
    type: 'message_end',
    message: { role: 'assistant', usage: { input, cacheRead: 0, output }, content: [{ type: 'text', text }] },
  })
const tool = (name: string) => JSON.stringify({ type: 'tool_execution_start', toolName: name })
const user = () => JSON.stringify({ type: 'message_end', message: { role: 'user', content: [] } })

describe('following a live log', () => {
  test('folding a log read in arbitrary byte chunks equals folding it whole', () => {
    const r = rng(7)
    const enc = new TextEncoder()
    const dec = new TextDecoder()
    for (let run = 0; run < 200; run++) {
      const lines = Array.from({ length: 1 + Math.floor(r() * 30) }, (_, i) => {
        const k = r()
        return k < 0.4
          ? tool(['read', 'edit', 'bash'][i % 3]!)
          : k < 0.8
            ? assistant(`é✓ step ${i}`, i * 100, i)
            : user()
      })
      const whole = enc.encode(lines.join('\n') + '\n')
      // The reader: offset in bytes, a chunk of whatever the file holds past it at a random size.
      let offset = 0
      let counts = emptyCounts()
      let size = 0
      while (offset < whole.length) {
        size = Math.min(whole.length, size + 1 + Math.floor(r() * 400))
        const chunk = dec.decode(whole.slice(offset, size)) // what `tail -c +N` hands back so far
        const { text, bytes } = completeLines(chunk)
        counts = foldPiEvents(counts, parseJsonl(text))
        offset += bytes
        if (size === whole.length && bytes === 0) break
      }
      expect(offset).toBe(whole.length)
      expect(counts).toEqual(foldPiEvents(emptyCounts(), parseJsonl(dec.decode(whole))))
    }
  })

  test('counts calls, tools and the largest context the way pi-dispatch.py does', () => {
    const c = foldPiEvents(
      emptyCounts(),
      parseJsonl(
        [user(), tool('read'), assistant('a', 1000, 50), tool('edit'), assistant('b', 800, 10), 'torn{'].join(
          '\n',
        ),
      ),
    )
    expect(c).toEqual({ calls: 2, tools: 2, ctx: 1050, lastTool: 'edit', lastText: 'b' })
  })
})

describe('boardRows', () => {
  const meta = (n: number): RunningMeta => ({
    n,
    ticket: `t${n}`,
    max_turns: 40,
    started: '2026-10-02T10:00:00',
    log: `.hybrid/logs/${n}.jsonl`,
    run_branch: 'hybrid/x',
  })
  const row = (n: number, branch = 'hybrid/x'): DispatchRow => ({
    n,
    ticket: `t${n}`,
    max_turns: 40,
    ended: 'finished',
    run_branch: branch,
    worktree: `/wt/${n}`,
    wall_s: 60,
    turns: 3,
    tool_calls: 4,
    ctx_max: 9000,
    result: 'done',
  })

  test('lists running and this run branch only, newest first, with a phase each', () => {
    const rows = boardRows({
      branch: 'hybrid/x',
      running: [{ meta: meta(5), counts: emptyCounts(), nowMs: Date.parse('2026-10-02T10:01:30') }],
      finished: [row(1), row(2), row(3), row(4, 'hybrid/other')],
      outcomes: [
        { n: 1, outcome: 'conflict' },
        { n: 1, outcome: 'landed' },
      ],
      worktreesPresent: new Set(['/wt/2']),
    })
    expect(rows.map(r => [r.n, r.phase])).toEqual([
      [5, 'running'],
      [3, 'gone'],
      [2, 'awaiting'],
      [1, 'landed'],
    ])
    expect(rows[0]?.wallS).toBe(90)
  })

  test('every row is unique by number, whatever overlaps between running and finished', () => {
    const r = rng(11)
    for (let run = 0; run < 200; run++) {
      const ns = Array.from({ length: 10 }, (_, i) => i + 1)
      const running = ns
        .filter(() => r() < 0.3)
        .map(n => ({ meta: meta(n), counts: emptyCounts(), nowMs: 0 }))
      const finished = ns.filter(() => r() < 0.7).map(n => row(n))
      const rows = boardRows({
        branch: 'hybrid/x',
        running,
        finished,
        outcomes: [],
        worktreesPresent: new Set(),
      })
      const seen = rows.map(x => x.n)
      expect(new Set(seen).size).toBe(seen.length)
      expect([...seen].sort((a, b) => b - a)).toEqual(seen)
    }
  })
})

describe('tail', () => {
  test('never wider than asked and always the end of the last line', () => {
    const r = rng(5)
    for (let run = 0; run < 300; run++) {
      const width = 5 + Math.floor(r() * 80)
      const text = Array.from({ length: 1 + Math.floor(r() * 3) }, () =>
        'ab '.repeat(Math.floor(r() * 60)),
      ).join('\n')
      const out = tail(text, width)
      expect(out.length).toBeLessThanOrEqual(width)
    }
    expect(tail('first\nsecond line', 100)).toBe('second line')
  })
})
