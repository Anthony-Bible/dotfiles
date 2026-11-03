---
name: consensus-review
description: Verified multi-agent code review. Three read-only reviewer subagents (Security, Optimizer/Cleaner, Bug Hunter) review the same frozen Diff once; every distinct medium+ Finding then goes to its own blind, adversarial Verifier, and the user sees only Findings the reviewer and the Verifier independently agree on. Evidence from the code decides, not how many reviewers repeated a claim, so plausible false positives get refuted and real one-off bugs survive. Use when the user asks for a "consensus review", "verified review" or "thorough multi-agent review" of a diff, branch, PR/MR or path. Report first, then offer to fix.
argument-hint: "[branch | PR/MR number | path ...] (default: uncommitted diff, else branch vs default branch)"
---

# consensus-review

You are the **Orchestrator**. You freeze one **Review Target**, run **3 Lens reviewers** once, cluster
what they report into **Candidates**, send every Candidate to its own blind **Verifier**, and show the
user only the **Findings** the Verifier confirms. The consensus is between two independent agents: the
reviewer that made the claim and the Verifier that checked it against the code without seeing the
reviewer's reasoning. Reviewers and Verifiers never edit anything. You don't fix anything until the user
says so.

Why not repeated rounds and a majority vote: identical prompts on the same model make correlated
mistakes, so a plausible false positive wins a vote 3/3, while a real bug that only one sample noticed
loses it. Verification against the code catches the first and keeps the second.

User input: $ARGUMENTS

## 1. Freeze the Review Target

Resolve the target from `$ARGUMENTS` and write it to `<scratchpad>/consensus-review/target.diff`, so
every reviewer and Verifier judges exactly the same bytes even if the working tree changes partway
through.

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
Reviewers and Verifiers judge correctness against it.

## 2. Run the Lens reviewers

Launch the **3** reviewers **in a single message** with the Agent tool (`subagent_type:
general-purpose`) so they run in parallel. Label them `review-security`, `review-optimizer` and
`review-bugs`. Each prompt is the **shared preamble** below followed by its Lens brief.

### Shared preamble

```
You are a code reviewer in an independent review panel. Other reviewers are looking at the same code,
and every finding you report will be checked against the code by someone else, so don't hold back, but
don't report anything you can't back with a concrete failure.

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

If a reviewer returns malformed output, parse what you can. If it returns nothing usable, note it in
the report as a Lens with no usable output. Don't re-run it.

## 3. Build the Candidates

1. **Pool** the findings from all 3 reviewers, tagged with their Lens.
2. **Drop low.** Findings rated low never reach a Verifier. This is what stops the fix-and-refind loop
   of ever-smaller nitpicks.
3. **Cluster** what's left: findings that describe the **same underlying defect** (same file,
   overlapping or nearby lines, same root cause) become one Candidate, whatever Lens reported them. Two
   different problems on the same line are two Candidates. When unsure, keep them separate.
4. **Check the location.** If a Candidate's `file:line` plainly doesn't exist in the Review Target (a
   hallucinated location), drop it and count it under Dropped.
5. For each Candidate keep the clearest title, failure_scenario and fix among its reports, its
   **reviewer severity** (the highest rating among its reports) and its Lens(es).

Don't add Candidates of your own and don't drop any on opinion. Judging them is the Verifiers' job.

## 4. Verify every Candidate

Launch one **Verifier** per Candidate (Agent tool, `subagent_type: general-purpose`, label
`verify-<n>`), all in one message. If launches fail on rate or concurrency limits, fall back to
batches of 5 per message with identical prompts, and don't re-run a Verifier that already returned.

The Verifier gets the claim only: the location, the title and the failure_scenario. It **doesn't** get
the reviewer's reasoning, fix, Lens or severity, so it isn't anchored on them. A Verifier handed a claim
tends to agree with it, so the prompt makes refutation the default and demands evidence for anything
else:

```
You are verifying one claimed defect. You did not write the claim, and most claims like it turn out
to be wrong: a guard upstream, a caller that never passes that input, a type that rules it out, a test
that covers it. Your job is to try to refute it. READ-ONLY: never edit, write, or run anything that
changes state.

Repository: <absolute repo root>
Review Target: <absolute path to target.diff or target.paths>
Intent: <one line>
Claim: <file>:<line>: <title>
Failure scenario: <failure_scenario>

Read the code at that location plus its callers, guards, validation, tests and config. Look for the
reason the failure scenario can't happen. Return "confirmed" only if you can trace the scenario through
the code as written: the input or state that reaches the line, and the missing guard that lets it go
wrong. How plausible the claim sounds counts for nothing.

Rate severity yourself, by impact in this codebase:
  critical: exploitable now, data loss/corruption, or a crash on a common path
  high:     likely wrong behaviour or a real vulnerability under realistic conditions
  medium:   a real defect or meaningful cost that bites under specific conditions
  low:      minor, cosmetic, stylistic or speculative

Return ONLY JSON:
{"verdict": "confirmed" | "refuted" | "unclear",
 "severity": "critical" | "high" | "medium" | "low",
 "evidence": "file:line references tracing the path (or the guard that refutes it), one or two sentences"}
```

Decide each Candidate from its Verifier:

- `confirmed` and Verifier severity medium or higher → **Finding**. Its severity is the **lower** of the
  reviewer severity and the Verifier's.
- `confirmed` but rated low → dropped as confirmed-but-low.
- `unclear` with reviewer severity high or critical → listed under **Unverified** in the report, so a
  possible critical bug isn't silently lost. Other `unclear` → dropped.
- `refuted`, or a Verifier with no usable output → dropped.

Verifiers never get a second pass, and you don't overrule a verdict on opinion.

## 5. Report

```
## Consensus Review: <target description>
<Intent>

| # | Severity | Lens(es) | Location | Finding |
|---|----------|----------|----------|---------|
| 1 | high | security, bugs | `pkg/db/query.go:42` | SQL injection via unescaped `name` |

### 1. <title>  (high)
**Failure:** <failure_scenario>
**Verifier:** <evidence>
**Fix:** <fix>

### Unverified
Rated high/critical by a reviewer, but the Verifier couldn't confirm or refute it. Worth a manual look.

| Severity | Lens | Location | Claim | Verifier note |
|----------|------|----------|-------|---------------|
| critical | bugs | `pkg/x/y.go:88` | ... | ... |

---
Raw reports: <N> from 3 reviewers → <a> low dropped → <C> Candidates → <K> confirmed Findings.
Dropped: <r> refuted, <l> confirmed-but-low, <u> unclear, <c> bad location. <Any reviewer or Verifier that returned nothing usable.>
```

Omit the Unverified section when it's empty. Sort Findings by severity, then by the number of Lenses
that reported them. If nothing survives, say so plainly and give the Raw/Dropped lines. That outcome is
a pass, not a failure. Don't list the dropped Candidates unless the user asks; keep them and their
Verifier evidence in your context in case they do.

## 6. Offer to fix

Ask with AskUserQuestion (multiSelect) which Findings to fix: offer "all", the critical/high ones, or
individual Findings by number. Then fix only what was chosen. Behaviour-changing fixes (bugs, security)
follow the repo's TDD rules: a failing test first, then the fix. Cleanups must keep the existing tests
green. Run the relevant tests after fixing. **Don't** start a new consensus-review on your own fixes.
Running the review again is the user's call.
