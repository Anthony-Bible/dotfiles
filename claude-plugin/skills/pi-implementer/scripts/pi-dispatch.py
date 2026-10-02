#!/usr/bin/env python3
"""The non-judgement half of a Hybrid run: run Dispatches of Tickets through pi + pi-vcc under caps, each
in its own Worktree, and record what happened. The Orchestrator (the Claude Code session using the
pi-implementer skill) writes the Tickets, reads the results, runs the Gates and decides; this script only
runs, records and moves commits.

Usage (from anywhere in the repo; the main checkout is found through git):
  pi-dispatch.py init [--branch hybrid/<slug>]        .hybrid/ layout, .git/info/exclude entry, ledger header, branch
  pi-dispatch.py dispatch TICKET.md [--max-turns 40] [--timeout 1200] [--result-chars 4000]
                                                     claim Dispatch NN, make its Worktree (branch <run>--NN-<ticket>
                                                     from the run branch's HEAD), copy the Ticket to the Worktree's
                                                     .hybrid/TICKET.md, run pi there on a pointer prompt, log to
                                                     .hybrid/logs/NN-<ticket>.jsonl, append .hybrid/dispatches.jsonl
  pi-dispatch.py land NN                              cherry-pick the Worktree's commits onto the run branch and
                                                     remove the Worktree; on a conflict abort the pick and keep it
  pi-dispatch.py drop NN                              remove Dispatch NN's Worktree and branch without landing
  pi-dispatch.py clean                                drop every Worktree of this repo whose Dispatch is not running
  pi-dispatch.py ledger                               the Dispatch table from .hybrid/dispatches.jsonl

While a Dispatch runs, .hybrid/running/NN.json describes it (ticket, caps, start, log, run branch); land, drop
and clean append its Outcome (landed, conflict or dropped) to .hybrid/outcomes.jsonl. Both are for readers
such as the Dispatch Board; nothing here reads them back.

At most MAX_DISPATCHES (environment, else ~/.config/pi-implementer/env, else 1) Dispatches run at once; one
more exits 2 without starting. Worktrees live outside the repo, under
~/.cache/pi-implementer/worktrees/<repo>-<hash>/, so no tool run in the repo ever sees them.

Exit status of dispatch: 0 = pi finished on its own with no error; 1 = error, timeout or turn cap (the partial
work is still in the Worktree — the Gate decides what it is worth); 2 = refused, too many running. Exit status
of land: 0 = landed; 1 = nothing to land or bad state; 3 = conflict (aborted, the run branch is unchanged).

pi has no --max-turns, so its JSON event stream is read live and the whole process group is killed after
max_turns API calls or at the timeout; either way the log is kept. Thinking arrives as text without a token
count from the Server, so thinking tokens are estimated by splitting the exact output count by characters.
Python 3.8+, stdlib only; git 2.31+ (--path-format).
"""
import argparse, fcntl, glob, hashlib, json, os, re, shutil, signal, subprocess, sys, threading, time

HERE = os.path.dirname(os.path.abspath(__file__))
PI = os.path.join(HERE, "pi-implementer")
HYBRID = ".hybrid"
CONFIG = os.path.join(os.environ.get("PI_IMPLEMENTER_HOME", os.path.expanduser("~/.config/pi-implementer")), "env")
WORKTREES = os.path.expanduser("~/.cache/pi-implementer/worktrees")
PI_FLAGS = ["-p", "--mode", "json", "--no-context-files", "--no-skills", "--no-prompt-templates", "-na"]
UNATTENDED = ("This is an unattended, non-interactive run: nobody will answer questions, so do not ask any and "
              "do not run planning or interview skills. Make reasonable choices yourself and build it.\n\n")
POINTER = ("Your task is in .hybrid/TICKET.md in this directory: read it first, follow it exactly, and re-read it "
           "if you lose track of what you were doing. Work only in this directory and never touch .hybrid/ "
           "beyond reading that file.")
LEDGER_HEADER = """# Hybrid ledger

One row per Dispatch, one paragraph per Gate. Kept by the Orchestrator; never committed.

| # | Ticket | Dispatch | wall | calls | tools | think | out | ctx max | ended | Gate |
|---|---|---|---|---|---|---|---|---|---|---|
"""


