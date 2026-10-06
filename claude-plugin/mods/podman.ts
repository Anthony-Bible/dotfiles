// The Podman Guard's pure half: which Bash commands run Docker, what they become under podman, and which
// ones podman cannot stand in for. No `$` here.

export type Guarded =
  | { kind: 'pass' }
  | { kind: 'rewrite'; command: string }
  | { kind: 'deny'; reason: string }

/** The Docker Escape Hatch: an assignment of it anywhere in the line leaves the whole line alone. */
export const ESCAPE_HATCH = 'DOCKER_OK=1'

/** Daemon-Only Commands: subcommands that need a real Docker daemon or Docker's own services. */
export const DAEMON_ONLY = ['context', 'swarm', 'service', 'stack', 'node', 'plugin', 'trust', 'scout'] as const

/** Words that run the next word as a command, so a `docker` after them is still in command position. */
const WRAPPERS = new Set(['sudo', 'env', 'time', 'nohup', 'exec', 'command', 'xargs', 'watch'])
/** A wrapper's flags that take the next word as their value, as in `sudo -u root docker`. */
const WRAPPER_VALUE_FLAGS: Record<string, ReadonlySet<string>> = {
  sudo: new Set([
    ...['-u', '-g', '-C', '-D', '-h', '-p', '-r', '-R', '-t', '-T', '-U'],
    ...['--user', '--group', '--close-from', '--chdir', '--host', '--prompt', '--role', '--chroot', '--type'],
    ...['--command-timeout', '--other-user'],
  ]),
  env: new Set(['-u', '-C', '-S', '--unset', '--chdir', '--split-string']),
  time: new Set(['-f', '-o', '--format', '--output']),
  xargs: new Set([
    ...['-I', '-L', '-n', '-P', '-d', '-E', '-s', '-a'],
    ...['--max-lines', '--max-args', '--max-procs', '--delimiter', '--max-chars', '--arg-file', '--process-slot-var'],
  ]),
  // `watch -d` takes its optional value attached (`-d=permanent`), never as the next word.
  watch: new Set(['-n', '--interval']),
}
/** Docker's global options that take the next word as their value, ahead of the subcommand. */
/** The options whose value mounts or dials a daemon socket, as in `-v /var/run/docker.sock:/s` or `-H unix://...`. */
const SOCKET_FLAGS = new Set(['-v', '--volume', '--mount', '-H', '--host'])
const DOCKER_VALUE_FLAGS = new Set(['--config', '-c', '--context', '-H', '--host', '-l', '--log-level', '--tlscacert', '--tlscert', '--tlskey'])
/** Shell keywords and reserved words after which the next word is a command, as in `if docker ps; then ...`. */
const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'while', 'until', 'do', '!', '{'])
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

/** `startsCommand`: the word begins a new simple command of the chain (after `;`, `&`, `|` or a newline). */
type Word = { text: string; start: number; end: number; isCommand: boolean; startsCommand: boolean }

/**
 * The line's words outside quotes, each marked when it sits where the shell runs a command: at the start, after
 * `;`, `&`, `|`, a newline, `(`, `$(` or a backtick, and after leading assignments, shell keywords (`if`, `do`,
 * `!`, ...) and wrappers like `sudo`.
 * A quoted part stays inside its word, so `echo "docker run"` holds no `docker` word.
 */
export const words = (line: string): Word[] => {
  const out: Word[] = []
  let quote: '"' | "'" | undefined
  let start = -1
  let text = ''
  let expectsCommand = true
  let startsCommand = true
  /** The wrapper whose flags are being read, and whether the word now is one flag's value. */
  let wrapper: string | undefined
  let expectsValue = false
  let inBacktick = false
  const end = (at: number) => {
    if (start < 0) return
    const isCommand = expectsCommand && !expectsValue
    out.push({ text, start, end: at, isCommand, startsCommand })
    startsCommand = false
    if (expectsValue) expectsValue = false
    else if (isCommand) {
      const isWrapper = WRAPPERS.has(text)
      const isWrapperFlag = wrapper !== undefined && text.startsWith('-')
      expectsValue = isWrapperFlag && (WRAPPER_VALUE_FLAGS[wrapper as string]?.has(text) ?? false)
      wrapper = isWrapper ? text : isWrapperFlag ? wrapper : undefined
      expectsCommand = ASSIGNMENT.test(text) || KEYWORDS.has(text) || isWrapper || isWrapperFlag
    }
    start = -1
    text = ''
  }
  for (let i = 0; i < line.length; i++) {
    const c = line[i] as string
    if (quote) {
      if (c === '\\' && quote === '"') i++
      else if (c === quote) quote = undefined
      continue
    }
    if (c === '\\') {
      if (start < 0) start = i
      text += line[i + 1] ?? ''
      i++
    } else if (c === '"' || c === "'") {
      if (start < 0) start = i
      text += '\0' // a quoted part: the word is never a bare name
      quote = c
    } else if (c === ' ' || c === '\t') {
      end(i)
    } else if (';&|\n()`'.includes(c) || (c === '$' && line[i + 1] === '(')) {
      end(i)
      if (c === '$') i++
      // A backtick opens a substitution or closes one; only the opening one starts a command.
      if (c === '`') inBacktick = !inBacktick
      expectsCommand = c === '`' ? inBacktick : c !== ')'
      startsCommand = ';&|\n'.includes(c)
      wrapper = undefined
      expectsValue = false
    } else {
      if (start < 0) start = i
      text += c
    }
  }
  end(line.length)
  return out
}

