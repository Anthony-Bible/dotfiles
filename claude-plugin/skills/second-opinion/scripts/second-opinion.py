#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.8"
# dependencies = []
# ///
"""The non-judgement half of a Review: run the Reviewer (Muse Code, `muse exec`) over a snapshot of the Review
Target and record what it said. The Author (the Claude Code session using the second-opinion skill) verifies
every Finding, writes the Rebuttal and decides; this script only snapshots, runs, parses and records.

Usage (from inside the repo):
  second-opinion.py check                                    muse on PATH, credentials, git repo with a commit
  second-opinion.py review diff [--base REF] [--auto]        Findings on the working tree (uncommitted + untracked)
                                                             relative to REF (default HEAD); --auto applies the
                                                             pre-commit threshold and skips small or non-code Diffs
  second-opinion.py review plan PLAN.md                      Findings on a Plan, checked against the repo's code
  second-opinion.py gate [--base REF] [--head REF]        the PR Gate's check: is the branch's Diff (merge-base of REF,
                                                             default the repo's default branch, to HEAD or --head REF) Covered by a
                                                             chain of Ledger entries? Prints {required, reason,
                                                             code_lines, chain_end, base}; exit 0, never writes
  second-opinion.py rebut RUN_DIR REBUTTAL.json             the one Rebuttal turn, in the same Reviewer session;
                                                             REBUTTAL.json = [{"finding_id": 1, "argument": "..."}]
  common: [--effort high] [--timeout 600] [--intent TEXT]

Every command prints one JSON object on stdout. Exit status: 0 = done; 2 = bad arguments or Rebuttal file (fix
and re-run); 3 = Reviewer unavailable (muse missing, no credentials, error, timeout or an internal error: the
caller fails open); 4 = skipped (no changes, or below the --auto threshold).

Isolation: `--disable-write` does not stop shell writes, so the Reviewer never runs in the real checkout. The
working tree (tracked changes and untracked, non-ignored files) is committed to a dangling snapshot through a
temporary index, never touching the real index or stash. Each turn, this script checks that commit out in a
fresh detached worktree inside the run directory (`git worktree add --detach`) and hands it to muse with
`-w existing`; muse leaves a caller-owned worktree alone, and the script removes it after the turn, whatever
the outcome. (`-w create` is out: since muse 1.4.3 its sandbox may not create .git/worktrees/ entries.) Turn 2
resumes the same session in a new worktree of the same snapshot. No branches are created.

Ledger: every `review diff` attempt (reviewed, skipped or unavailable) appends one JSON line to
<git-common-dir>/second-opinion/ledger.jsonl: {tree, base_tree, base, status, code_lines, run, at}. A failed
write is swallowed and never changes the exit status or stdout. Plan Reviews write no entry.

The 10-minute budget covers the review and the Rebuttal together. Runs are kept in <git-dir>/second-opinion/.
Python 3.8+, stdlib only. Runs through `uv run --script` (PEP 723 metadata above); `python3 second-opinion.py`
works too.
"""
import argparse, json, os, re, shutil, signal, subprocess, sys, tempfile, time, uuid

LEDGER_STATUSES = ("reviewed", "skipped", "unavailable")
EXIT_OK, EXIT_USAGE, EXIT_UNAVAILABLE, EXIT_SKIPPED = 0, 2, 3, 4
MIN_CODE_LINES = 20
LARGE_DIFF_LINES = 400  # a Review of more code lines than this earns a warning: review per commit instead
MAX_INNER = 15  # of those, trees a later entry builds on that are measured too
MAX_ENDS = 100  # reachable trees the gate measures against HEAD (those with HEAD's code come first)
PROMPT_CAP = 150_000
NON_CODE_EXT = {".md", ".mdx", ".txt", ".rst", ".adoc", ".json", ".yaml", ".yml", ".toml", ".ini", ".cfg",
                ".conf", ".csv", ".lock", ".sum", ".svg", ".png", ".jpg", ".jpeg", ".gif", ".ico", ".pdf"}
LOCKFILES = {"package-lock.json", "yarn.lock", "pnpm-lock.yaml", "go.sum", "Cargo.lock", "poetry.lock",
             "uv.lock", "flake.lock", "Gemfile.lock", "composer.lock"}
OMITTED_NOTE = "[not UTF-8, so its content is left out; read the file in your working directory]\n"
SEVERITIES = ("bug", "risk", "test-gap", "design", "nit")
ADVISORY = {"test-gap", "design"}  # never block; a nit never reaches the Author; anything else (bug, risk, or a
                                   # severity outside the schema) blocks, so a surprise label fails closed
