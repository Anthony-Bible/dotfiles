---
name: consensus-review
description: Three-round consensus code review. Each round runs three read-only reviewer subagents (Security, Optimizer/Cleaner, Bug Hunter) against the same frozen Diff, and the user sees only medium+ Findings that a majority of rounds found independently, which filters out one-off nitpicks and the endless fix-and-refind loop. A high/critical Finding only one round caught gets checked by an independent Verifier instead of being dropped. Use when the user asks for a "consensus review", "three-round review" or "thorough multi-agent review" of a diff, branch, PR/MR or path. Report first, then offer to fix.
argument-hint: "[branch | PR/MR number | path ...] (default: uncommitted diff, else branch vs default branch)"
---

# consensus-review

You are the **Orchestrator**. You freeze one **Review Target**, run **3 Rounds** of **3 Lenses** each
(9 reviewer subagents in total), cluster what they report into **Findings**, and show the user only the
Findings that survive the **Vote**. Reviewers never edit anything. You don't fix anything until the user
says so.

User input: $ARGUMENTS

## 1. Freeze the Review Target

Resolve the target from `$ARGUMENTS` and write it to `<scratchpad>/consensus-review/target.diff`, so all
nine reviewers judge exactly the same bytes even if the working tree changes partway through.

| `$ARGUMENTS` | Command |
|---|---|
| empty, tree dirty | `git diff HEAD` (staged and unstaged). Also list untracked files with `git ls-files --others --exclude-standard` and include them via `git diff --no-index /dev/null <file>` |
| empty, tree clean | `git diff $(git merge-base HEAD <default branch>)...HEAD`. Get the default branch from `git symbolic-ref refs/remotes/origin/HEAD`, falling back to `main` |
| branch name | `git diff $(git merge-base HEAD <branch>)...HEAD` |
| PR/MR number or URL | `gh pr diff <n>` for GitHub remotes, `glab mr diff <n>` for GitLab remotes (e.g. git.tcncloud.net) |
| file or directory paths | Not a diff: write the path list to `target.paths`. Reviewers review those files whole |

Drop lockfiles, generated code (`*.pb.go`, `*_gen.go`, `vendor/`, `dist/`) and binaries from the diff.
If nothing is left, tell the user there's nothing to review and stop. Also write one line of **Intent**
(what the change is for), taken from the commit messages, the PR/MR description or the conversation.
Reviewers judge correctness against it.

## 2. Run the Rounds

Launch all **9** reviewers **in a single message** with the Agent tool (`subagent_type: general-purpose`)
so they run in parallel. A Round is a set of three independent Lens reviews; Rounds never see each
other's output, which is what makes the Vote meaningful. Label each one `r<round>-<lens>` (e.g.
`r2-security`).

Every reviewer prompt is the **shared preamble** below, followed by its Lens brief. The three Rounds use
identical prompts, so any disagreement comes from independent sampling and not from different
instructions.

### Shared preamble

```
You are a code reviewer in an independent review panel. Other reviewers are looking at the same code;
you will never see their results, so don't hold back and don't pad.

Review Target: <absolute path to target.diff or target.paths>
Repository: <absolute repo root>. Read surrounding code, callers, tests and configs there for context.
Intent: <one line>

Rules:
- READ-ONLY. Never edit, write, stage, commit, or run anything that changes state. Read, Grep, Glob and
  read-only git/shell commands only.
- Only report problems in code the Review Target adds or changes (or, for a path target, the named
  files). Pre-existing problems elsewhere are out of scope unless the change makes them reachable or worse.
- Every finding needs a concrete failure_scenario: the input/state and what goes wrong. If you can't
  write one, drop the finding.
- Severity:
    critical: exploitable now, data loss/corruption, or a crash on a common path
    high:     likely wrong behaviour or a real vulnerability under realistic conditions
    medium:   a real defect or meaningful cost that bites under specific conditions
    low:      minor, cosmetic, stylistic or speculative
- Style preferences, naming bikesheds and "consider adding a comment" are not findings.

Return ONLY a JSON array (empty if nothing found), no prose before or after:
[{"file": "path/relative/to/repo", "line": 123, "severity": "high",
  "category": "short-kebab-slug e.g. sql-injection", "title": "<= 80 chars",
  "failure_scenario": "...", "fix": "concrete suggested change"}]
```

### Lens briefs

**Security**
```
Lens: SECURITY. Hunt for vulnerabilities: injection (SQL, command, template, LDAP, header), path
traversal, SSRF, XSS, authn/authz gaps and missing permission checks, IDOR, secrets or credentials in
code/logs/errors, unsafe deserialization, weak crypto or randomness, TLS verification disabled,
race-condition security bugs (TOCTOU), unbounded input leading to resource exhaustion, sensitive data
(PII, tokens) in logs, insecure defaults in config/manifests (privileged containers, open CORS, 0.0.0.0
binds). Trace untrusted input from its source to the sink before reporting it.
```

**Optimizer / Cleaner**
```
Lens: OPTIMIZER & CLEANER. Look for:
- Reuse / DRY: new code that duplicates an existing helper, util or pattern elsewhere in the repo (search
  for it and cite where it lives), or copy-pasted blocks within the change that should be one function.
- Simplification: needless abstraction or indirection, dead code, redundant conditionals or state,
  over-defensive checks the types already guarantee, code that could use a standard-library facility,
  logic at the wrong altitude (a layer doing work that belongs to its caller or callee).
- Efficiency: repeated work in loops (N+1 queries, repeated parsing/allocation, O(n^2) where O(n) is
  easy), unbounded growth, missing batching, blocking I/O on hot paths, needless copies.
Severity reflects real impact: a hot-path N+1 can be high, a three-line duplicate is low. Every fix must
preserve behaviour.
```

