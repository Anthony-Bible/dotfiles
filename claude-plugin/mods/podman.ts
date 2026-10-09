// The Podman Guard's pure half: which Bash commands run Docker, what they become under podman, and which
// ones podman cannot stand in for. No `$` here.

import { argsOf, attachedFlag, hasAssignment, words, type Word } from './shell'

export type Guarded =
  | { kind: 'pass' }
  | { kind: 'rewrite'; command: string }
  | { kind: 'deny'; reason: string }

/** The Docker Escape Hatch: an assignment of it anywhere in the line leaves the whole line alone. */
export const ESCAPE_HATCH = 'DOCKER_OK=1'

/** Daemon-Only Commands: subcommands that need a real Docker daemon or Docker's own services. */
export const DAEMON_ONLY = ['context', 'swarm', 'service', 'stack', 'node', 'plugin', 'trust', 'scout'] as const

/** The options whose value mounts or dials a daemon socket, as in `-v /var/run/docker.sock:/s` or `-H unix://...`. */
const SOCKET_FLAGS = new Set(['-v', '--volume', '--mount', '-H', '--host'])
/** Docker's global options that take the next word as their value, ahead of the subcommand. */
const DOCKER_VALUE_FLAGS = new Set(['--config', '-c', '--context', '-H', '--host', '-l', '--log-level', '--tlscacert', '--tlscert', '--tlskey'])

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
  if (dockers.length === 0 || hasAssignment(ws, ESCAPE_HATCH)) return { kind: 'pass' }

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
