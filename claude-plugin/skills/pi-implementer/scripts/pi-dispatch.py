#!/usr/bin/env python3
"""The non-judgement half of a Hybrid run: run one Dispatch of a Ticket through pi + pi-vcc under caps
and record what happened. The Orchestrator (the Claude Code session using the pi-implementer skill)
writes the Ticket, reads the result, runs the Gate and decides; this script only runs and records.

Usage (from the repo root):
  pi-dispatch.py init [--branch hybrid/<slug>]        .hybrid/ layout, .git/info/exclude entry, ledger header, branch
  pi-dispatch.py dispatch TICKET.md [--max-turns 40] [--timeout 1200] [--result-chars 4000]
                                                     copy the Ticket to .hybrid/TICKET.md, run pi on a pointer prompt,
                                                     log to .hybrid/logs/NN-<ticket>.jsonl, append .hybrid/dispatches.jsonl
  pi-dispatch.py ledger                               the Dispatch table from .hybrid/dispatches.jsonl

Exit status of dispatch: 0 = pi finished on its own with no error; 1 = error, timeout or turn cap (the partial
work is still on disk — the Gate decides what it is worth).

pi has no --max-turns, so its JSON event stream is read live and the whole process group is killed after
max_turns API calls or at the timeout; either way the log is kept. Thinking arrives as text without a token
count from the Server, so thinking tokens are estimated by splitting the exact output count by characters.
Python 3.8+, stdlib only.
"""
import argparse, json, os, shutil, signal, subprocess, sys, threading, time

HERE = os.path.dirname(os.path.abspath(__file__))
PI = os.path.join(HERE, "pi-implementer")
HYBRID = ".hybrid"
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


def repo_root():
    try:
        return subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip()
    except subprocess.CalledProcessError:
        sys.exit("not inside a git repository: the skill needs one (git init first)")


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
          + (f", on branch {a.branch}" if a.branch else ""))
    return 0


def run_pi(cwd, prompt, log_path, timeout, max_turns):
    sessions = os.path.abspath(os.path.join(HYBRID, "pi-sessions"))  # pi resolves it against cwd
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
    name = os.path.splitext(os.path.basename(ticket))[0]
    shutil.copyfile(ticket, os.path.join(HYBRID, "TICKET.md"))
    ledger = os.path.join(HYBRID, "dispatches.jsonl")
    n = sum(1 for _ in open(ledger)) + 1 if os.path.exists(ledger) else 1
    log = os.path.join(HYBRID, "logs", f"{n:02d}-{name}.jsonl")
    size = os.path.getsize(ticket)
    print(f"dispatch #{n} {name}: max-turns {a.max_turns}, timeout {a.timeout}s, ticket {size} bytes", flush=True)
    m = run_pi(root, UNATTENDED + POINTER, log, a.timeout, a.max_turns)
    row = {"n": n, "ticket": name, "ticket_bytes": size, "max_turns": a.max_turns, "timeout": a.timeout,
           "started": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(time.time() - m["wall_s"])),
           "ended": ended(m), "log": log, **m}
    with open(ledger, "a") as f:
        f.write(json.dumps(row) + "\n")
    if m["slept_s"] > 5:
        print(f"WARNING: the machine slept for {m['slept_s']:.0f}s during this Dispatch", flush=True)
    print(f"{ended(m).upper()} {m['wall_s']:.0f}s  calls={m['turns']} tools={m['tool_calls']} "
          f"think≈{m['thinking_tokens_est']}tok out={m['output_tokens']} ctx_max={m['ctx_max']} "
          f"compactions={m['compactions']}+{m['compaction_errors']}err length_stops={m['length_stops']}")
    print(f"log: {log}")
    print("--- result ---")
    print(m["result"][: a.result_chars] + ("…" if len(m["result"]) > a.result_chars else ""))
    return 0 if ended(m) == "finished" else 1


def cmd_ledger(a):
    os.chdir(repo_root())
    ledger = os.path.join(HYBRID, "dispatches.jsonl")
    if not os.path.exists(ledger):
        print("no Dispatches yet"); return 0
    print("| # | Ticket | wall | calls | tools | think | out | ctx max | compactions | ended |")
    print("|---|---|---|---|---|---|---|---|---|---|")
    for line in open(ledger):
        r = json.loads(line)
        print(f"| {r['n']} | {r['ticket']} | {r['wall_s']:.0f} s | {r['turns']} | {r['tool_calls']} | "
              f"{r['thinking_tokens_est'] / 1000:.1f}K | {r['output_tokens'] / 1000:.1f}K | {r['ctx_max'] / 1000:.1f}K | "
              f"{r['compactions']} | {r['ended']} |")
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("init"); p.add_argument("--branch"); p.set_defaults(fn=cmd_init)
    p = sub.add_parser("dispatch"); p.add_argument("ticket")
    p.add_argument("--max-turns", type=int, default=40); p.add_argument("--timeout", type=int, default=1200)
    p.add_argument("--result-chars", type=int, default=4000); p.set_defaults(fn=cmd_dispatch)
    p = sub.add_parser("ledger"); p.set_defaults(fn=cmd_ledger)
    a = ap.parse_args()
    sys.exit(a.fn(a))


if __name__ == "__main__":
    main()