def git(*args, cwd=None, check=True):
    r = subprocess.run(["git", *args], cwd=cwd, text=True, capture_output=True)
    if check and r.returncode != 0:
        sys.exit(f"git {' '.join(args)}: {r.stderr.strip()}")
    return r


def repo_root():
    """The main checkout, also when run from inside one of its Worktrees."""
    r = subprocess.run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], text=True,
                       capture_output=True)
    if r.returncode != 0:
        sys.exit("not inside a git repository: the skill needs one (git init first)")
    return os.path.dirname(r.stdout.strip())


def worktree_base(root):
    return os.path.join(WORKTREES, f"{os.path.basename(root)}-{hashlib.sha1(root.encode()).hexdigest()[:8]}")


def max_dispatches():
    v = os.environ.get("MAX_DISPATCHES")
    if v is None and os.path.exists(CONFIG):
        for line in open(CONFIG):
            k, _, val = line.strip().partition("=")
            if k == "MAX_DISPATCHES":
                v = val.strip().strip('"')
    try:
        return max(1, int(v or 1))
    except ValueError:
        sys.exit(f"MAX_DISPATCHES must be a whole number, got {v!r}")


def number(path):
    m = re.match(r"(\d+)", os.path.basename(path))
    return int(m.group(1)) if m else 0


def live_pid(path):
    pid = 0
    try:
        pid = int(open(path).read().strip() or 0)
        if pid:
            os.kill(pid, 0)
            return pid
    except PermissionError:
        return pid
    except (OSError, ValueError):
        pass
    return 0


