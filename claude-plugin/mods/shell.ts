// The shell words a Bash line holds, and which of them sit where the shell runs a command. The guards' shared
// parser. No `$` here.

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
/** Shell keywords and reserved words after which the next word is a command, as in `if docker ps; then ...`. */
const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'while', 'until', 'do', '!', '{'])
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

/** `startsCommand`: the word begins a new simple command of the chain (after `;`, `&`, `|` or a newline). */
export type Word = { text: string; start: number; end: number; isCommand: boolean; startsCommand: boolean }

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

/** An assignment of `text` (`NAME=value`) before a command, as in `NAME=value cmd ...`, or exported; never an argument. */
export const hasAssignment = (ws: readonly Word[], text: string): boolean =>
  ws.some((w, i) => w.text === text && (w.isCommand || (ws[i - 1]?.isCommand === true && ws[i - 1]?.text === 'export')))

/** The option a word sets with its value attached, `--volume=...` or `-v/var/...`; undefined for anything else. */
export const attachedFlag = (text: string): string | undefined =>
  text.startsWith('--') ? (text.includes('=') ? text.slice(0, text.indexOf('=')) : undefined) : text.startsWith('-') && text.length > 2 ? text.slice(0, 2) : undefined

/** The words after the command at `i`, up to the next command of the chain; a `$(...)` inside stays in. */
export const argsOf = (ws: readonly Word[], i: number): Word[] => {
  const rest = ws.slice(i + 1)
  const next = rest.findIndex(w => w.startsCommand)
  return next < 0 ? rest : rest.slice(0, next)
}
