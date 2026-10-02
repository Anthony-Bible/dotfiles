---
name: pi-implementer
description: Hybrid implementation — this Claude Code session scopes and writes one-file Tickets (Orchestrator), a local model on llama-server implements each one through pi + pi-vcc in a fresh session (Implementer), and this session gates every result with the toolchain, a diff review and one commit per accepted Ticket. Use when the user says "implement with pi", "hybrid", "local implementer", "dispatch to the local model", or wants a feature built by the local model under cloud supervision.
---

# pi-implementer: Orchestrator playbook

You are the **Orchestrator**. You never write implementation code. You scope, cut Tickets, Dispatch them
to the **Implementer** (pi + pi-vcc on the local model), run the **Gate**, commit what passes, and keep
the **Ledger**. The Implementer is a ~27B model in a ~44K context that sees only the Ticket and the disk:
it is fast and exact on a settled design and slow and wrong on an open one, so the work of this skill is
in the Ticket, not in the Dispatch. Several Dispatches can run at once, each in its own **Worktree** (a git
worktree of the run branch, outside the repo); an accepted Worktree is **Landed**: its commits are
cherry-picked onto the run branch.

Paths below are relative to this skill's base directory (shown when the skill was invoked); the two
programs are `scripts/pi-implementer` (the pi launcher + setup/check) and `scripts/pi-dispatch.py` (init,
dispatch, land, drop, clean, ledger). Read `references/TICKET-FORMAT.md` before writing the first Ticket, every time.

## 0. Preflight

```
scripts/pi-implementer --check
```
Exit 0 means pi, pi-vcc, the config (`~/.config/pi-implementer/env`: `LLAMA_URL`, `LLAMA_API_KEY`,
`MODEL_ALIAS`, `CTX_SIZE`, `MAX_DISPATCHES`) and the llama-server `/health` are all there. Otherwise tell the user what is
missing and, for pi-vcc or a missing config, give them the absolute path to run themselves —
`! <base directory>/scripts/pi-implementer --setup` from the Claude Code prompt works — because
`--setup` prompts for the Server URL, API key, model alias, Dispatches at once and context size when the config file is
absent (it never installs Node; without a terminal it prints the five lines to write by hand). If pi
itself is missing, the message prints the `nvm`/`npm` line — do not install it yourself. Do not proceed
until `--check` is clean.

## 1. Scope

If the scope is not already settled (a spec, or a CONTEXT.md and a clear request), run
`/grill-with-docs` first. Then write, for yourself, the plan as an ordered list of file-sized Ticket
parts with their dependencies. Decide the design here — signatures, data shapes, error strings, file
layout, the test list — because anything left undecided gets decided by the Implementer, slowly.

## 2. Initialise the run

```
scripts/pi-dispatch.py init --branch hybrid/<slug>
```
This creates `.hybrid/{tickets,logs,pi-sessions}`, `.hybrid/ledger.md`, appends `.hybrid/` to
`.git/info/exclude` (no tracked change), and creates or switches to the branch. Everything the run
produces besides the code lives under `.hybrid/`; it is never committed. The Worktrees live under
`~/.cache/pi-implementer/worktrees/` (the line printed names the directory), never inside the repo, so
no build or test run in the repo picks up their copies of the source.

## 3. Tickets

Write each Ticket to `.hybrid/tickets/NN-<slug>.md` in the format of `references/TICKET-FORMAT.md`: one file's
worth of work, every fact verbatim, exact paths, "read once then edit", a Verify block that ends with
`DONE` or the mismatching lines, and a Do-not list. Tests go in their own Tickets of at most three tests
per `write`. Include the repository's conventions the Implementer must follow (logger, error wrapping,
formatter, test style) in the Ticket itself: the Implementer runs with `--no-context-files`, so it never
sees CLAUDE.md or `.pi/` files.

## 4. Dispatch

```
scripts/pi-dispatch.py dispatch .hybrid/tickets/NN-<slug>.md --max-turns 40 --timeout 1200
```
Each Dispatch claims the next number, creates its Worktree from the run branch's current HEAD (branch
`<run branch>--NN-<slug>`), copies the Ticket to the Worktree's `.hybrid/TICKET.md`, and runs pi there,
pointed at it (so the Implementer can re-read it after a compaction): `-p --mode json --no-context-files
--no-skills --no-prompt-templates --no-approve`, its session under `.hybrid/pi-sessions`, the event stream
to `.hybrid/logs/NN-<slug>.jsonl` in the main checkout. The caps are 40 API calls / 20 minutes per
Dispatch (sized for a Go file plus its verify; lower them for tiny edit Tickets). A cap hit fails the
*Dispatch*, not the Ticket: whatever is in the Worktree goes through the Gate like any other result.

