// Beast Watch's pure half: where Beast is, what a look at it says (the Beast State), which Bash lines wake the
// watch or start a Dispatch, and what the Beast Guard does with one. No `$` here.

import { argsOf, hasAssignment, words } from './shell'

export type BeastState = 'up' | 'loading' | 'down'

export type Reading = { state: BeastState; reason?: string; vram?: { usedMb: number; totalMb: number } }

/** What one look gathered: llama-server's /health, nvidia-smi over ssh, and the one-token completion probe. */
export type Probe = {
  /** `code` 0 when nothing answered. */
  health: { code: number; body: string }
  smi: { exitCode: number; stdout: string; stderr: string }
  /** The Dispatches' model on a router (llama-server serving models by name); absent when it says nothing. */
  model?: ModelState
  /** `skipped` while a Dispatch runs (it would queue behind it); absent when not tried. */
  completion?: 'ok' | 'timeout' | 'error' | 'skipped'
}

export type ModelState = 'loaded' | 'loading' | 'unloaded' | 'failed' | 'missing'

/** The Beast Escape Hatch: an assignment of it anywhere in the line leaves the whole line alone. */
export const BEAST_HATCH = 'BEAST_OK=1'

/** Beast's llama-server, from pi-implementer's env file, without a trailing slash. */
export const llamaUrlOf = (envText: string): string | undefined => {
  const m = envText.match(/^\s*(?:export\s+)?LLAMA_URL\s*=\s*["']?([^"'\s]+)/m)
  return m ? m[1]!.replace(/\/+$/, '') : undefined
}

export const hostOf = (url: string): string | undefined => url.match(/^[a-z]+:\/\/(?:[^@/]*@)?([^:/]+)/i)?.[1]

/** nvidia-smi's query of memory per GPU (`used, total` in MiB, one line each). */
export const SMI_QUERY = 'nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits'

const vramOf = (stdout: string): Reading['vram'] => {
  const rows = stdout
    .split('\n')
    .map(l => l.split(',').map(x => Number(x.trim())))
    .filter(r => r.length === 2 && r.every(Number.isFinite))
  if (rows.length === 0) return undefined
  return { usedMb: rows.reduce((s, r) => s + r[0]!, 0), totalMb: rows.reduce((s, r) => s + r[1]!, 0) }
}

/** The Beast State a look gives. The GPU outranks llama-server, which outranks the completion probe. */
export const judge = (p: Probe): Reading => {
  if (p.smi.exitCode === 255) return { state: 'down', reason: 'ssh unreachable' }
  if (p.smi.exitCode !== 0) {
    const isLost = /GPU is lost|Unable to determine the device handle|NVIDIA-SMI has failed/i.test(p.smi.stdout + p.smi.stderr)
    return { state: 'down', reason: isLost ? 'GPU lost' : 'nvidia-smi failed' }
  }
  const vram = vramOf(p.smi.stdout)
  if (!vram) return { state: 'down', reason: 'no GPU' }
  if (p.health.code === 0) return { state: 'down', reason: 'llama-server unreachable' }
  if (p.health.code === 503 && /loading/i.test(p.health.body)) return { state: 'loading' }
  if (p.health.code !== 200) return { state: 'down', reason: `health ${p.health.code}` }
  if (p.model === 'loading') return { state: 'loading' }
  if (p.model === 'missing') return { state: 'down', reason: 'model not served' }
  if (p.model === 'failed') return { state: 'down', reason: 'model failed to load' }
  if (p.completion === 'timeout') return { state: 'down', reason: 'wedged' }
  return { state: 'up', vram }
}

const gb = (mb: number): number => Math.round(mb / 1024)

export const beastSegment = (r: Reading): string =>
  r.state === 'up'
    ? `beast 🟢${r.vram ? ` ${gb(r.vram.usedMb)}/${gb(r.vram.totalMb)}GB` : ''}`
    : r.state === 'loading'
      ? 'beast ⏳ loading'
      : `beast 🔴 ${r.reason ?? 'down'}`

/** What a new reading is worth telling: Beast going Down, or coming back Up from Down. */
export const transition = (before: Reading | undefined, after: Reading): 'down' | 'recovered' | undefined =>
  after.state === 'down' && before?.state !== 'down'
    ? 'down'
    : before?.state === 'down' && after.state === 'up'
      ? 'recovered'
      : undefined

// ---------------------------------------------------------------------------------------- Bash lines

const PI_DISPATCH = /(?:^|\/)pi-dispatch(?:\.py)?$/

/** The line starts a Dispatch: `pi-dispatch.py dispatch`, however the script is run. */
export const isDispatch = (line: string): boolean => {
  const ws = words(line)
  return ws.some((w, i) => {
    if (!w.isCommand) return false
    const run = [w, ...argsOf(ws, i)]
    const k = run.findIndex(x => PI_DISPATCH.test(x.text))
    return k >= 0 && run[k + 1]?.text === 'dispatch'
  })
}

/** The line uses Beast: pi-implementer's tools, llama-server, or anything naming Beast's host. */
export const isBeastUse = (line: string, host: string | undefined): boolean => {
  if (words(line).some(w => /(?:^|\/)(?:pi-dispatch(?:\.py)?|pi-implementer|llama-server)$/.test(w.text))) return true
  if (!host) return false
  const escaped = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[^\\w.-])${escaped}(?![\\w.-]*\\w)`).test(line)
}

export type BeastJudged = { kind: 'pass' } | { kind: 'wait' } | { kind: 'deny'; reason: string }

/** The line is a Dispatch without the Escape Hatch: the Beast Guard needs a fresh look at Beast to judge it. */
export const isGuarded = (line: string): boolean => isDispatch(line) && !hasAssignment(words(line), BEAST_HATCH)

/** The Beast Guard: a Dispatch while Down is refused, while Loading it waits; the Escape Hatch passes it. */
export const beastGuard = (line: string, r: Reading): BeastJudged => {
  if (!isGuarded(line) || r.state === 'up') return { kind: 'pass' }
  if (r.state === 'loading') return { kind: 'wait' }
  return {
    kind: 'deny',
    reason:
      `Beast Guard: Beast is Down (${r.reason ?? 'unknown'}), so this Dispatch would burn its whole timeout. ` +
      `Bring Beast back (/beast checks it), or prefix the line with ${BEAST_HATCH} to dispatch anyway.`,
  }
}

export const LOADING_WAIT_MS = 180_000

/** The API key pi-implementer sends llama-server, from the same env file. */
export const llamaKeyOf = (envText: string): string | undefined =>
  envText.match(/^\s*(?:export\s+)?LLAMA_API_KEY\s*=\s*["']?([^"'\s]+)/m)?.[1]

/** `curl -w '\n%{http_code}'` output as /health's answer: code 0 when nothing answered. */
export const healthOf = (stdout: string): Probe['health'] => {
  const cut = stdout.lastIndexOf('\n')
  const code = Number(stdout.slice(cut + 1).trim())
  return { code: Number.isFinite(code) ? code : 0, body: cut < 0 ? '' : stdout.slice(0, cut) }
}

/** llama-server's /slots answer says a slot is generating: a completion probe would queue behind it. */
export const isBusy = (slotsJson: string): boolean => /"is_processing"\s*:\s*true/.test(slotsJson)

/** The model pi-implementer dispatches to, by the name a router serves it under. */
export const modelAliasOf = (envText: string): string | undefined =>
  envText.match(/^\s*(?:export\s+)?MODEL_ALIAS\s*=\s*["']?([^"'\s]+)/m)?.[1]

/** The model's state in a router's /v1/models; undefined when the server is no router or did not answer. */
export const modelStateOf = (modelsJson: string, alias: string | undefined): ModelState | undefined => {
  if (!alias) return undefined
  let d: { data?: { id?: string; status?: { value?: string } }[] }
  try {
    d = JSON.parse(modelsJson)
  } catch {
    return undefined
  }
  const models = Array.isArray(d?.data) ? d.data : undefined
  if (!models || !models.some(m => m.status)) return undefined
  const v = models.find(m => m.id === alias)?.status?.value
  if (v === undefined) return 'missing'
  return v === 'loaded' || v === 'loading' || v === 'unloaded' ? v : 'failed'
}
