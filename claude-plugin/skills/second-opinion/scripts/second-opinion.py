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
  second-opinion.py rebut RUN_DIR REBUTTAL.json              the one Rebuttal turn, in the same Reviewer session;
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

The 10-minute budget covers the review and the Rebuttal together. Runs are kept in <git-dir>/second-opinion/.
Python 3.8+, stdlib only. Runs through `uv run --script` (PEP 723 metadata above); `python3 second-opinion.py`
works too.
"""
import argparse, json, os, shutil, signal, subprocess, sys, tempfile, time, uuid

EXIT_OK, EXIT_USAGE, EXIT_UNAVAILABLE, EXIT_SKIPPED = 0, 2, 3, 4
MIN_CODE_LINES = 20
PROMPT_CAP = 150_000
NON_CODE_EXT = {".md", ".mdx", ".txt", ".rst", ".adoc", ".json", ".yaml", ".yml", ".toml", ".ini", ".cfg",
                ".conf", ".csv", ".lock", ".sum", ".svg", ".png", ".jpg", ".jpeg", ".gif", ".ico", ".pdf"}
LOCKFILES = {"package-lock.json", "yarn.lock", "pnpm-lock.yaml", "go.sum", "Cargo.lock", "poetry.lock",
             "uv.lock", "flake.lock", "Gemfile.lock", "composer.lock"}
MUSE_FLAGS = ["--json", "--disable-write", "--disable-web-tools", "--no-foreign-personal-context"]

FINDING = {"type": "object", "additionalProperties": False,
           "required": ["file", "line", "section", "severity", "claim", "evidence", "failure_scenario"],
           "properties": {"file": {"type": ["string", "null"]}, "line": {"type": ["integer", "null"]},
                          "section": {"type": ["string", "null"]},
                          "severity": {"type": "string", "enum": ["bug", "risk", "nit"]},
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
RULES = ("Report Findings only for things that are wrong: severity \"bug\" when some input or state produces "
         "incorrect behaviour, \"risk\" for security holes, data loss, races or broken contracts, \"nit\" for style, "
         "naming, formatting and taste. Every Finding needs a one-sentence claim, the evidence (quoted code or the "
         "reasoning that shows it) and a concrete failure scenario. Check each claim against the code before you "
         "report it; a guard or caller you did not read is not evidence. An empty list is the right answer when "
         "nothing is wrong.\n\n")


def out(obj, code=EXIT_OK):
    print(json.dumps(obj, indent=2))
    sys.exit(code)


def unavailable(reason, **extra):
    out({"status": "unavailable", "reason": reason, **extra}, EXIT_UNAVAILABLE)


def git(*args, env=None):
    return subprocess.run(["git", *args], capture_output=True, text=True, env=env, check=True).stdout.strip()


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
    files, code_lines = [], 0
    for line in git("diff", "--numstat", base, snap).splitlines():
        added, deleted, path = line.split("\t", 2)
        changed = 0 if added == "-" else int(added) + int(deleted)
        files.append(path)
        if is_code(path):
            code_lines += changed
    return {"files": files, "code_files": [f for f in files if is_code(f)], "code_lines": code_lines}


def remove_worktree(path):
    subprocess.run(["git", "worktree", "remove", "--force", path], capture_output=True)
    shutil.rmtree(path, ignore_errors=True)  # in case git no longer knew it as a worktree
    subprocess.run(["git", "worktree", "prune"], capture_output=True)


def run_muse(root, run, turn, prompt, schema, meta):
    """One `muse exec` turn in a fresh worktree of the snapshot; returns the parsed final answer."""
    paths = {k: os.path.join(run, f"turn{turn}.{k}") for k in ("prompt.md", "schema.json", "jsonl", "stderr")}
    with open(paths["prompt.md"], "w") as f:
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
    tail = open(paths["stderr"]).read().strip().splitlines()[-3:]
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
        unavailable("; ".join(found))
    root = repo_root()
    os.chdir(root)
    snap = snapshot()
    intent = f"The Author's stated intent: {a.intent}\n\n" if a.intent else ""
    if a.target == "diff":
        base = git("rev-parse", "HEAD") if a.base == "HEAD" else git("merge-base", a.base, "HEAD")
        stats = diff_stats(base, snap)
        if not stats["files"]:
            out({"status": "skipped", "reason": "no changes to review"}, EXIT_SKIPPED)
        if a.auto and (not stats["code_files"] or stats["code_lines"] < MIN_CODE_LINES):
            out({"status": "skipped", "reason": f"below the auto threshold: {stats['code_lines']} changed code "
                 f"lines in {len(stats['code_files'])} code files (needs {MIN_CODE_LINES})", **stats}, EXIT_SKIPPED)
        diff = git("diff", base, snap)
        prompt = (ROLE + f"The Review Target is a Diff: `git diff {base} HEAD` in your working directory (HEAD is "
                  "the snapshot of the Author's work). Review it for correctness.\n\n" + intent + RULES +
                  "Give file as a repository-relative path and line as the line number in the new version; set "
                  "section to null.\n\nThe Diff:\n\n```diff\n" + capped(diff, "Diff") + "\n```\n")
    else:
        if not os.path.isfile(a.plan):
            unavailable(f"no such Plan file: {a.plan}")
        stats, base = {}, None
        plan = open(a.plan).read()
        prompt = (ROLE + "The Review Target is a Plan the Author wrote before writing any code. Find the gaps, wrong "
                  "assumptions about the existing code, missed edge cases and steps that would not work as written. "
                  "Check every assumption about the codebase against the repository.\n\n" + intent + RULES +
                  "Set section to the Plan heading the Finding is about. Set file and line when the Finding rests on "
                  "specific code in the repository, otherwise null. The failure scenario is what goes wrong if the "
                  "Plan is built as written.\n\nThe Plan:\n\n" + capped(plan, "Plan") + "\n")
    run, meta = new_run(root, a.target, a)
    meta.update(snapshot=snap, base=base, plan=a.plan if a.target == "plan" else None)
    answer, error = run_muse(root, run, 1, prompt, FINDINGS_SCHEMA, meta)
    if error:
        json.dump(meta, open(os.path.join(run, "run.json"), "w"), indent=2)
        unavailable(error, run=run)
    findings = [dict(f, id=i) for i, f in enumerate(answer.get("findings", []), 1)]
    meta["findings"] = findings
    json.dump(meta, open(os.path.join(run, "run.json"), "w"), indent=2)
    out({"status": "ok", "run": run, "target": a.target, "snapshot": snap, "base": base, **stats,
         "findings": [f for f in findings if f["severity"] != "nit"],
         "nits_dropped": sum(f["severity"] == "nit" for f in findings),
         "seconds": round(time.time() - meta["started"]), **({"warnings": meta["warnings"]} if "warnings" in meta
                                                              else {})})


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
