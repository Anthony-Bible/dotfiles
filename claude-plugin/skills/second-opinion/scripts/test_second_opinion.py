"""Contract tests for second-opinion.py, run against a throwaway repo and a fake `muse` on PATH.

  python3 -m unittest discover -s claude-plugin/skills/second-opinion/scripts
"""
import json, os, random, subprocess, sys, tempfile, unittest

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "second-opinion.py")

# Answers like `muse exec --json`: one terminal record whose text is the Findings answer in $FAKE_MUSE_ANSWER
# (a file holding the whole terminal record), or an empty Findings list.
FAKE_MUSE = """#!/bin/sh
[ "$1" = "--version" ] && { echo "muse 0.0.0-fake"; exit 0; }
[ -n "$FAKE_MUSE_ANSWER" ] && { cat "$FAKE_MUSE_ANSWER"; exit 0; }
echo '{"payload_type": "run.terminal.completed", "payload": {"terminal": "completed", "text": "{\\"findings\\": []}"}}'
"""


class ReviewDiff(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = os.path.join(self.tmp.name, "repo")
        bin_dir = os.path.join(self.tmp.name, "bin")
        os.makedirs(bin_dir)
        muse = os.path.join(bin_dir, "muse")
        with open(muse, "w") as f:
            f.write(FAKE_MUSE)
        os.chmod(muse, 0o755)
        self.env = dict(os.environ, PATH=bin_dir + os.pathsep + os.environ["PATH"], META_API_KEY="fake",
                        GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_SYSTEM=os.devnull)
        os.makedirs(self.repo)
        self.git("init", "-q")
        self.git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init")

    def tearDown(self):
        self.tmp.cleanup()

    def git(self, *args):
        subprocess.run(["git", *args], cwd=self.repo, env=self.env, check=True, capture_output=True)

    def write(self, path, data):
        with open(os.path.join(self.repo, path), "wb") as f:
            f.write(data)

    def review(self, *args):
        proc = subprocess.run([sys.executable, SCRIPT, "review", "diff", "--intent", "test", *args], cwd=self.repo,
                              env=self.env, capture_output=True, text=True)
        return proc.returncode, json.loads(proc.stdout)

    def write_fixtures(self, count):
        # No NUL byte, so git treats them as text and puts the raw bytes in the Diff (issue #28)
        rng = random.Random(28)
        names = []
        for i in range(count):
            blob = bytes(rng.choice(range(1, 256)) for _ in range(rng.randint(1, 400))) + b"\xff\xfe\n"
            names.append(f"fixture{i}.ulaw")
            self.write(names[-1], blob)
        return names

    def prompt(self, result):
        with open(os.path.join(result["run"], "turn1.prompt.md"), encoding="utf-8") as f:
            return f.read()

    def test_non_utf8_files_are_named_but_their_bytes_stay_out_of_the_diff(self):
        fixtures = self.write_fixtures(20)
        self.write("main.go", b"package main\n" + b"".join(b"var v%d = %d\n" % (n, n) for n in range(30)))
        self.write("notes.go", "package main\n\n// héllo ✓ — UTF-8 that is not ASCII\n".encode())
        code, result = self.review("--auto")
        self.assertEqual(code, 0, result)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(sorted(result["omitted"]), sorted(fixtures))
        self.assertEqual(sorted(result["code_files"]), ["main.go", "notes.go"])
        prompt = self.prompt(result)
        for name in fixtures:
            self.assertIn(name, prompt)
        self.assertNotIn("�", prompt)
        self.assertIn("var v29 = 29", prompt)
        self.assertIn("héllo ✓", prompt)

    def test_a_utf8_diff_reaches_the_reviewer_unchanged(self):
        # every kind of file pair git can list, so the per-file split lines up with --numstat
        body = b"".join(b"line %d\n" % n for n in range(40))
        for name in ("moved.go", "gone.go", "mode.sh", "edited.go"):
            self.write(name, body)
        self.git("add", "-A")
        self.git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "base")
        self.git("mv", "moved.go", "renamed.go")
        os.remove(os.path.join(self.repo, "gone.go"))
        os.chmod(os.path.join(self.repo, "mode.sh"), 0o755)
        self.write("edited.go", body + "// diff --git a/x b/x — looks like a header, is not one\n".encode())
        self.write("with space.go", b"package main\n")
        self.write("real.bin", b"\x00\x01\xff")
        code, result = self.review()
        self.assertEqual(code, 0, result)
        self.assertEqual(result["omitted"], [])
        expected = subprocess.run(["git", "diff", result["base"], result["snapshot"]], cwd=self.repo, env=self.env,
                                  capture_output=True, text=True, check=True).stdout.strip()
        self.assertIn("```diff\n" + expected + "\n```", self.prompt(result))

    def test_non_utf8_lines_do_not_count_toward_the_auto_threshold(self):
        self.write_fixtures(20)  # hundreds of "lines" between them
        self.write("main.go", b"package main\n")
        code, result = self.review("--auto")
        self.assertEqual(code, 4, result)
        self.assertEqual(result["status"], "skipped")
        self.assertEqual(result["code_files"], ["main.go"])
        self.assertEqual(result["code_lines"], 1)

    def test_invalid_utf8_in_a_plan_still_reaches_the_reviewer(self):
        self.write("PLAN.md", b"# Plan\n\nStore the \xff\xfe marker, then ship.\n")
        proc = subprocess.run([sys.executable, SCRIPT, "review", "plan", "PLAN.md"], cwd=self.repo, env=self.env,
                              capture_output=True, text=True)
        result = json.loads(proc.stdout)
        self.assertEqual(proc.returncode, 0, result)
        with open(os.path.join(result["run"], "turn1.prompt.md"), encoding="utf-8") as f:
            self.assertIn("then ship.", f.read())

    def answer_with(self, findings):
        path = os.path.join(self.tmp.name, "answer.jsonl")
        record = {"payload_type": "run.terminal.completed",
                  "payload": {"terminal": "completed", "text": json.dumps({"findings": findings})}}
        with open(path, "w") as f:
            f.write(json.dumps(record) + "\n")
        self.env["FAKE_MUSE_ANSWER"] = path

    def test_every_non_nit_severity_reaches_the_author_and_only_bugs_and_risks_block(self):
        severities = ["bug", "risk", "test-gap", "design", "nit", "nit"]
        self.answer_with([{"file": "main.go", "line": i, "section": None, "severity": sev, "claim": f"claim {i}",
                           "evidence": "e", "failure_scenario": "f"} for i, sev in enumerate(severities, 1)])
        self.write("main.go", b"package main\n")
        code, result = self.review()
        self.assertEqual(code, 0, result)
        self.assertEqual(result["nits_dropped"], 2)
        self.assertEqual({f["severity"]: f["blocking"] for f in result["findings"]},
                         {"bug": True, "risk": True, "test-gap": False, "design": False})
        self.assertEqual([f["id"] for f in result["findings"]], [1, 2, 3, 4])  # ids stay rebuttable

    def test_a_severity_outside_the_schema_blocks_and_a_missing_one_does_not_crash(self):
        self.answer_with([{"file": "main.go", "line": 1, "section": None, "severity": "critical", "claim": "c",
                           "evidence": "e", "failure_scenario": "f"},
                          {"file": "main.go", "line": 2, "section": None, "claim": "no severity",
                           "evidence": "e", "failure_scenario": "f"}])
        self.write("main.go", b"package main\n")
        code, result = self.review()
        self.assertEqual(code, 0, result)
        self.assertEqual([f["blocking"] for f in result["findings"]], [True, True])

    def test_the_reviewer_is_told_every_severity_and_the_intent(self):
        self.write("main.go", b"package main\n")
        code, result = self.review()
        self.assertEqual(code, 0, result)
        prompt = self.prompt(result)
        self.assertIn("The Author's stated intent: test", prompt)
        with open(os.path.join(result["run"], "turn1.schema.json")) as f:
            schema = json.load(f)
        enum = schema["properties"]["findings"]["items"]["properties"]["severity"]["enum"]
        for sev in enum:
            self.assertIn(f'"{sev}"', prompt)
        self.assertNotIn("An empty list is the right answer", prompt)