MUSE_FLAGS = ["--json", "--disable-write", "--disable-web-tools", "--no-foreign-personal-context"]

FINDING = {"type": "object", "additionalProperties": False,
           "required": ["file", "line", "section", "severity", "claim", "evidence", "failure_scenario"],
           "properties": {"file": {"type": ["string", "null"]}, "line": {"type": ["integer", "null"]},
                          "section": {"type": ["string", "null"]},
                          "severity": {"type": "string", "enum": list(SEVERITIES)},
                          "claim": {"type": "string"}, "evidence": {"type": "string"},
                          "failure_scenario": {"type": "string"}}}
FINDINGS_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["findings"],
                   "properties": {"findings": {"type": "array", "items": FINDING}}}
REBUTTAL_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["responses"],
                   "properties": {"responses": {"type": "array", "items": {
                       "type": "object", "additionalProperties": False,
                       "required": ["finding_id", "stance", "argument"],
                       "properties": {"finding_id": {"type": "integer"},
                                      "stance": {"type": "string", "enum": ["concede", "defend"]},
                                      "argument": {"type": "string"}}}}}}

ROLE = ("You are the Reviewer: an independent second opinion on work another AI coding agent (the Author) just "
        "produced. Your working directory is a disposable snapshot of the repository; anything you change there is "
        "thrown away, so do not edit files. Read the surrounding code, callers and tests, and run read-only commands "
        "or the test suite when that settles a question. This is an unattended run: nobody will answer questions.\n\n")
RULES = ("Be adversarial. The Author is confident in this work and already believes it is correct, so a review that "
         "agrees with it adds nothing. Assume there is at least one defect and go looking for it: trace every changed "
         "path with hostile inputs (empty, missing, huge, malformed, duplicated, non-ASCII, concurrent or repeated "
         "calls), follow every error and early-return path to see what state it leaves behind, read each caller of a "
         "changed function to see whether its contract still holds, and check that the change does what the stated "
         "intent says, all of it and nothing else. Run the tests when that settles a question.\n\n"
         "Severity: \"bug\" when some input or state produces incorrect behaviour, or the change does not do what the "
         "intent says; \"risk\" for security holes, data loss, races, resource leaks or broken contracts with callers; "
         "\"test-gap\" when changed behaviour (a branch, an error path, an edge case you identified) has no test that "
         "would fail if it broke, or a test asserts the implementation instead of the contract; \"design\" when the "
         "change is correct today but is built so the next change will likely break it (duplicated logic that must "
         "stay in sync, a leaky or misleading abstraction, hidden coupling, a name that says something the code does "
         "not do); \"nit\" for formatting and taste. Do not downgrade a bug to a risk or a risk to a nit to be polite.\n\n"
         "Every Finding needs a one-sentence claim, the evidence (quoted code or the reasoning that shows it) and a "
         "concrete failure scenario: the input, state or future edit, and what goes wrong. Check each claim against "
         "the code before you report it; a guard or caller you did not read is not evidence, and the Author will "
         "verify every Finding and argue back against weak ones. Return an empty list only after you have tried to "
         "break every changed path and failed.\n\n")


def out(obj, code=EXIT_OK):
    print(json.dumps(obj, indent=2))
    sys.exit(code)


def unavailable(reason, **extra):
    out({"status": "unavailable", "reason": reason, **extra}, EXIT_UNAVAILABLE)


def git(*args, env=None):
    # git output is not always UTF-8; a stray byte becomes U+FFFD rather than failing the Review
    return subprocess.run(["git", *args], capture_output=True, encoding="utf-8", errors="replace", env=env,
                          check=True).stdout.strip()


def repo_root():
    try:
        return git("rev-parse", "--show-toplevel")
    except subprocess.CalledProcessError:
        unavailable("not inside a git repository")


def problems():
    found = []
    if not shutil.which("muse"):
        found.append("muse is not on PATH (install: curl -fsSL https://dev.meta.ai/install.sh | sh)")
    auth = os.path.expanduser("~/.config/muse/auth.json")
    if not os.environ.get("META_API_KEY") and not os.path.exists(auth):
        found.append("no Muse credentials: run `muse login` or set META_API_KEY")
    try:
        git("rev-parse", "--show-toplevel")
        git("rev-parse", "--verify", "HEAD")
    except subprocess.CalledProcessError:
        found.append("not inside a git repository with at least one commit")
    return found