**Bug Hunter**
```
Lens: BUGS. Find correctness defects: logic errors, off-by-one, nil/null dereference, unchecked errors,
wrong error propagation, resource leaks (files, connections, goroutines, contexts), concurrency bugs
(data races, deadlocks, lost updates), wrong edge-case handling (empty, zero, max, unicode, timezones),
broken contracts with callers, behaviour that contradicts the Intent, and tests that pass without
testing what they claim. Read the callers before claiming a contract is broken.
```

If a reviewer returns malformed output, parse what you can. If it returns nothing usable, count that
Round's Lens as "no findings" and note it in the report. Don't re-run it, because a re-run gets an
extra vote.

## 3. Cluster and Vote

1. **Pool** all findings from all 9 reviewers, tagged with their Round.
2. **Cluster** findings that describe the **same underlying defect**: same file, overlapping or nearby
   lines, same root cause. Lens doesn't matter: a SQL injection reported by r1-security and by
   r2-bugs is one Finding. Two different problems on the same line are two Findings. When unsure,
   keep them separate.
3. **Vote:** for each Finding, count the **distinct Rounds** that reported it at **medium or higher**.
   Several reports from the same Round count once.
4. **Surface** a Finding when that count is **≥ 2 of 3 Rounds**. A Finding with only **one** vote
   that was rated **high or critical** is a **Lone Finding**: it goes to step 4 (Verify) instead of being
   dropped. Everything else is dropped: one-vote findings rated medium, and findings that a majority
   found but rated low. A lens-majority rule isn't needed: each Round has one reviewer per Lens, so
   2 of 3 same-Lens reviewers always means 2 of 3 Rounds.
5. **Consensus severity** is the median of the medium+ ratings from the voting Rounds. With two votes,
   take the lower one.
6. Use the clearest title, failure_scenario and fix among the cluster's reports. Merge them only when
   they complement each other.

Don't add Findings of your own and don't overrule the Vote on opinion. The only thing you may do is
check that each surviving Finding's `file:line` exists in the Review Target. If it plainly doesn't (a
hallucinated location), drop the Finding and say so under Dropped.

## 4. Verify Lone Findings

A majority vote silently drops a real critical bug that only one Round happened to catch. Lone
Findings get one independent check instead. For each Lone Finding, launch one **Verifier** (Agent tool,
`subagent_type: general-purpose`, label `verify-<n>`). Launch them all in one message.

The Verifier gets the claim only: the location, the title and the failure_scenario. It **doesn't** get
the reviewer's reasoning, fix or severity, so it isn't anchored on them. Its prompt:

```
You are verifying one claimed defect. You did not write the claim; assume nothing about whether it is
true. READ-ONLY: never edit, write, or run anything that changes state.

Repository: <absolute repo root>
Review Target: <absolute path to target.diff or target.paths>
Claim: <file>:<line>: <title>
Failure scenario: <failure_scenario>

Read the code at that location plus its callers, guards, validation, tests and config. Decide whether
the failure scenario can actually happen in this code as written. Evidence decides, not how plausible
the claim sounds.

Return ONLY JSON:
{"verdict": "confirmed" | "refuted" | "unclear",
 "severity": "critical" | "high" | "medium" | "low",
 "evidence": "file:line references and one or two sentences"}
```

Surface a Lone Finding only when the verdict is `confirmed` **and** the Verifier's severity is high or
critical. It goes in the report's **Single-round, verified** section, and its severity is the lower of
the reviewer's rating and the Verifier's. `refuted`, `unclear`, or a downgrade below high → drop it and
count it under Dropped. Verifiers never get a second pass and never vote on majority Findings.

## 5. Report

```
## Consensus Review: <target description>
<Intent>

| # | Severity | Votes | Lens(es) | Location | Finding |
|---|----------|-------|----------|----------|---------|
| 1 | high | 3/3 | security, bugs | `pkg/db/query.go:42` | SQL injection via unescaped `name` |

### 1. <title>  (high, 3/3)
**Failure:** <failure_scenario>
**Fix:** <fix>

### Single-round, verified
Found by only one Round, then confirmed by an independent Verifier. These didn't win the Vote.

| # | Severity | Lens | Location | Finding | Verifier evidence |
|---|----------|------|----------|---------|-------------------|
| 4 | critical | bugs (r3) | `pkg/x/y.go:88` | ... | ... |

---
Raw reports: <N> from 9 reviewers → <M> distinct Findings → <K> by vote + <V> verified Lone Findings.
Dropped: <a> one-vote medium, <b> majority-but-low, <r> Lone Findings refuted/unclear/downgraded, <c> bad location. <Any reviewer that returned nothing usable.>
```

Omit the Single-round section when it's empty. Number Findings continuously across both sections.
Sort by severity, then by votes. If nothing survives, say so plainly and give the Dropped line. That
outcome is a pass, not a failure. Don't list the dropped findings unless the user asks; keep them in
your context in case they do.

## 6. Offer to fix

Ask with AskUserQuestion (multiSelect) which surfaced Findings to fix: offer "all", the critical/high
ones, or individual Findings by number. Then fix only what was chosen. Behaviour-changing fixes (bugs,
security) follow the repo's TDD rules: a failing test first, then the fix. Cleanups must keep the
existing tests green. Run the relevant tests after fixing. **Don't** start a new consensus-review on
your own fixes. Running the review again is the user's call.