def claim(limit):
    """Under a lock: forget claims whose process is gone, refuse past the limit, else take the next free
    number. A number stays used afterwards through its log. Returns (n, pid file)."""
    running = os.path.join(HYBRID, "running")
    os.makedirs(running, exist_ok=True)
    with open(os.path.join(running, ".lock"), "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        live = []
        for f in glob.glob(os.path.join(running, "*.pid")):
            if live_pid(f):
                live.append(f)
            else:
                os.remove(f)
        if len(live) >= limit:
            sys.stderr.write(f"{len(live)} Dispatch(es) already running (MAX_DISPATCHES={limit}): "
                             "wait for one to finish\n")
            sys.exit(2)
        n = max(map(number, glob.glob(os.path.join(HYBRID, "logs", "*.jsonl")) + live), default=0) + 1
        pidfile = os.path.join(running, f"{n:02d}.pid")
        with open(pidfile, "x") as f:
            f.write(str(os.getpid()))
        return n, pidfile


def current_branch(root):
    r = git("symbolic-ref", "--short", "-q", "HEAD", cwd=root, check=False)
    if r.returncode != 0:
        sys.exit(f"{root} is on a detached HEAD: check out the run branch (pi-dispatch.py init --branch ...)")
    return r.stdout.strip()


def record_outcome(n, outcome, **extra):
    row = {"n": n, "outcome": outcome, "at": time.strftime("%Y-%m-%dT%H:%M:%S"), **extra}
    with open(os.path.join(HYBRID, "outcomes.jsonl"), "a") as f:
        f.write(json.dumps(row) + "\n")


def find_row(n):
    ledger = os.path.join(HYBRID, "dispatches.jsonl")
    rows = [json.loads(line) for line in open(ledger)] if os.path.exists(ledger) else []
    for r in reversed(rows):
        if r["n"] == n and "worktree" in r:
            return r
    sys.exit(f"no finished Dispatch #{n} with a Worktree in {ledger}")


def remove_worktree(root, path, branch):
    if os.path.isdir(path):
        git("worktree", "remove", "--force", path, cwd=root, check=False)
        shutil.rmtree(path, ignore_errors=True)
    git("worktree", "prune", cwd=root, check=False)
    if branch:
        git("branch", "-D", branch, cwd=root, check=False)


def cmd_init(a):
    root = repo_root()
    os.chdir(root)
    for d in ("tickets", "logs", "pi-sessions"):
        os.makedirs(os.path.join(HYBRID, d), exist_ok=True)
    exclude = os.path.join(".git", "info", "exclude")
    os.makedirs(os.path.dirname(exclude), exist_ok=True)
    text = open(exclude).read() if os.path.exists(exclude) else ""
    if HYBRID + "/" not in text.splitlines():
        with open(exclude, "a") as f:
            f.write(("" if not text or text.endswith("\n") else "\n") + HYBRID + "/\n")
    ledger = os.path.join(HYBRID, "ledger.md")
    if not os.path.exists(ledger):
        open(ledger, "w").write(LEDGER_HEADER)
    if a.branch:
        branches = subprocess.check_output(["git", "branch", "--list", a.branch], text=True).strip()
        subprocess.check_call(["git", "checkout", "-q"] + ([] if branches else ["-b"]) + [a.branch])
    print(f"{root}: {HYBRID}/ ready (excluded via .git/info/exclude)"
          + (f", on branch {a.branch}" if a.branch else "")
          + f"; Worktrees under {worktree_base(root)}; MAX_DISPATCHES={max_dispatches()}")
    return 0


def run_pi(cwd, prompt, log_path, timeout, max_turns):
    sessions = os.path.abspath(os.path.join(HYBRID, "pi-sessions"))  # in the main checkout, not the Worktree
    cmd = [PI, *PI_FLAGS, "--session-dir", sessions, prompt]
    t0, m0 = time.time(), time.monotonic()
    proc = subprocess.Popen(cmd, cwd=cwd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, start_new_session=True)
    m = {"wall_s": 0, "slept_s": 0, "timed_out": False, "turns": 0, "tool_calls": 0, "thinking_chars": 0,
         "thinking_tokens_est": 0, "text_chars": 0, "output_tokens": 0, "api_s": 0.0, "is_error": False,
         "result": "", "cache_read_first": None, "turn_capped": False, "compactions": 0, "compaction_errors": 0,
         "ctx_max": 0, "length_stops": 0}

    def killpg():
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass

    def on_timeout():
        m["timed_out"] = True
        killpg()

    timer = threading.Timer(timeout, on_timeout)
    timer.start()
    call_started = None
    with open(log_path, "w") as log:
        for line in proc.stdout:
            log.write(line)
            try:
                e = json.loads(line)
            except ValueError:
                continue
            t = e.get("type")
            msg = e.get("message") or {}
            if t == "message_start" and msg.get("role") == "assistant":
                call_started = time.monotonic()
            elif t == "message_end" and msg.get("role") == "assistant":
                m["turns"] += 1
                if call_started is not None:
                    m["api_s"] += time.monotonic() - call_started
                u = msg.get("usage") or {}
                if m["cache_read_first"] is None:
                    m["cache_read_first"] = u.get("cacheRead")
                m["output_tokens"] += u.get("output") or 0
                m["ctx_max"] = max(m["ctx_max"], (u.get("input") or 0) + (u.get("cacheRead") or 0) + (u.get("output") or 0))
                texts, chars = [], {"thinking": 0, "text": 0, "toolCall": 0}
                for b in msg.get("content", []):
                    if b["type"] == "thinking": chars["thinking"] += len(b.get("thinking", ""))
                    elif b["type"] == "text": chars["text"] += len(b.get("text", "")); texts.append(b["text"])
                    elif b["type"] == "toolCall": chars["toolCall"] += len(json.dumps(b.get("arguments", {})))
                m["thinking_chars"] += chars["thinking"]; m["text_chars"] += chars["text"]
                m["thinking_tokens_est"] += round((u.get("output") or 0) * chars["thinking"] / max(1, sum(chars.values())))
                m["length_stops"] += msg.get("stopReason") == "length"
                m["is_error"] = msg.get("stopReason") == "error"
                text = "\n".join(texts)
                m["result"] = (msg.get("errorMessage") or text) if m["is_error"] else (text or m["result"])
                if m["turns"] >= max_turns:
                    m["turn_capped"] = True
                    killpg()
            elif t == "tool_execution_start":
                m["tool_calls"] += 1
            elif t == "compaction_end":
                if e.get("result") is not None: m["compactions"] += 1
                else: m["compaction_errors"] += 1
    proc.wait()
    timer.cancel()
    m["wall_s"] = time.time() - t0
    m["slept_s"] = m["wall_s"] - (time.monotonic() - m0)
    if proc.returncode != 0 and not (m["timed_out"] or m["turn_capped"]):
        m["is_error"] = True
        m["result"] = m["result"] or f"pi exited {proc.returncode}"
    return m


def ended(m):
    return "timeout" if m["timed_out"] else "turn cap" if m["turn_capped"] else "error" if m["is_error"] else "finished"


def cmd_dispatch(a):
    ticket = os.path.abspath(a.ticket)  # relative to where the user ran this, not the repo root
    root = repo_root()
    os.chdir(root)
    if not os.path.isdir(HYBRID):
        sys.exit(f"{HYBRID}/ missing: run pi-dispatch.py init first")
    if not os.path.isfile(ticket):
        sys.exit(f"no such ticket: {a.ticket}")
    run_branch = current_branch(root)
    name = os.path.splitext(os.path.basename(ticket))[0]
    n, pidfile = claim(max_dispatches())
    meta = os.path.splitext(pidfile)[0] + ".json"
    try:
        base = git("rev-parse", "HEAD", cwd=root).stdout.strip()
        branch = f"{run_branch}--{n:02d}-{name}"
        wt = os.path.join(worktree_base(root), f"{n:02d}-{name}")
        log = os.path.join(HYBRID, "logs", f"{n:02d}-{name}.jsonl")
        with open(meta, "w") as f:
            json.dump({"n": n, "ticket": name, "max_turns": a.max_turns, "timeout": a.timeout,
                       "started": time.strftime("%Y-%m-%dT%H:%M:%S"), "log": log, "run_branch": run_branch}, f)
        os.makedirs(os.path.dirname(wt), exist_ok=True)
        remove_worktree(root, wt, None)  # a leftover of this path from an earlier run
        git("worktree", "add", "-q", "-B", branch, wt, base, cwd=root)
        os.makedirs(os.path.join(wt, HYBRID), exist_ok=True)
        shutil.copyfile(ticket, os.path.join(wt, HYBRID, "TICKET.md"))
        size = os.path.getsize(ticket)
        print(f"dispatch #{n} {name}: max-turns {a.max_turns}, timeout {a.timeout}s, ticket {size} bytes", flush=True)
        print(f"worktree: {wt} (branch {branch}, from {run_branch} @ {base[:9]})", flush=True)
        m = run_pi(wt, UNATTENDED + POINTER, log, a.timeout, a.max_turns)
        row = {"n": n, "ticket": name, "ticket_bytes": size, "max_turns": a.max_turns, "timeout": a.timeout,
               "started": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(time.time() - m["wall_s"])),
               "ended": ended(m), "log": log, "worktree": wt, "branch": branch, "run_branch": run_branch,
               "base": base, **m}
        with open(os.path.join(HYBRID, "dispatches.jsonl"), "a") as f:
            f.write(json.dumps(row) + "\n")
    finally:
        os.remove(pidfile)
        if os.path.exists(meta):
            os.remove(meta)
    if m["slept_s"] > 5:
        print(f"WARNING: the machine slept for {m['slept_s']:.0f}s during this Dispatch", flush=True)
    print(f"{ended(m).upper()} {m['wall_s']:.0f}s  calls={m['turns']} tools={m['tool_calls']} "
          f"think≈{m['thinking_tokens_est']}tok out={m['output_tokens']} ctx_max={m['ctx_max']} "
          f"compactions={m['compactions']}+{m['compaction_errors']}err length_stops={m['length_stops']}")
    print(f"log: {log}")
    print(f"worktree: {wt} — run the Gate there, commit the accepted files there, then: pi-dispatch.py land {n}")
    print("--- result ---")
    print(m["result"][: a.result_chars] + ("…" if len(m["result"]) > a.result_chars else ""))
    return 0 if ended(m) == "finished" else 1


