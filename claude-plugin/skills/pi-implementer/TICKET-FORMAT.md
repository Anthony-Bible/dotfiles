# Ticket format

A Ticket is the whole world of one Dispatch: the Implementer (a ~27B local Model in a 64K context, through
pi with the pi-vcc extension and the tools `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`) sees this
file, the repository on disk, and nothing else — no conversation, no earlier Tickets, no CLAUDE.md, no
skills, nobody to ask. Every fact it would otherwise go and look up costs a tool call and context; every
decision left open costs thinking tokens, and thinking is what blows the context and the output cap.
The fastest Dispatches on record (51 s, 0.5K thinking tokens) were the ones with nothing left to decide.

## Size

- **One file per Ticket** (a new file, or one file's worth of edits; two files only when the second is a
  one-line call-site change). A ticket that needs several files is several Tickets, in dependency order.
- Split test files so that **one `write` holds at most three tests**. A 500-line Write after a long think
  arrives as truncated JSON when the thinking has eaten the output budget.
- Under ~6K characters of Ticket. Longer means the Ticket is doing two things.

## Skeleton (use these headings, in this order)

```markdown
# Ticket <NN>: <what changes, in one line> (<one new file | two small edits in x.go>)

<Two to four sentences: the repo/module name, what exists that this Ticket builds on, what this Ticket
adds. State the language, module path, and toolchain versions if they matter.>

## What exists (verbatim — trust it; read only <file>, once)

<Signatures, types, constants, error sentinels, SQL, route strings, JSON shapes — copied from the code,
not paraphrased. Mark them "verbatim" so the Implementer does not re-derive them. If it needs nothing from
disk, say "Do not read any file; everything you need is below.">

## Step 1 (ONE `write`): `<exact/path/from/repo/root.go>`, package `<pkg>`

<The design, settled: the public signature(s) with doc comments, the private helpers by name, the data
shape, the exact error strings and log messages, the order of operations. When the design is already
decided, give the code body verbatim — the Implementer transcribes. Hand over a `write` for a new file
and an `edit` (old text → new text, both quoted exactly) for a change.>

## Step 2 (one `edit`): `<other/file.go>`

Change the one line
```go
<old text, exact>
```
to
```go
<new text, exact>
```

## Verify (run exactly this, then stop)

```bash
<the toolchain's own checks, one command line, output tailed>
```
Expected: <the exact lines or pattern that mean success>. When it passes, reply with the single word
`DONE`. If it does not, paste the mismatching lines and stop — do not start fixing files the Ticket did
not name.

## Do not
- Do not touch any file other than <list>. Do not add files.
- Do not read `.hybrid/TICKET.md` or <file> a second time. The strings above are exact.
- Do not start the server / run the app <unless the Verify block does>.
- Do not create a virtualenv, `npm install`, or add dependencies <unless the Ticket says so>.
```

## Rules that came from failures

- **Exact paths from the repo root, always.** A brief that said "package `beast_bakery/`" and then listed
  bare filenames cost six reads of paths that did not exist.
- **Put every fact in the Ticket, verbatim.** A Ticket that dropped the POST body shape grepped five
  times; the same Ticket with it explored nothing. Signatures, table columns, route strings, error
  messages, fixture values: copy them from the code, quote them, say they are exact.
- **"Read the file once, then edit."** Without it the Implementer re-reads before every edit and
  re-confirms strings the Ticket already quoted (seven tool calls on one Ticket).
- **Edits are old-text → new-text pairs**, both quoted exactly and unique in the file. A list of exact
  edits ran at 61–271 s with under 500 thinking tokens and zero drift; "rewrite the function to…" did not.
- **Never leave the design open.** "Choose a sensible structure" is a 40K-character think and a
  compaction before the first `write`. Decide it in the Ticket.
- **Verify blocks run in a non-interactive shell.** No job control: never `%1`; start a server with
  `./run.sh & SRV=$!`, stop it with `kill -TERM $SRV; wait $SRV`. Name the port and the database file
  the Verify block uses so they cannot collide with anything the Gate runs. Bound every command's
  output (`| tail -8`, `-count=1`, `-x` off).
- **The Verify block ends the Dispatch.** "Reply DONE, else paste the mismatching lines and stop" — the
  Orchestrator reads that reply before the Gate, and a Dispatch that goes on to "fix" other files after a
  failed verify produces diffs nobody asked for.
- **No environment surprises.** The Implementer's shell is the user's: say which Go/Python/Node the repo
  expects, and if the repo has a lint hook or a formatter that rewrites files, tell the Implementer to
  fix only what it wrote and never rewrite a file to satisfy lint elsewhere.
- **A stdlib-only app gets a `run.sh` that does not create a `.venv`.** Say so; the Implementer will
  otherwise ship one and the Gate's diff review sends it back.
- **State ordering when it matters** (write the order first, then clear the cart — a checkout that emptied
  the cart before inserting the order lost the cart on a failed insert).

## Re-Dispatch Tickets (review rounds)

A review round is a Ticket like any other, named `<NN>-<slug>-r<k>.md`, and carries **one concrete
finding at a time** in the Implementer's terms:

- `file:line` and the change, as an old-text → new-text edit where possible;
- for a runtime failure: the request, the expected response, the actual response, and the traceback or
  log line — never the Dispatch transcript, never "the tests fail";
- line numbers from `grep -n`, not from memory — but it is the quoted old text the Implementer matches on,
  so quote it exactly and the line number is only a courtesy;
- the same Verify block as the original Ticket;
- "address exactly this, touch nothing else".

At most two re-Dispatches per file-sized Ticket part. A third failure means the Ticket is wrong, not the
Implementer: re-cut it (smaller, more verbatim), or take the file over yourself and say so in the Ledger.
