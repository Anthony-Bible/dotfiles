import { describe, expect, test } from 'claude-code/testing'

import { DAEMON_ONLY, ESCAPE_HATCH, guard } from './podman'

// A small seeded generator, so a failing case reproduces.
const rng = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T
const RUNS = 300

// [as written, as podman runs it]
const DOCKER: readonly (readonly [string, string])[] = [
  ['docker run --rm -it alpine sh', 'podman run --rm -it alpine sh'],
  ['docker build -t app .', 'podman build -t app .'],
  ['docker compose up -d', 'podman compose up -d'],
  ['docker-compose -f dev.yml up', 'podman compose -f dev.yml up'],
  ['sudo docker ps -a', 'sudo podman ps -a'],
  ['FOO=1 docker images', 'FOO=1 podman images'],
  ['docker buildx build .', 'podman buildx build .'],
  ['sudo -u root docker ps -a', 'sudo -u root podman ps -a'],
  ['env -u HOME docker info', 'env -u HOME podman info'],
  ['xargs -I {} docker rm {}', 'xargs -I {} podman rm {}'],
  ['sudo --user root docker ps', 'sudo --user root podman ps'],
  ['watch -d docker ps', 'watch -d podman ps'],
  ['docker run -e DOCKER_OK=1 alpine', 'podman run -e DOCKER_OK=1 alpine'],
  ['docker run alpine cat /docs/docker.sock', 'podman run alpine cat /docs/docker.sock'],
  ['if docker ps; then docker ps -a; else docker info; fi', 'if podman ps; then podman ps -a; else podman info; fi'],
  ['while ! docker info; do sleep 1; done', 'while ! podman info; do sleep 1; done'],
  ['until docker ps; do :; done', 'until podman ps; do :; done'],
  ['{ docker ps; }', '{ podman ps; }'],
  ['for i in 1 2; do docker rm $i; done', 'for i in 1 2; do podman rm $i; done'],
]
// Lines that mention docker without running it, and lines that never mention it.
const QUIET = [
  'echo "docker run alpine"',
  "git commit -m 'switch from docker'",
  'grep -r docker .',
  'rg dockerfile',
  'cat Dockerfile',
  'ls -la',
  'go test ./...',
  'mydocker run',
  'sudo -u docker whoami',
  'echo "see the docker.sock docs"',
  'echo `date` docker run',
  'echo if docker run',
]
const SEPARATORS = [' && ', ' || ', '; ', ' | ', '\n']

describe('guard', () => {
  test('a chain is rewritten segment by segment, and the rest of the line is kept byte for byte', () => {
    const r = rng(1)
    for (let i = 0; i < RUNS; i++) {
      const n = 1 + Math.floor(r() * 4)
      const parts = Array.from({ length: n }, () =>
        r() < 0.5 ? pick(r, DOCKER) : ([pick(r, QUIET), undefined] as const),
      )
      if (!parts.some(([, to]) => to)) parts.push(DOCKER[0] as readonly [string, string])
      const seps = parts.map(() => pick(r, SEPARATORS))
      const join = (xs: readonly string[]) => xs.map((x, j) => (j === 0 ? x : seps[j] + x)).join('')
      const g = guard(join(parts.map(([from]) => from)))
      expect(g).toEqual({ kind: 'rewrite', command: join(parts.map(([from, to]) => to ?? from)) })
    }
  })

  test('a rewritten line passes the guard: rewriting is idempotent', () => {
    for (const [from] of DOCKER) {
      const g = guard(from)
      expect(g.kind).toBe('rewrite')
      if (g.kind === 'rewrite') expect(guard(g.command)).toEqual({ kind: 'pass' })
    }
  })

  test('a line that runs no docker passes untouched', () => {
    for (const line of QUIET) expect(guard(line)).toEqual({ kind: 'pass' })
  })

  test('the Escape Hatch passes any docker line, Daemon-Only ones included', () => {
    const r = rng(2)
    for (let i = 0; i < RUNS; i++) {
      const line = r() < 0.5 ? pick(r, DOCKER)[0] : `docker ${pick(r, DAEMON_ONLY)} ls`
      expect(guard(`${ESCAPE_HATCH} ${line}`)).toEqual({ kind: 'pass' })
    }
  })

  test('a Daemon-Only Command or a docker.sock mount is denied, naming the Escape Hatch', () => {
    const lines = [
      ...DAEMON_ONLY.map(sub => `docker ${sub} ls`),
      'docker run -v /var/run/docker.sock:/var/run/docker.sock alpine',
      'ls && docker context use remote',
      'docker --config /tmp/cfg context ls',
      'docker -l debug swarm init',
      'docker --log-level=debug stack ls',
      'docker run -v "/var/run/docker.sock:/s" alpine',
      'docker run -v $(pwd):/w -v /var/run/docker.sock:/s alpine',
      'docker run --volume=/var/run/docker.sock:/s alpine',
      'docker run --mount type=bind,src=/var/run/docker.sock,dst=/s alpine',
      'docker -H unix:///var/run/docker.sock ps',
      'if docker context ls; then :; fi',
      '! docker swarm init',
    ]
    for (const line of lines) {
      const g = guard(line)
      expect(g.kind).toBe('deny')
      if (g.kind === 'deny') expect(g.reason).toContain(ESCAPE_HATCH)
    }
  })

  test('docker inside a command substitution is still a command', () => {
    expect(guard('echo $(docker ps -q)')).toEqual({ kind: 'rewrite', command: 'echo $(podman ps -q)' })
    expect(guard('echo `docker ps -q`')).toEqual({ kind: 'rewrite', command: 'echo `podman ps -q`' })
  })

  test('the Escape Hatch counts only as an assignment, before the command or exported', () => {
    for (const line of ['DOCKER_OK=1 docker context ls', 'export DOCKER_OK=1; docker context ls', 'sudo DOCKER_OK=1 docker swarm init'])
      expect(guard(line)).toEqual({ kind: 'pass' })
    expect(guard('docker context ls -e DOCKER_OK=1').kind).toBe('deny')
  })
})