def snapshot():
    """Commit the working tree (tracked changes + untracked, non-ignored files) without touching the index."""
    fd, index = tempfile.mkstemp(prefix="second-opinion-index-")
    os.close(fd)
    env = dict(os.environ, GIT_INDEX_FILE=index)
    try:
        git("read-tree", "HEAD", env=env)
        git("add", "-A", env=env)
        tree = git("write-tree", env=env)
    finally:
        os.unlink(index)
    return git("-c", "user.name=second-opinion", "-c", "user.email=second-opinion@localhost",
               "commit-tree", tree, "-p", "HEAD", "-m", "second-opinion snapshot")


def is_code(path):
    name = os.path.basename(path)
    return name not in LOCKFILES and os.path.splitext(name)[1].lower() not in NON_CODE_EXT


def diff_stats(base, snap):
    """The stats and the Diff text. A file whose part of the Diff is not UTF-8 is binary that git took for text
    (no NUL byte, e.g. a raw audio fixture): the Diff keeps its header line only, and it counts as no code."""
    numstat = git("diff", "--numstat", base, snap).splitlines()
    raw = subprocess.run(["git", "diff", base, snap], capture_output=True, check=True).stdout
    parts = [p for p in re.split(rb"(?m)^(?=diff --git )", raw) if p]
    paired = len(parts) == len(numstat)  # git lists the files in the same order in both
    files, code_files, code_lines, omitted, kept = [], [], 0, [], []
    for i, line in enumerate(numstat):
        added, deleted, path = line.split("\t", 2)
        files.append(path)
        try:
            kept.append(parts[i].decode("utf-8") if paired else "")
        except UnicodeDecodeError:
            omitted.append(path)
            kept.append(parts[i].split(b"\n", 1)[0].decode("utf-8", "replace") + "\n" + OMITTED_NOTE)
            continue
        if is_code(path):
            code_files.append(path)
            code_lines += 0 if added == "-" else int(added) + int(deleted)
    diff = "".join(kept) if paired else raw.decode("utf-8", "replace")  # cannot pair them up: keep every byte
    return {"files": files, "code_files": code_files, "code_lines": code_lines, "omitted": omitted}, diff.strip()


def diff_base(a):
    return git("rev-parse", "HEAD") if a.base == "HEAD" else git("merge-base", a.base, "HEAD")


def ledger_path():
    return os.path.join(git("rev-parse", "--path-format=absolute", "--git-common-dir"), "second-opinion",
                        "ledger.jsonl")