/** The Escape Hatch as an assignment: before a command (`DOCKER_OK=1 docker ...`) or exported; never an argument. */
const hasHatch = (ws: readonly Word[]): boolean =>
  ws.some((w, i) => w.text === ESCAPE_HATCH && (w.isCommand || (ws[i - 1]?.isCommand === true && ws[i - 1]?.text === 'export')))

/** The option a word sets with its value attached, `--volume=...` or `-v/var/...`; undefined for anything else. */
const attachedFlag = (text: string): string | undefined =>
  text.startsWith('--') ? (text.includes('=') ? text.slice(0, text.indexOf('=')) : undefined) : text.startsWith('-') && text.length > 2 ? text.slice(0, 2) : undefined

/**
 * What the guard does with a Bash line: pass it when it runs no Docker or carries the Escape Hatch, deny a
 * Daemon-Only Command or a docker.sock mount, and otherwise rewrite each `docker` to `podman` and each
 * `docker-compose` to `podman compose`, leaving every other byte as it was.
 */
export const guard = (line: string): Guarded => {
  const ws = words(line)
  const dockers = ws
    .map((w, i) => ({ w, args: argsOf(ws, i) }))
    .filter(({ w }) => w.isCommand && (w.text === 'docker' || w.text === 'docker-compose'))
  if (dockers.length === 0 || hasHatch(ws)) return { kind: 'pass' }

  const daemonOnly = dockers
    .filter(({ w }) => w.text === 'docker')
    .map(({ args }) => subcommandOf(args))
    .find(sub => sub !== undefined && (DAEMON_ONLY as readonly string[]).includes(sub))
  const mountsSocket = dockers.some(({ args }) =>
    args.some(
      (a, k) =>
        line.slice(a.start, a.end).includes('docker.sock') &&
        (SOCKET_FLAGS.has(args[k - 1]?.text ?? '') || SOCKET_FLAGS.has(attachedFlag(a.text) ?? '')),
    ),
  )
  if (daemonOnly || mountsSocket) {
    const what = daemonOnly ? `\`docker ${daemonOnly}\`` : 'a docker.sock mount'
    return {
      kind: 'deny',
      reason:
        `Podman Guard: ${what} needs the Docker daemon, which podman cannot stand in for. ` +
        `Use podman's own way, or prefix the command with ${ESCAPE_HATCH} if real Docker is required.`,
    }
  }

  let command = line
  for (const { w } of [...dockers].reverse()) {
    const to = w.text === 'docker' ? 'podman' : 'podman compose'
    command = command.slice(0, w.start) + to + command.slice(w.end)
  }
  return { kind: 'rewrite', command }
}

/** The words after the command at `i`, up to the next command of the chain; a `$(...)` inside stays in. */
const argsOf = (ws: readonly Word[], i: number): Word[] => {
  const rest = ws.slice(i + 1)
  const next = rest.findIndex(w => w.startsCommand)
  return next < 0 ? rest : rest.slice(0, next)
}

/** Docker's subcommand: the first argument past its global options and their values. */
const subcommandOf = (args: readonly Word[]): string | undefined => {
  for (let i = 0; i < args.length; i++) {
    const t = (args[i] as Word).text
    if (!t.startsWith('-')) return t
    if (DOCKER_VALUE_FLAGS.has(t)) i++
  }
  return undefined
}

/** The note the model reads after a rewritten command's result. */
export const rewriteNote = (from: string, to: string): string =>
  `[Podman Guard: this ran as \`${to}\`, not \`${from}\`. Output and errors are podman's. ` +
  `Prefix ${ESCAPE_HATCH} only when real Docker is required.]`
