import { describe, expect, test } from 'claude-code/testing'

import {
  BEAST_HATCH,
  beastGuard,
  beastSegment,
  healthOf,
  hostOf,
  isBusy,
  isBeastUse,
  isDispatch,
  judge,
  llamaKeyOf,
  llamaUrlOf,
  modelAliasOf,
  modelStateOf,
  transition,
  type Probe,
  type Reading,
} from './beast'

const rng = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T
const RUNS = 300

const SMI_OK = { exitCode: 0, stdout: '21034, 24576\n', stderr: '' }
const SMI_LOST = { exitCode: 15, stdout: '', stderr: 'Unable to determine the device handle for GPU0000:01:00.0: GPU is lost.' }
const SMI_NONE = { exitCode: 0, stdout: '', stderr: '' }
const SSH_DOWN = { exitCode: 255, stdout: '', stderr: 'ssh: connect to host 192.168.86.55 port 22: Operation timed out' }
const HEALTH_OK = { code: 200, body: '{"status":"ok"}' }
const LOADING = { code: 503, body: '{"error":{"code":503,"message":"Loading model"}}' }

describe("Beast's address", () => {
  test("comes from pi-implementer's LLAMA_URL", () => {
    const env = 'LLAMA_API_KEY=k\nexport LLAMA_URL="http://192.168.86.55:8080/"\nCTX_SIZE=43690\n'
    expect(llamaUrlOf(env)).toBe('http://192.168.86.55:8080')
    expect(llamaUrlOf('CTX_SIZE=1\n')).toBeUndefined()
    expect(hostOf('http://192.168.86.55:8080')).toBe('192.168.86.55')
    expect(hostOf('https://beast.tail1234.ts.net')).toBe('beast.tail1234.ts.net')
  })
})

describe('the Beast State', () => {
  test('a lost or missing GPU, or no ssh, is Down whatever llama-server says', () => {
    const r = rng(1)
    for (let i = 0; i < RUNS; i++) {
      const p: Probe = {
        health: pick(r, [HEALTH_OK, LOADING, { code: 0, body: '' }]),
        smi: pick(r, [SMI_LOST, SMI_NONE, SSH_DOWN]),
        completion: pick(r, ['ok', 'timeout', 'skipped'] as const),
      }
      expect(judge(p).state).toBe('down')
    }
    expect(judge({ health: HEALTH_OK, smi: SMI_LOST }).reason).toBe('GPU lost')
    expect(judge({ health: HEALTH_OK, smi: SMI_NONE }).reason).toBe('no GPU')
    expect(judge({ health: HEALTH_OK, smi: SSH_DOWN }).reason).toBe('ssh unreachable')
  })

  test('with the GPU there: loading while llama-server says so, Down when it fails or is Wedged, Up otherwise', () => {
    expect(judge({ health: LOADING, smi: SMI_OK })).toMatchObject({ state: 'loading' })
    expect(judge({ health: { code: 0, body: '' }, smi: SMI_OK })).toMatchObject({ state: 'down', reason: 'llama-server unreachable' })
    expect(judge({ health: { code: 500, body: '' }, smi: SMI_OK })).toMatchObject({ state: 'down', reason: 'health 500' })
    expect(judge({ health: HEALTH_OK, smi: SMI_OK, completion: 'timeout' })).toMatchObject({ state: 'down', reason: 'wedged' })
    // A router serves models by name: its /health is 200 while the Dispatches' model is still loading.
    expect(judge({ health: HEALTH_OK, smi: SMI_OK, model: 'loading' })).toMatchObject({ state: 'loading' })
    expect(judge({ health: HEALTH_OK, smi: SMI_OK, model: 'missing' })).toMatchObject({ state: 'down', reason: 'model not served' })
    expect(judge({ health: HEALTH_OK, smi: SMI_OK, model: 'failed' })).toMatchObject({ state: 'down', reason: 'model failed to load' })
    for (const completion of ['ok', 'skipped', 'error', undefined] as const) {
      expect(judge({ health: HEALTH_OK, smi: SMI_OK, completion })).toEqual({ state: 'up', vram: { usedMb: 21034, totalMb: 24576 } })
    }
  })

  test('the HUD segment names the state and, when Up, the VRAM in use', () => {
    expect(beastSegment({ state: 'up', vram: { usedMb: 21034, totalMb: 24576 } })).toBe('beast 🟢 21/24GB')
    expect(beastSegment({ state: 'loading' })).toBe('beast ⏳ loading')
    expect(beastSegment({ state: 'down', reason: 'GPU lost' })).toBe('beast 🔴 GPU lost')
  })

  test('going Down and coming back are the only changes worth telling', () => {
    const STATES: Reading[] = [{ state: 'up' }, { state: 'loading' }, { state: 'down', reason: 'x' }]
    const r = rng(2)
    for (let i = 0; i < RUNS; i++) {
      const before = r() < 0.2 ? undefined : pick(r, STATES)
      const after = pick(r, STATES)
      const t = transition(before, after)
      if (after.state === 'down' && before?.state !== 'down') expect(t).toBe('down')
      else if (before?.state === 'down' && after.state === 'up') expect(t).toBe('recovered')
      else expect(t).toBeUndefined()
    }
  })
})