def log_attempt(a, status, snap=None, base=None, stats=None, run=None):
    """Append one Ledger line for a `review diff` attempt. Best effort: nothing here may change the outcome."""
    try:
        if a.target != "diff":
            return
        if snap is None:  # an early exit: take the snapshot now, if there is a repository to take it in
            os.chdir(git("rev-parse", "--show-toplevel"))
            snap = snapshot()
        if base is None:
            base = diff_base(a)
        if stats is None:
            stats = diff_stats(base, snap)[0]
        entry = {"tree": git("rev-parse", snap + "^{tree}"), "base_tree": git("rev-parse", base + "^{tree}"),
                 "base": base, "status": status, "code_lines": stats["code_lines"], "run": run,
                 "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        path = ledger_path()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception:
        pass


def remove_worktree(path):
    subprocess.run(["git", "worktree", "remove", "--force", path], capture_output=True)
    shutil.rmtree(path, ignore_errors=True)  # in case git no longer knew it as a worktree
    subprocess.run(["git", "worktree", "prune"], capture_output=True)


def run_muse(root, run, turn, prompt, schema, meta):
    """One `muse exec` turn in a fresh worktree of the snapshot; returns the parsed final answer."""
    paths = {k: os.path.join(run, f"turn{turn}.{k}") for k in ("prompt.md", "schema.json", "jsonl", "stderr")}
    with open(paths["prompt.md"], "w", encoding="utf-8") as f:
        f.write(prompt)
    with open(paths["schema.json"], "w") as f:
        json.dump(schema, f)
    remaining = meta["deadline"] - time.time()
    if remaining < 5:
        return None, "timeout: the review budget is spent"
    worktree = os.path.join(run, f"turn{turn}.worktree")
    try:
        git("worktree", "add", "--detach", worktree, meta["snapshot"])
    except subprocess.CalledProcessError as e:
        remove_worktree(worktree)
        return None, f"cannot create the snapshot worktree: {e.stderr.strip()}"
    cmd = ["muse", "exec", *MUSE_FLAGS, "--prompt-file", paths["prompt.md"], "--output-schema",
           paths["schema.json"], "--session-id", meta["session_id"], "--reasoning-effort", meta["effort"],
           "-w", "existing", "--worktree-existing", worktree]
    timed_out = False
    try:
        with open(paths["jsonl"], "w") as log, open(paths["stderr"], "w") as err:
            # cwd is the source repo (muse refuses a worktree equal to it); the Reviewer's workspace is the worktree
            proc = subprocess.Popen(cmd, cwd=root, stdout=log, stderr=err, start_new_session=True)
            try:
                proc.wait(timeout=remaining)
            except subprocess.TimeoutExpired:
                timed_out = True
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                proc.wait()
    finally:  # whatever happens after `worktree add`, including Popen failing
        remove_worktree(worktree)
    if timed_out:
        return None, f"timeout after {meta['timeout']}s"
    terminal = None
    with open(paths["jsonl"]) as f:
        for line in f:
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue  # stderr noise, or a line cut off when muse died
            if isinstance(rec, dict) and rec.get("payload_type", "").startswith("run.terminal."):
                terminal = rec["payload"]
    tail = open(paths["stderr"], errors="replace").read().strip().splitlines()[-3:]
    if not terminal or terminal.get("terminal") != "completed":
        detail = (terminal or {}).get("reason") or " | ".join(tail) or "no final answer in the event stream"
        return None, f"muse exited {proc.returncode}: {detail}"
    if proc.returncode != 0:  # a completed answer still counts, even if muse fails afterwards
        meta.setdefault("warnings", []).append(f"turn {turn}: muse exited {proc.returncode} after a completed "
                                               "answer: " + (" | ".join(tail) or "no stderr"))
    try:
        return json.loads(terminal["text"]), None
    except (json.JSONDecodeError, TypeError):
        return None, "the Reviewer's answer was not valid JSON: " + str(terminal.get("text"))[:500]


def capped(text, what):
    if len(text) <= PROMPT_CAP:
        return text
    return text[:PROMPT_CAP] + f"\n\n[{what} truncated at {PROMPT_CAP} characters; read the rest in the repository]\n"


def new_run(root, target, a):
    run_id = time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6]
    run = os.path.join(git("rev-parse", "--path-format=absolute", "--git-common-dir"), "second-opinion", run_id)
    os.makedirs(run)
    now = time.time()
    return run, {"run_id": run_id, "target": target, "session_id": str(uuid.uuid4()), "effort": a.effort,
                 "timeout": a.timeout, "started": now, "deadline": now + a.timeout}


def cmd_check(a):
    found = problems()
    if found:
        unavailable("; ".join(found))
    out({"status": "ok", "muse": subprocess.run(["muse", "--version"], capture_output=True,
                                                 text=True).stdout.strip()})