**Parallel.** Up to `MAX_DISPATCHES` (the config; one per Server slot, so the Server's KV pool divided
by it is each Dispatch's `CTX_SIZE`) run at once; one more is refused with exit 2 and never queues.
Dispatch together only Tickets that are **ready**: every Ticket they depend on is already Landed, so
each Worktree starts from a HEAD that contains what it needs. A Ticket whose parent is still running or
in its Gate waits. Prefer ready Tickets that touch different files; two that edit the same file will
conflict on Landing.

Start each one through the Bash tool with `run_in_background` (its `--timeout` is over the tool's
10-minute cap) and wait for the completion notice; never poll. When one finishes, Gate it while the
others keep running, and start the next ready Ticket as soon as a slot is free. One Gate at a time:
the Gate is you.

Read the printed result line (the Implementer's last message: `DONE`, or the mismatching lines), the
metrics line and the `worktree:` line before anything else. `length_stops > 0` or `compaction_errors > 0`
means the Ticket was too big for the context: re-cut before re-Dispatching.

## 5. Gate (every Dispatch, no exceptions), then Land

Everything in steps 1–4 happens **in the Worktree** (`cd` to the printed path, or `git -C <path>`), not
in the main checkout.

1. **The Verify answer.** `DONE` is a claim, not a result.
2. **The toolchain**, yourself: build, vet/lint, the full test suite (`-race` for Go), from a clean
   state. Any repo check the project has (`make test`, `npm test`, a Contract script) runs here. A fresh
   Worktree has no `node_modules`, virtualenv or build output of its own: install what the check needs.
3. **`git status` and `git diff`.** Anything touched outside the Ticket's file list is reverted
   (`git checkout -- <path>`; `rm` for new files) and noted in the Ledger. Leftover `.venv`, `node_modules`,
   databases or logs from the Verify block are deleted.
4. **Diff review**, against the Ticket and the repo's conventions: is it what the Ticket meant, would a
   reviewer merge it, does it log with the right logger, wrap errors, propagate contexts, guard shared
   state, avoid dead code, test the contract not the implementation. For a service, probe it yourself
   (curl, a headless browser, a client) for behaviour the tests cannot see.

Accepted → in the Worktree, `git add <the Ticket's files> && git commit -m "<ticket NN>: <what>"` — one
commit per accepted Ticket, never `git add -A`, never push. Then, from the main checkout:

```
scripts/pi-dispatch.py land NN
```
It cherry-picks the Worktree's commits onto the run branch and removes the Worktree. Then **run the
toolchain on the run branch** (step 2 again, in the main checkout): each Gate saw its Ticket alone, and
this is the only place the combination is tested. If it fails, `git reset --hard HEAD~<k>` (the
printed count) and treat it as a conflict.

**Conflict** (`land` exits 3; it has aborted the pick and the run branch is unchanged) → `pi-dispatch.py
drop NN` and Dispatch the same Ticket again; its new Worktree starts from the current HEAD. Record it as
`rebase` in the Ledger. It does not count as a re-Dispatch: the Implementer did nothing wrong.

Not accepted → `pi-dispatch.py drop NN`, write the re-Dispatch Ticket (`NN-<slug>-r<k>.md`, one concrete
finding at a time: `file:line` + the edit, or request/expected/actual + the traceback; never a transcript)
and Dispatch it. At most two re-Dispatches per file-sized Ticket part; after that, re-cut the Ticket or
take the file over yourself and say so in the Ledger. Never "fix it quickly" in a Ticket you have already
Dispatched: the Implementer is the implementer.

## 6. Ledger and report

After every Gate, append to `.hybrid/ledger.md`: the Dispatch row (`scripts/pi-dispatch.py ledger` prints
the table from `.hybrid/dispatches.jsonl`) and a short paragraph: what the Gate found, what was reverted,
what the re-Dispatch carries, the commit hash. At the end, report to the user: Tickets cut, Dispatches
run, wall time per Dispatch, cap hits, re-Dispatch count, what the Gate caught that the tests did not,
the commits on the branch, and anything you took over yourself. Run `scripts/pi-dispatch.py clean` to
drop leftover Worktrees, then leave the branch unpushed and `.hybrid/` in place; the user decides what
happens next.

## Rules

- The Orchestrator never writes implementation code. It writes Tickets, runs checks, reads diffs,
  writes findings, and commits. Probes and throwaway checks are fine and are deleted before commit.
- At most `MAX_DISPATCHES` at once, only ready Tickets, one Gate at a time; nothing lands on the run
  branch except through `land`. One file per Ticket. Every fact verbatim. Read the log
  (`.hybrid/logs/NN-*.jsonl`, `tool_execution_start` events and the assistant `text` blocks) when a
  Dispatch did something you did not expect — the answer to "why did it take 700 s" is always there.
- Do not touch `~/.pi`, the user's shell PATH, or the Node the pi launcher picks: `scripts/pi-implementer`
  runs pi under its own Node explicitly and leaves the Implementer's shell with the machine's default
  toolchain. That is deliberate (a native module built under the wrong Node once broke a whole run).
- If the Server is unreachable mid-run, stop and tell the user; do not retry Dispatches blind.