describe('the Beast Guard', () => {
  const DISPATCHES = [
    'python3 ~/.claude/plugins/x/pi-dispatch.py dispatch .hybrid/tickets/01.md',
    'cd repo && uv run pi-dispatch.py dispatch t.md --timeout 900',
    '/abs/scripts/pi-dispatch.py dispatch t.md 2>&1 | tail -5',
  ]
  const OTHERS = [
    'python3 pi-dispatch.py ledger',
    'python3 pi-dispatch.py land 3',
    'echo "pi-dispatch.py dispatch t.md"',
    'go test ./...',
  ]

  test('a Dispatch is any pi-dispatch dispatch command; ledger, land or a mention is not', () => {
    for (const line of DISPATCHES) expect(isDispatch(line)).toBe(true)
    for (const line of OTHERS) expect(isDispatch(line)).toBe(false)
  })

  test('refuses a Dispatch while Down and holds it while Loading; the Escape Hatch and other lines pass', () => {
    const r = rng(3)
    const READINGS: Reading[] = [{ state: 'up' }, { state: 'loading' }, { state: 'down', reason: 'GPU lost' }]
    for (let i = 0; i < RUNS; i++) {
      const reading = pick(r, READINGS)
      const isHatched = r() < 0.3
      const line = (isHatched ? `${BEAST_HATCH} ` : '') + pick(r, [...DISPATCHES, ...OTHERS])
      const g = beastGuard(line, reading)
      if (isHatched || !isDispatch(line) || reading.state === 'up') expect(g).toEqual({ kind: 'pass' })
      else if (reading.state === 'loading') expect(g).toEqual({ kind: 'wait' })
      else {
        expect(g.kind).toBe('deny')
        expect(g.kind === 'deny' && g.reason).toContain('GPU lost')
        expect(g.kind === 'deny' && g.reason).toContain(BEAST_HATCH)
      }
    }
  })
})

describe('waking Beast Watch', () => {
  test('pi-dispatch, pi-implementer, llama-server or anything naming the host wakes it; other work does not', () => {
    const host = '192.168.86.55'
    for (const line of [
      'python3 pi-dispatch.py ledger',
      '~/.claude/x/pi-implementer --check',
      'ssh -o BatchMode=yes 192.168.86.55 nvidia-smi',
      'curl -s http://192.168.86.55:8080/health',
      './llama-server -m model.gguf',
    ]) {
      expect(isBeastUse(line, host)).toBe(true)
    }
    for (const line of ['go test ./...', 'ssh 192.168.86.5 ls', 'kubectl get pods']) expect(isBeastUse(line, host)).toBe(false)
    expect(isBeastUse('python3 pi-dispatch.py ledger', undefined)).toBe(true)
  })
})

describe("what Beast's probes answer", () => {
  test('/health is the status code curl wrote last, with the body before it; nothing is 0', () => {
    expect(healthOf('{"status":"ok"}\n200')).toEqual({ code: 200, body: '{"status":"ok"}' })
    expect(healthOf('\n000')).toEqual({ code: 0, body: '' })
    expect(healthOf('')).toEqual({ code: 0, body: '' })
  })

  test('a slot generating makes llama-server busy; the API key comes from the env file', () => {
    expect(isBusy('[{"id":0,"is_processing":true}]')).toBe(true)
    expect(isBusy('[{"id":0,"is_processing": false}]')).toBe(false)
    expect(llamaKeyOf('LLAMA_URL=x\nexport LLAMA_API_KEY="sk-1"\n')).toBe('sk-1')
    expect(llamaKeyOf('LLAMA_URL=x\n')).toBeUndefined()
  })
})

describe("a router's models", () => {
  const MODELS = JSON.stringify({
    data: [
      { id: 'qwen-a', status: { value: 'unloaded' } },
      { id: 'qwen-blend', status: { value: 'loaded', args: [] } },
      { id: 'qwen-b', status: { value: 'loading' } },
    ],
  })

  test("the Dispatches' model is named in pi-implementer's env and its state read off /v1/models", () => {
    expect(modelAliasOf('MODEL_ALIAS=qwen-blend\nCTX_SIZE=1\n')).toBe('qwen-blend')
    expect(modelAliasOf('CTX_SIZE=1\n')).toBeUndefined()
    expect(modelStateOf(MODELS, 'qwen-blend')).toBe('loaded')
    expect(modelStateOf(MODELS, 'qwen-b')).toBe('loading')
    expect(modelStateOf(MODELS, 'qwen-a')).toBe('unloaded')
    expect(modelStateOf(MODELS, 'nope')).toBe('missing')
  })

  test('a server that is no router, or no answer, says nothing of the model', () => {
    expect(modelStateOf(JSON.stringify({ data: [{ id: 'm.gguf' }] }), 'm.gguf')).toBeUndefined()
    expect(modelStateOf('{"error":{"code":401}}', 'qwen-blend')).toBeUndefined()
    expect(modelStateOf('', 'qwen-blend')).toBeUndefined()
    expect(modelStateOf(MODELS, undefined)).toBeUndefined()
  })
})