def cmd_review(a):
    found = problems()
    if found:
        log_attempt(a, "unavailable")
        unavailable("; ".join(found))
    root = repo_root()
    os.chdir(root)
    snap = snapshot()
    intent = f"The Author's stated intent: {a.intent}\n\n" if a.intent else ""
    if a.target == "diff":
        base = diff_base(a)
        stats, diff = diff_stats(base, snap)
        if not stats["files"]:
            log_attempt(a, "skipped", snap, base, stats)
            out({"status": "skipped", "reason": "no changes to review"}, EXIT_SKIPPED)
        if a.auto and (not stats["code_files"] or stats["code_lines"] < MIN_CODE_LINES):
            log_attempt(a, "skipped", snap, base, stats)
            out({"status": "skipped", "reason": f"below the auto threshold: {stats['code_lines']} changed code "
                 f"lines in {len(stats['code_files'])} code files (needs {MIN_CODE_LINES})", **stats}, EXIT_SKIPPED)
        prompt = (ROLE + f"The Review Target is a Diff: `git diff {base} HEAD` in your working directory (HEAD is "
                  "the snapshot of the Author's work). Review it for correctness.\n\n" + intent + RULES +
                  "Give file as a repository-relative path and line as the line number in the new version; set "
                  "section to null.\n\nThe Diff:\n\n```diff\n" + capped(diff, "Diff") + "\n```\n")
    else:
        if not os.path.isfile(a.plan):
            unavailable(f"no such Plan file: {a.plan}")
        stats, base = {}, None
        plan = open(a.plan, encoding="utf-8", errors="replace").read()
        prompt = (ROLE + "The Review Target is a Plan the Author wrote before writing any code. Find the gaps, wrong "
                  "assumptions about the existing code, missed edge cases and steps that would not work as written. "
                  "Check every assumption about the codebase against the repository. Here a \"changed path\" is each step of "
                  "the Plan, and \"test-gap\" means behaviour the Plan adds or changes without planning an automated test "
                  "that would fail if it broke (a manual check does not count).\n\n" + intent + RULES +
                  "Set section to the Plan heading the Finding is about. Set file and line when the Finding rests on "
                  "specific code in the repository, otherwise null. The failure scenario is what goes wrong if the "
                  "Plan is built as written.\n\nThe Plan:\n\n" + capped(plan, "Plan") + "\n")
    run, meta = new_run(root, a.target, a)
    meta.update(snapshot=snap, base=base, plan=a.plan if a.target == "plan" else None)
    if a.target == "diff" and stats["code_lines"] > LARGE_DIFF_LINES:
        meta["large_diff"] = True
        print(f"second-opinion: this Diff has {stats['code_lines']} changed code lines (over {LARGE_DIFF_LINES}); "
              "a Review this big finds little. Review per commit as you go: the Ledger chains the Reviews.",
              file=sys.stderr)
    answer, error = run_muse(root, run, 1, prompt, FINDINGS_SCHEMA, meta)
    if error:
        json.dump(meta, open(os.path.join(run, "run.json"), "w"), indent=2)
        log_attempt(a, "unavailable", snap, base, stats, run)
        unavailable(error, run=run)
    findings = [dict(f, id=i) for i, f in enumerate(answer.get("findings", []), 1)]
    meta["findings"] = findings
    json.dump(meta, open(os.path.join(run, "run.json"), "w"), indent=2)
    log_attempt(a, "reviewed", snap, base, stats, run)
    out({"status": "ok", "run": run, "target": a.target, "snapshot": snap, "base": base, **stats,
         "findings": [dict(f, blocking=f.get("severity") not in ADVISORY) for f in findings
                      if f.get("severity") != "nit"],
         "nits_dropped": sum(f.get("severity") == "nit" for f in findings),
         "seconds": round(time.time() - meta["started"]), **({"warnings": meta["warnings"]} if "warnings" in meta
                                                              else {})})


def ref_exists(ref):
    return subprocess.run(["git", "rev-parse", "--verify", "-q", ref + "^{commit}"],
                          capture_output=True).returncode == 0


def resolve_head(name):
    """The ref a PR's head names: the local branch, else the remote one; `owner:branch` names its branch. None when
    neither exists."""
    name = name.split(":", 1)[-1]
    return next((r for r in (name, "origin/" + name) if name and ref_exists(r)), None)


def resolve_base(name):
    """The PR base ref to compare against: the remote branch when there is one (a local branch can be stale),
    else the local one. Without a name: origin/HEAD, else the first of origin/main, origin/master, main, master."""
    if name:
        return next((r for r in ("origin/" + name, name) if ref_exists(r)), None)
    try:
        head = git("symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD")
        if head and ref_exists(head):
            return head
    except subprocess.CalledProcessError:
        pass
    return next((r for r in ("origin/main", "origin/master", "main", "master") if ref_exists(r)), None)


SHA_RE = re.compile(r"^(?:[0-9a-f]{40}|[0-9a-f]{64})$")