def run_script(repo, env, *args):
    proc = subprocess.run([sys.executable, SCRIPT, *args], cwd=repo, env=env, capture_output=True, text=True)
    return proc.returncode, json.loads(proc.stdout)


class Repo(unittest.TestCase):
    """A throwaway repo on `main` with a feature branch checked out, and helpers to write Ledger lines."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = os.path.join(self.tmp.name, "repo")
        self.env = dict(os.environ, GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_SYSTEM=os.devnull,
                        GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@t", GIT_COMMITTER_NAME="t",
                        GIT_COMMITTER_EMAIL="t@t", HOME=self.tmp.name)
        os.makedirs(self.repo)
        self.git("init", "-q", "-b", "main")
        self.git("commit", "-q", "--allow-empty", "-m", "init")
        self.git("checkout", "-q", "-b", "feat")
        self.serial = 0

    def tearDown(self):
        self.tmp.cleanup()

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.repo, env=self.env, check=True, capture_output=True,
                              text=True).stdout.strip()

    def tree(self, rev="HEAD"):
        return self.git("rev-parse", rev + "^{tree}")

    def commit(self, lines, name="code.go"):
        """A commit that adds `lines` code lines in a fresh file; returns (tree before, tree after)."""
        before = self.tree()
        self.serial += 1
        with open(os.path.join(self.repo, f"{self.serial}-{name}"), "w") as f:
            f.write("".join(f"line {self.serial} {n}\n" for n in range(lines)))
        self.git("add", "-A")
        self.git("commit", "-q", "-m", f"c{self.serial}")
        return before, self.tree()

    def ledger_file(self):
        return os.path.join(self.repo, ".git", "second-opinion", "ledger.jsonl")

    def ledger(self, base_tree, tree, status="reviewed"):
        os.makedirs(os.path.dirname(self.ledger_file()), exist_ok=True)
        with open(self.ledger_file(), "a") as f:
            f.write(json.dumps({"tree": tree, "base_tree": base_tree, "base": "x", "status": status,
                                "code_lines": 0, "run": None, "at": "2026-01-01T00:00:00Z"}) + "\n")

    def gate(self, *args):
        code, result = run_script(self.repo, self.env, "gate", "--base", "main", *args)
        self.assertEqual(code, 0, result)
        return result


class Gate(Repo):
    def test_a_diff_below_the_threshold_is_never_required(self):
        self.commit(19)
        result = self.gate()
        self.assertFalse(result["required"])
        self.assertEqual(result["code_lines"], 19)

    def test_non_code_files_never_count(self):
        self.commit(500, "notes.md")
        self.assertFalse(self.gate()["required"])

    def test_an_unreviewed_diff_is_required(self):
        self.commit(25)
        result = self.gate()
        self.assertTrue(result["required"])
        self.assertEqual(result["code_lines"], 25)

    def test_a_whole_branch_review_covers_it(self):
        self.commit(15)
        self.commit(15)
        self.assertTrue(self.gate()["required"])
        self.ledger(self.tree("main"), self.tree())
        self.assertFalse(self.gate()["required"])

    def test_three_per_commit_reviews_chain_to_cover_the_branch(self):
        for _ in range(3):
            self.ledger(*self.commit(15))
        self.assertFalse(self.gate()["required"])

    def test_a_last_commit_without_an_entry_is_required(self):
        self.ledger(*self.commit(15))
        self.commit(25)
        result = self.gate()
        self.assertTrue(result["required"])
        self.assertEqual(result["code_lines"], 25)

    def test_a_small_fix_after_a_review_passes_and_a_large_one_does_not(self):
        self.ledger(*self.commit(30))
        self.commit(5)
        self.assertFalse(self.gate()["required"])
        self.commit(20)
        self.assertTrue(self.gate()["required"])

    def test_skipped_and_unavailable_entries_chain_like_reviewed_ones(self):
        self.ledger(*self.commit(10), status="skipped")
        self.ledger(*self.commit(15), status="unavailable")
        self.ledger(*self.commit(18), status="reviewed")
        self.assertFalse(self.gate()["required"])

    def test_an_entry_whose_tree_is_gone_is_ignored(self):
        self.commit(30)
        self.ledger(self.tree("main"), "0" * 40)
        self.assertTrue(self.gate()["required"])

    def test_garbage_ledger_lines_and_cycles_do_not_matter(self):
        before, after = self.commit(30)
        self.ledger(after, before)  # a cycle back to the start
        self.ledger(before, before)
        with open(self.ledger_file(), "a") as f:
            f.write("not json\n[1]\n{}\n")
        self.assertTrue(self.gate()["required"])

    def test_the_gate_writes_nothing(self):
        self.ledger(*self.commit(30))
        with open(self.ledger_file()) as f:
            ledger = f.read()
        refs, status = self.git("for-each-ref"), self.git("status", "--porcelain")
        self.gate()
        with open(self.ledger_file()) as f:
            self.assertEqual(f.read(), ledger)
        self.assertEqual((self.git("for-each-ref"), self.git("status", "--porcelain")), (refs, status))

    def test_an_unknown_base_or_a_non_repo_fails_open_with_json(self):
        self.commit(30)
        code, result = run_script(self.repo, self.env, "gate", "--base", "no-such-branch")
        self.assertEqual((code, result["required"]), (0, False))
        outside = os.path.join(self.tmp.name, "plain")
        os.makedirs(outside)
        env = dict(self.env, GIT_CEILING_DIRECTORIES=self.tmp.name)
        code, result = run_script(outside, env, "gate")
        self.assertEqual((code, result["required"]), (0, False))

    def test_property_commits_each_under_the_threshold_with_an_entry_always_pass(self):
        rng = random.Random(37)
        for _ in range(6):
            self.tearDown()
            self.setUp()
            try:
                for _ in range(rng.randint(1, 6)):
                    self.ledger(*self.commit(rng.randint(1, 19)))
                self.assertFalse(self.gate()["required"])
            finally:
                self.tearDown()

    def test_property_a_last_unreviewed_commit_of_the_threshold_or_more_is_required(self):
        rng = random.Random(38)
        for _ in range(6):
            self.tearDown()
            self.setUp()
            try:
                for _ in range(rng.randint(0, 4)):
                    self.ledger(*self.commit(rng.randint(1, 19)))
                size = rng.randint(20, 60)
                self.commit(size)
                result = self.gate()
                self.assertTrue(result["required"])
                self.assertEqual(result["code_lines"], size)
            finally:
                self.tearDown()


class Ledger(Repo):
    def setUp(self):
        super().setUp()
        bin_dir = os.path.join(self.tmp.name, "bin")
        os.makedirs(bin_dir)
        muse = os.path.join(bin_dir, "muse")
        with open(muse, "w") as f:
            f.write(FAKE_MUSE)
        os.chmod(muse, 0o755)
        self.env.update(PATH=bin_dir + os.pathsep + os.environ["PATH"], META_API_KEY="fake")

    def entries(self):
        if not os.path.exists(self.ledger_file()):
            return []
        with open(self.ledger_file()) as f:
            return [json.loads(line) for line in f]

    def review(self, *args, env=None):
        return run_script(self.repo, env or self.env, "review", "diff", "--intent", "t", *args)

    def write_code(self, lines):
        with open(os.path.join(self.repo, "new.go"), "w") as f:
            f.write("".join(f"v{n}\n" for n in range(lines)))

    def check_entry(self, entry, status, code_lines):
        self.assertEqual(set(entry), {"tree", "base_tree", "base", "status", "code_lines", "run", "at"})
        self.assertEqual(entry["status"], status)
        self.assertEqual(entry["code_lines"], code_lines)
        self.assertEqual(entry["base_tree"], self.tree())
        self.assertEqual(entry["base"], self.git("rev-parse", "HEAD"))

    def test_a_skip_writes_exactly_one_well_formed_line(self):
        self.write_code(3)
        code, result = self.review("--auto")
        self.assertEqual((code, result["status"]), (4, "skipped"))
        [entry] = self.entries()
        self.check_entry(entry, "skipped", 3)
        self.assertNotEqual(entry["tree"], entry["base_tree"])

    def test_no_changes_is_a_skip_entry_too(self):
        code, _ = self.review()
        self.assertEqual(code, 4)
        [entry] = self.entries()
        self.check_entry(entry, "skipped", 0)

    def test_a_review_writes_one_reviewed_line_and_the_gate_then_passes(self):
        self.write_code(30)
        code, result = self.review("--auto")
        self.assertEqual((code, result["status"]), (0, "ok"))
        [entry] = self.entries()
        self.check_entry(entry, "reviewed", 30)
        self.assertEqual(entry["run"], result["run"])
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "work")
        self.assertFalse(self.gate()["required"])

    def test_a_reviewer_error_writes_one_unavailable_line(self):
        failed = os.path.join(self.tmp.name, "failed.jsonl")
        with open(failed, "w") as f:
            f.write(json.dumps({"payload_type": "run.terminal.failed",
                                "payload": {"terminal": "failed", "reason": "boom"}}) + "\n")
        self.env["FAKE_MUSE_ANSWER"] = failed
        self.write_code(30)
        code, result = self.review()
        self.assertEqual((code, result["status"]), (3, "unavailable"))
        [entry] = self.entries()
        self.check_entry(entry, "unavailable", 30)
        self.assertEqual(entry["run"], result["run"])

    def test_an_early_unavailable_writes_one_line_and_outside_a_repo_none(self):
        self.write_code(30)
        env = {k: v for k, v in self.env.items() if k != "META_API_KEY"}
        code, result = self.review(env=env)  # HOME is empty: no Muse credentials
        self.assertEqual((code, result["status"]), (3, "unavailable"))
        [entry] = self.entries()
        self.check_entry(entry, "unavailable", 30)
        outside = os.path.join(self.tmp.name, "plain")
        os.makedirs(outside)
        code, result = run_script(outside, dict(env, GIT_CEILING_DIRECTORIES=self.tmp.name), "review", "diff")
        self.assertEqual((code, result["status"]), (3, "unavailable"))
        self.assertEqual(len(self.entries()), 1)

    def test_a_plan_review_writes_no_entry(self):
        with open(os.path.join(self.repo, "PLAN.md"), "w") as f:
            f.write("# Plan\n")
        code, _ = run_script(self.repo, self.env, "review", "plan", "PLAN.md")
        self.assertEqual(code, 0)
        self.assertEqual(self.entries(), [])

    def test_a_ledger_write_failure_changes_neither_exit_code_nor_output(self):
        self.write_code(3)
        os.makedirs(self.ledger_file())  # the ledger path is a directory: every append fails
        code, result = self.review("--auto")
        self.assertEqual((code, result["status"]), (4, "skipped"))


if __name__ == "__main__":
    unittest.main()