def cmd_land(a):
    root = repo_root()
    os.chdir(root)
    r = find_row(a.n)
    if current_branch(root) != r["run_branch"]:
        sys.exit(f"{root} is not on the run branch {r['run_branch']}")
    if git("status", "--porcelain", "--untracked-files=no", cwd=root).stdout.strip():
        sys.exit(f"{root} has uncommitted changes: commit or stash them before landing")
    if not os.path.isdir(r["worktree"]):
        sys.exit(f"Dispatch #{a.n}'s Worktree is gone ({r['worktree']})")
    if git("status", "--porcelain", "--untracked-files=no", cwd=r["worktree"]).stdout.strip():
        sys.exit("the Worktree has uncommitted changes: commit the accepted files there and revert the rest")
    commits = git("rev-list", "--reverse", f"{r['base']}..{r['branch']}", cwd=root).stdout.split()
    if not commits:
        print(f"nothing to land: no commits on {r['branch']} since {r['base'][:9]}")
        return 1
    if git("cherry-pick", *commits, cwd=root, check=False).returncode != 0:
        git("cherry-pick", "--abort", cwd=root, check=False)
        record_outcome(a.n, "conflict")
        print(f"CONFLICT landing #{a.n} on {r['run_branch']}: aborted, the run branch is unchanged and the "
              f"Worktree is kept. pi-dispatch.py drop {a.n}, then re-Dispatch the Ticket from the current HEAD.")
        return 3
    remove_worktree(root, r["worktree"], r["branch"])
    head = git("rev-parse", "--short", "HEAD", cwd=root).stdout.strip()
    record_outcome(a.n, "landed", commits=len(commits), head=head)
    print(f"LANDED #{a.n}: {len(commits)} commit(s) on {r['run_branch']}, now {head}; Worktree removed. "
          f"Run the toolchain here; if it fails: git reset --hard HEAD~{len(commits)}")
    return 0