class Trees:
    """What the gate knows about trees, each worked out once. A tree's key is an order-independent sum of the
    blob ids of its code files, restricted to the paths in `rel` (the code paths of the start tree and of HEAD:
    a path in neither cannot affect the PR diff, so untracked scratch files never break a link). The key ignores
    paths, so a pure rename still links; the cost is that swapping two files' contents keys the same, an accepted
    false link. Objects come through one long-lived `cat-file --batch`; a subtree shared by many snapshots is
    summed once per prefix, so the cost follows the distinct subtrees and not the Ledger's length.
    A missing tree or blob anywhere makes the key None."""

    def __init__(self):
        self.parsed, self.sums, self.blobs, self.reader, self.rel, self.dirs = {}, {}, {}, None, set(), {""}

    def read(self, sha, kind):
        """The object's bytes, or None when it is missing or not of that kind."""
        if self.reader is None:
            self.reader = subprocess.Popen(["git", "cat-file", "--batch"], stdin=subprocess.PIPE,
                                           stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        self.reader.stdin.write(sha.encode() + b"\n")
        self.reader.stdin.flush()
        header = self.reader.stdout.readline().split()
        if len(header) != 3:
            return None
        data = self.reader.stdout.read(int(header[2]) + 1)[:-1]
        return data if header[1].decode() == kind else None

    def entries(self, tree):
        """[(mode, name, sha)] of a tree object; None when it is missing."""
        if tree not in self.parsed:
            data = self.read(tree, "tree") if SHA_RE.match(tree) else None
            found = None
            if data is not None:
                found, width, at = [], len(tree) // 2, 0
                while at < len(data):
                    nul = data.index(b"\0", at)
                    mode, _, name = data[at:nul].partition(b" ")
                    found.append((mode, name.decode("utf-8", "replace"), data[nul + 1:nul + 1 + width].hex()))
                    at = nul + 1 + width
            self.parsed[tree] = found
        return self.parsed[tree]

    def code_paths(self, tree, prefix=""):
        """{path: blob} of every code file under the tree (gitlinks skipped); None when anything is missing."""
        ents = self.entries(tree)
        if ents is None:
            return None
        found = {}
        for mode, name, sha in ents:
            if mode == b"40000":
                sub = self.code_paths(sha, prefix + name + "/")
                if sub is None:
                    return None
                found.update(sub)
            elif mode != b"160000" and is_code(name):
                found[prefix + name] = sha
        return found

    def restrict(self, trees):
        """Fix `rel` to the code paths of these trees."""
        self.rel, self.dirs, self.sums = set(), {""}, {}
        paths = [p for t in trees for p in (self.code_paths(t) or {})]
        for path in paths:
            self.rel.add(path)
            parts = path.split("/")
            for i in range(1, len(parts)):
                self.dirs.add("/".join(parts[:i]) + "/")

    def blob_ok(self, sha):
        if sha not in self.blobs:
            self.blobs[sha] = self.read(sha, "blob") is not None
        return self.blobs[sha]

    def key(self, tree, prefix=""):
        """The tree's key (an int), or None when it, or any subtree or blob it names, is missing."""
        memo = (tree, prefix)
        if memo not in self.sums:
            ents = self.entries(tree)
            total = None if ents is None else 0
            for mode, name, sha in ents or []:
                path = prefix + name
                if mode == b"40000":
                    if path + "/" not in self.dirs:  # holds no relevant path, but must exist
                        total = None if self.entries(sha) is None else total
                        if total is None:
                            break
                        continue
                    sub = self.key(sha, path + "/")
                    total = None if sub is None else total + sub
                elif mode != b"160000" and path in self.rel:
                    total = total + int(sha, 16) if self.blob_ok(sha) else None
                if total is None:
                    break
            self.sums[memo] = total
        return self.sums[memo]

    def code_lines(self, old, new):
        """Changed code lines between two trees: `git diff --numstat` with the is_code rules and the binary rule of
        diff_stats, gitlinks (submodule bumps) left out, and only paths in `rel` (a path in neither the start tree
        nor HEAD, such as an untracked scratch file in a snapshot, is not part of the PR diff). A non-UTF-8 text file that diff_stats skips is counted
        here, so the gate can only over-count (deny), never under-count."""
        if old == new:
            return 0
        fields = subprocess.run(["git", "diff", "--raw", "--numstat", "-z", old, new], capture_output=True,
                                check=True).stdout.split(b"\0")
        gitlinks, i = set(), 0
        while i < len(fields) and fields[i].startswith(b":"):  # the raw records come first
            meta = fields[i].split()
            paths = 2 if meta[-1][:1] in (b"R", b"C") else 1
            if b"160000" in meta[:2]:
                gitlinks.update(p.decode("utf-8", "replace") for p in fields[i + 1:i + 1 + paths])
            i += 1 + paths
        total = 0
        while i < len(fields) and fields[i]:
            added, deleted, path = fields[i].decode("utf-8", "replace").split("\t", 2)
            i += 1
            old_path = None
            if path == "":  # a rename or copy: the old and the new path follow
                old_path, path = (f.decode("utf-8", "replace") for f in fields[i:i + 2])
                i += 2
            if (is_code(path) and added != "-" and path not in gitlinks
                    and (path in self.rel or old_path in self.rel)):
                total += int(added) + int(deleted)
        return total

    def close(self):
        if self.reader is not None:
            self.reader.kill()
            self.reader.wait()


def read_ledger():
    entries = []
    try:
        with open(ledger_path(), encoding="utf-8", errors="replace") as f:
            for line in f:
                try:
                    e = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if (isinstance(e, dict) and e.get("status") in LEDGER_STATUSES
                        and all(isinstance(e.get(k), str) and SHA_RE.match(e[k]) for k in ("tree", "base_tree"))):
                    entries.append(e)
    except OSError:
        pass
    return entries


def empty_tree():
    return subprocess.run(["git", "hash-object", "-t", "tree", "--stdin"], input=b"", capture_output=True,
                          check=True).stdout.decode().strip()


def cmd_gate(a):
    """Is the branch's Diff Covered? Start at the merge-base tree (the empty tree on an orphan branch) and follow
    Ledger entries whose base_tree has the current tree's code (a Review snapshots the working tree, so untracked
    scratch files ride along in one entry's tree but not in the commit the next entry is based on), to the chain end
    that leaves the fewest uncovered code lines. Plumbing only: never writes."""
    result = {"required": False, "code_lines": 0, "chain_end": None, "base": a.base}
    trees = Trees()
    try:
        git("rev-parse", "--verify", "-q", "HEAD^{commit}")
        base = resolve_base(a.base)
        if base is None:
            out({**result, "reason": f"no base branch found ({a.base or 'no origin/HEAD, origin/main, origin/master, main or master'})"})
        result["base"] = base
        tip, note = "HEAD", ""
        if a.head:
            if a.head.startswith("-"):
                out({**result, "head": a.head, "reason": f"head {a.head} is not a branch name: not judged"})
            tip = resolve_head(a.head)
            if tip is None:  # e.g. pushed by this very command line, so it does not exist yet
                tip, note = "HEAD", f"head {a.head} is not a branch this checkout has (yet): judged HEAD instead. "
            result["head"] = tip
        try:
            mb = git("merge-base", base, tip)
            start = git("rev-parse", mb + "^{tree}")
        except subprocess.CalledProcessError:  # no common history: everything on the branch is new
            mb, start = None, empty_tree()
        candidate = git("rev-parse", tip + "^{tree}")
        remaining = {}

        def left(tree):
            if tree not in remaining:
                remaining[tree] = trees.code_lines(tree, candidate)
            return remaining[tree]

        trees.restrict([start, candidate])
        total = left(start)
        if total < MIN_CODE_LINES:
            out({**result, "reason": note + f"below the threshold: {total} changed code lines", "code_lines": total,
                 "chain_end": start})
        by_key, recency = {}, {}
        for n, e in enumerate(read_ledger()):
            k = trees.key(e["base_tree"])
            if k is not None and trees.key(e["tree"]) is not None:
                by_key.setdefault(k, set()).add(e["tree"])
                recency[e["tree"]] = n
        seen, todo, depth = {start}, [start], {start: 0}
        while todo and len(seen) < 2000:
            node = todo.pop()
            fresh = [n for n in by_key.get(trees.key(node), ()) if n not in seen]
            for nxt in fresh:
                seen.add(nxt)
                todo.append(nxt)
                depth[nxt] = depth[node] + 1
        # Any reachable tree may be the last one reviewed (a later entry can be an abandoned Review or another
        # branch's): measure the ones with HEAD's code first, then chain ends (furthest along, then newest), then a few that later entries build on (an abandoned or other
        # branch's Review can sit after the reviewed tree), capped.
        same = trees.key(candidate)
        leaf = {t: not any(n != t for n in by_key.get(trees.key(t), ())) for t in seen}
        order = sorted(seen, key=lambda t: (trees.key(t) != same, not leaf[t], -depth[t], -recency.get(t, -1)))
        inner = [t for t in order if not leaf[t] and trees.key(t) != same]
        order = [t for t in order if leaf[t] or trees.key(t) == same] + inner[:MAX_INNER]
        best = start
        for t in order[:MAX_ENDS]:
            try:
                if left(t) < left(best):
                    best = t
                if left(best) == 0:
                    break
            except subprocess.CalledProcessError:  # an object git cannot read: this end is unusable
                continue
        n = left(best)
        out({**result, "required": n >= MIN_CODE_LINES, "code_lines": n, "chain_end": best,
             "reason": note + (f"Covered: {n} uncovered code lines of {total}" if n < MIN_CODE_LINES
                                  else f"{n} changed code lines no Review covers")})
    except subprocess.CalledProcessError:
        out({**result, "reason": "not a git repository with a commit, or git failed"})
    except Exception as e:  # fail open
        out({**result, "reason": f"internal error: {type(e).__name__}: {e}"})
    finally:
        trees.close()


def cmd_rebut(a):
    meta_path = os.path.join(a.run, "run.json")
    if not os.path.isfile(meta_path):
        unavailable(f"no run.json in {a.run}")
    meta = json.load(open(meta_path))
    try:
        rebuttals = json.load(open(a.rebuttal))
    except (OSError, json.JSONDecodeError) as e:
        out({"status": "error", "reason": f"cannot read the Rebuttal file: {e}"}, EXIT_USAGE)
    if not isinstance(rebuttals, list) or not rebuttals or not all(
            isinstance(r, dict) and type(r.get("finding_id")) is int and isinstance(r.get("argument"), str)
            and r["argument"].strip() for r in rebuttals):
        out({"status": "error", "reason": 'the Rebuttal file must be a non-empty list of '
             '{"finding_id": <int>, "argument": "<text>"}'}, EXIT_USAGE)
    known = {f["id"]: f for f in meta.get("findings", [])}
    unknown = [r["finding_id"] for r in rebuttals if r["finding_id"] not in known]
    if unknown:
        out({"status": "error", "reason": f"the Rebuttal names Findings not in this run: {unknown}"}, EXIT_USAGE)
    root = repo_root()
    os.chdir(root)
    lines = []
    for r in rebuttals:
        f = known[r["finding_id"]]
        where = f"{f['file']}:{f['line']}" if f.get("file") else (f.get("section") or "")
        lines.append(f"Finding {f['id']} ({where}): {f['claim']}\nAuthor: {r['argument']}\n")
    prompt = ("The Author checked your Findings against the code and rejects the ones below, giving its reasons. "
              "For each one, concede if the Author is right, or defend it with evidence the Author missed (quote the "
              "code; re-read it first, the snapshot is unchanged). Answer for every Finding listed, and only those. "
              "Do not raise new Findings.\n\n" + "\n".join(lines))
    answer, error = run_muse(root, a.run, 2, prompt, REBUTTAL_SCHEMA, meta)
    if error:
        unavailable(error, run=a.run)
    responses = {r["finding_id"]: r for r in answer.get("responses", []) if r.get("finding_id") in known}
    meta["rebuttal"] = {"sent": rebuttals, "responses": list(responses.values())}
    json.dump(meta, open(meta_path, "w"), indent=2)
    out({"status": "ok", "run": a.run,
         "responses": [responses.get(r["finding_id"], {"finding_id": r["finding_id"], "stance": "no reply",
                                                        "argument": ""}) for r in rebuttals],
         "seconds_total": round(time.time() - meta["started"]),
         **({"warnings": meta["warnings"]} if "warnings" in meta else {})})


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--effort", default="high",
                        choices=["minimal", "low", "medium", "high", "xhigh", "max", "ultra"])
    common.add_argument("--timeout", type=int, default=600, help="seconds for the review and Rebuttal together")
    common.add_argument("--intent", help="what the Author meant the change or Plan to do")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("check"); p.set_defaults(fn=cmd_check)
    p = sub.add_parser("review"); rs = p.add_subparsers(dest="target", required=True)
    d = rs.add_parser("diff", parents=[common]); d.add_argument("--base", default="HEAD")
    d.add_argument("--auto", action="store_true"); d.set_defaults(fn=cmd_review)
    pl = rs.add_parser("plan", parents=[common]); pl.add_argument("plan"); pl.set_defaults(fn=cmd_review)
    p = sub.add_parser("gate"); p.add_argument("--base"); p.add_argument("--head"); p.set_defaults(fn=cmd_gate)
    p = sub.add_parser("rebut"); p.add_argument("run"); p.add_argument("rebuttal"); p.set_defaults(fn=cmd_rebut)
    a = ap.parse_args()
    for path in ("plan", "run", "rebuttal"):
        if getattr(a, path, None):
            setattr(a, path, os.path.abspath(getattr(a, path)))
    try:
        a.fn(a)
    except Exception as e:  # fail open: the caller always gets JSON and exit 3, never a traceback
        unavailable(f"internal error: {type(e).__name__}: {e}")


if __name__ == "__main__":
    main()