def cmd_drop(a):
    root = repo_root()
    os.chdir(root)
    r = find_row(a.n)
    remove_worktree(root, r["worktree"], r["branch"])
    record_outcome(a.n, "dropped")
    print(f"dropped #{a.n}: {r['worktree']} and {r['branch']}")
    return 0


def cmd_clean(a):
    root = repo_root()
    os.chdir(root)
    base = worktree_base(root)
    busy = {number(f) for f in glob.glob(os.path.join(HYBRID, "running", "*.pid")) if live_pid(f)}
    dropped = 0
    for block in git("worktree", "list", "--porcelain", cwd=root).stdout.strip().split("\n\n"):
        f = dict(line.split(" ", 1) for line in block.splitlines() if " " in line)
        path, branch = f.get("worktree", ""), f.get("branch", "")
        if path.startswith(base + os.sep) and number(path) not in busy:
            remove_worktree(root, path, branch[len("refs/heads/"):] if branch.startswith("refs/heads/") else None)
            record_outcome(number(path), "dropped", by="clean")
            dropped += 1
    git("worktree", "prune", cwd=root, check=False)
    print(f"dropped {dropped} Worktree(s); {len(busy)} Dispatch(es) still running")
    return 0


def cmd_ledger(a):
    os.chdir(repo_root())
    ledger = os.path.join(HYBRID, "dispatches.jsonl")
    if not os.path.exists(ledger):
        print("no Dispatches yet"); return 0
    outcomes = os.path.join(HYBRID, "outcomes.jsonl")
    fate = {o["n"]: o["outcome"] for o in map(json.loads, open(outcomes))} if os.path.exists(outcomes) else {}
    print("| # | Ticket | wall | calls | tools | think | out | ctx max | compactions | ended | outcome |")
    print("|---|---|---|---|---|---|---|---|---|---|---|")
    for line in open(ledger):
        r = json.loads(line)
        print(f"| {r['n']} | {r['ticket']} | {r['wall_s']:.0f} s | {r['turns']} | {r['tool_calls']} | "
              f"{r['thinking_tokens_est'] / 1000:.1f}K | {r['output_tokens'] / 1000:.1f}K | {r['ctx_max'] / 1000:.1f}K | "
              f"{r['compactions']} | {r['ended']} | {fate.get(r['n'], '')} |")
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("init"); p.add_argument("--branch"); p.set_defaults(fn=cmd_init)
    p = sub.add_parser("dispatch"); p.add_argument("ticket")
    p.add_argument("--max-turns", type=int, default=40); p.add_argument("--timeout", type=int, default=1200)
    p.add_argument("--result-chars", type=int, default=4000); p.set_defaults(fn=cmd_dispatch)
    p = sub.add_parser("land"); p.add_argument("n", type=int); p.set_defaults(fn=cmd_land)
    p = sub.add_parser("drop"); p.add_argument("n", type=int); p.set_defaults(fn=cmd_drop)
    p = sub.add_parser("clean"); p.set_defaults(fn=cmd_clean)
    p = sub.add_parser("ledger"); p.set_defaults(fn=cmd_ledger)
    a = ap.parse_args()
    sys.exit(a.fn(a))


if __name__ == "__main__":
    main()
