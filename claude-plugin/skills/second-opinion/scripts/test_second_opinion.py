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

    def review_of(self, lines):
        """(stdout JSON, stderr, run.json) of a Review of a Diff adding `lines` code lines."""
        self.write("big.go", "".join(f"line {n}\n" for n in range(lines)).encode())
        proc = subprocess.run([sys.executable, SCRIPT, "review", "diff", "--intent", "test"], cwd=self.repo,
                              env=self.env, capture_output=True, text=True)
        result = json.loads(proc.stdout)
        return result, proc.stderr, json.load(open(os.path.join(result["run"], "run.json")))

    def test_a_diff_over_the_large_limit_warns_on_stderr_and_is_flagged_in_run_json(self):
        result, err, meta = self.review_of(401)
        self.assertIn("per commit", err)
        self.assertIs(meta.get("large_diff"), True)
        self.assertEqual(result["status"], "ok")

    def test_a_diff_at_the_large_limit_does_not(self):
        result, err, meta = self.review_of(400)
        self.assertNotIn("per commit", err)
        self.assertNotIn("large_diff", meta)
        self.assertEqual(result["status"], "ok")

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

    def commit_bodies(self, names, lines=60):
        for name in names:
            os.makedirs(os.path.dirname(os.path.join(self.repo, name)) or self.repo, exist_ok=True)
            self.write(name, b"".join(b"%s line %d\n" % (name.encode(), n) for n in range(lines)))
        self.git("add", "-A")
        self.git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "base")

    def rename_and_edit(self, src, dst):
        os.makedirs(os.path.dirname(os.path.join(self.repo, dst)) or self.repo, exist_ok=True)
        self.git("mv", src, dst)
        with open(os.path.join(self.repo, dst), "ab") as f:
            f.write(b"added one\nadded two\n")

    def test_a_renamed_and_edited_doc_counts_no_code_lines(self):
        self.commit_bodies(["docs/a.md"])
        self.rename_and_edit("docs/a.md", "docs/b.md")
        self.write("main.go", b"package main\n")
        code, result = self.review("--auto")
        self.assertEqual(result["code_lines"], 1, result)
        self.assertEqual(result["code_files"], ["main.go"])

    def test_a_renamed_and_edited_code_file_still_counts_its_changed_lines(self):
        self.commit_bodies(["pkg/a.go"])
        self.rename_and_edit("pkg/a.go", "pkg/b.go")
        code, result = self.review()
        self.assertEqual(result["code_lines"], 2, result)
        self.assertEqual(result["code_files"], ["pkg/b.go"])

    def test_a_rename_across_kinds_is_judged_by_its_destination(self):
        self.commit_bodies(["a.go", "b.md"])
        self.rename_and_edit("a.go", "a.md")  # code -> doc: no code
        self.rename_and_edit("b.md", "b.go")  # doc -> code: counts
        code, result = self.review()
        self.assertEqual(result["code_files"], ["b.go"])
        self.assertEqual(result["code_lines"], 2, result)

    def test_paths_with_spaces_and_arrows_are_judged_by_their_extension(self):
        names = ["my docs/a => b.md", "my docs/x {y => z}.go", "tab\there.md"]
        self.commit_bodies(names)
        self.rename_and_edit("my docs/a => b.md", "my docs/c => d.md")
        self.rename_and_edit("my docs/x {y => z}.go", "my docs/p {q => r}.go")
        code, result = self.review()
        self.assertEqual(result["code_files"], ["my docs/p {q => r}.go"])
        self.assertEqual(result["code_lines"], 2, result)

    def test_code_lines_equal_the_sum_over_code_destinations(self):
        rng = random.Random(39)
        exts = [".go", ".py", ".sh", ".md", ".txt", ".json", ".yaml"]
        for trial in range(6):
            with self.subTest(trial=trial):
                self.setUp()
                try:
                    stems = rng.sample(["a", "b c", "d => e", "{f}", "g-h", "i_j", "k"], 4)
                    pairs = [(f"d/{s}{rng.choice(exts)}", f"d/{s}2{rng.choice(exts)}") for s in stems]
                    self.commit_bodies([src for src, _ in pairs])
                    expected = 0
                    for src, dst in pairs:
                        self.rename_and_edit(src, dst)
                        if os.path.splitext(dst)[1] not in (".md", ".txt", ".json", ".yaml"):
                            expected += 2
                    code, result = self.review()
                    self.assertEqual(result["code_lines"], expected, (pairs, result))
                finally:
                    self.tearDown()

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
            entry = {"tree": tree, "base_tree": base_tree, "base": "x", "status": status, "code_lines": 0,
                     "run": None, "at": "2026-01-01T00:00:00Z"}
            if status is None:
                del entry["status"]
            f.write(json.dumps(entry) + "\n")

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

    def test_a_busy_shared_ledger_stays_fast_and_still_chains(self):
        import time
        trees = []
        for k in range(320):  # other branches' snapshots in the shared Ledger: real trees, none on this branch
            blob = subprocess.run(["git", "hash-object", "-w", "--stdin"], cwd=self.repo, env=self.env, check=True,
                                  input=f"package p{k}\n" * 30, capture_output=True, text=True).stdout.strip()
            trees.append(subprocess.run(["git", "mktree"], cwd=self.repo, env=self.env, check=True,
                                        input=f"100644 blob {blob}\tother{k}.go\n", capture_output=True,
                                        text=True).stdout.strip())
        for a, b in zip(trees, trees[1:]):
            self.ledger(a, b)
        for _ in range(5):
            self.ledger(*self.commit(5))
        started = time.monotonic()
        result = self.gate()
        self.assertLess(time.monotonic() - started, 3.0)
        self.assertEqual((result["required"], result["code_lines"]), (False, 0), result)

    def test_a_non_utf8_code_file_is_counted_never_exempted(self):
        # diff_stats skips it; the gate over-counts it, which can only deny
        with open(os.path.join(self.repo, "audio.go"), "wb") as f:
            f.write(b"\xff\xfe\n" + b"sample\n" * 40)
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "fixture")
        self.assertTrue(self.gate()["required"])

    def test_a_pure_rename_between_node_and_base_tree_still_links(self):
        first = self.commit(30)
        self.git("mv", "1-code.go", "moved.go")
        self.git("commit", "-q", "-m", "mv")
        self.ledger(*first)
        self.ledger(first[1], self.tree())  # reviewed through the rename
        self.assertEqual(self.gate()["required"], False)

    def test_an_entry_naming_a_missing_subtree_is_ignored_not_fatal(self):
        before, after = self.commit(30)
        fake = "0" * 40
        self.ledger(before, fake)
        self.assertTrue(self.gate()["required"])

    def test_an_entry_whose_snapshot_lost_an_irrelevant_subtree_is_ignored(self):
        before, after = self.commit(30)
        blob = subprocess.run(["git", "hash-object", "-w", "--stdin"], cwd=self.repo, env=self.env, check=True,
                              input="package g\n", capture_output=True, text=True).stdout.strip()
        sub = subprocess.run(["git", "mktree"], cwd=self.repo, env=self.env, check=True,
                             input=f"100644 blob {blob}\tx.go\n", capture_output=True, text=True).stdout.strip()
        snap = subprocess.run(["git", "mktree"], cwd=self.repo, env=self.env, check=True, capture_output=True,
                              text=True, input=(self.git("ls-tree", before) + f"\n040000 tree {sub}\tgone\n").lstrip()
                              ).stdout.strip()
        os.remove(os.path.join(self.repo, ".git", "objects", sub[:2], sub[2:]))
        self.ledger(before, snap)
        result = self.gate()
        self.assertEqual((result["required"], result["code_lines"]), (True, 30), result)

    def test_ledger_entries_with_non_hex_or_abbreviated_trees_are_ignored(self):
        before, after = self.commit(30)
        for bad in ("main", "HEAD^{tree}", after[:10], "deadbeef\nHEAD^{tree}"):
            self.ledger(before, bad)
            self.ledger(bad, after)
        self.assertTrue(self.gate()["required"])

    def test_a_submodule_bump_adds_no_code_lines(self):
        self.commit(5)
        self.git("update-index", "--add", "--cacheinfo", f"160000,{'a' * 40},vendor.go")
        self.git("commit", "-q", "-m", "bump")
        self.assertEqual(self.gate()["code_lines"], 5)

    def test_non_ascii_code_paths_are_counted(self):
        with open(os.path.join(self.repo, "\u00e9t\u00e9.go"), "w") as f:
            f.write("".join(f"x{i}\n" for i in range(30)))
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "na")
        self.assertEqual(self.gate()["code_lines"], 30)

    def test_an_orphan_branch_starts_from_the_empty_tree(self):
        self.git("checkout", "-q", "--orphan", "lonely")
        with open(os.path.join(self.repo, "a.go"), "w") as f:
            f.write("".join(f"x{i}\n" for i in range(30)))
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "orphan")
        result = self.gate()
        self.assertEqual((result["required"], result["code_lines"]), (True, 30), result)

    def test_untracked_valid_scratch_code_never_breaks_a_chain(self):
        # every snapshot carries scratch.go, no commit does
        base = self.tree()
        prev = base
        scratch = os.path.join(self.repo, "scratch.go")
        with open(scratch, "w") as f:
            f.write("".join(f"s{i}\n" for i in range(30)))
        for n in range(3):
            name = os.path.join(self.repo, f"f{n}.go")
            with open(name, "w") as f:
                f.write("".join(f"v{i}\n" for i in range(15)))
            self.git("add", "-A")
            snap_tree = self.git("write-tree")
            self.git("reset", "-q", "scratch.go")
            self.ledger(prev, snap_tree)
            self.git("commit", "-q", "-m", f"f{n}")
            prev = self.tree()
        result = self.gate()
        self.assertEqual((result["required"], result["code_lines"]), (False, 0), result)

    def test_a_large_tree_and_long_chain_stay_fast(self):
        import time
        for d in range(40):
            os.makedirs(os.path.join(self.repo, f"p{d}"))
            for f in range(50):
                with open(os.path.join(self.repo, f"p{d}", f"f{f}.go"), "w") as fh:
                    fh.write(f"package p\n// {d} {f}\n")
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "tree")
        self.git("branch", "-f", "main")
        for k in range(120):
            before = self.tree()
            with open(os.path.join(self.repo, f"p{k % 40}", f"f{k % 50}.go"), "a") as fh:
                fh.write("x\n")
            self.git("commit", "-qam", f"c{k}")
            self.ledger(before, self.tree(), "skipped")
        self.commit(25)
        started = time.monotonic()
        result = self.gate()
        self.assertLess(time.monotonic() - started, 3.0)
        self.assertEqual((result["required"], result["code_lines"]), (True, 25), result)

    def test_a_rename_chain_over_an_unreviewed_edit_is_an_accepted_gap(self):
        self.commit(30, "a.go")
        self.git("checkout", "-q", "main")
        self.git("merge", "-q", "--ff-only", "feat")
        self.git("checkout", "-q", "feat")
        a = [n for n in os.listdir(self.repo) if n.endswith("a.go")][0]
        before = self.tree()
        self.git("mv", a, "b.go")
        self.git("commit", "-q", "-m", "rename")
        self.ledger(before, self.tree())
        with open(os.path.join(self.repo, "b.go"), "a") as f:
            f.write("".join(f"edit {i}\n" for i in range(30)))
        self.git("commit", "-qam", "unreviewed edit")
        before = self.tree()
        self.git("mv", "b.go", "c.go")
        self.git("commit", "-q", "-m", "rename again")
        self.ledger(before, self.tree())
        result = self.gate()
        # Accepted gap, like swapped contents: the key sums blobs over the code paths of the merge-base and HEAD only,
        # so the middle path b.go is invisible and the two reviewed renames link. Tracking every path a commit
        # touched would instead block real work (see the debug-file test below).
        self.assertFalse(result["required"], result)

    def test_a_scratch_file_added_and_removed_by_a_reviewed_commit_stays_covered(self):
        self.ledger(*self.commit(30, "real1.go"))
        self.commit(30, "dbg.go")  # unreviewed, later removed again
        before = self.tree()
        for n in os.listdir(self.repo):
            if n.endswith("dbg.go"):
                self.git("rm", "-q", n)
        with open(os.path.join(self.repo, "real2.go"), "w") as f:
            f.write("".join(f"r {n}\n" for n in range(30)))
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "swap debug for real")
        self.ledger(before, self.tree())
        self.assertFalse(self.gate()["required"])

    def test_untracked_scratch_never_committed_still_covers(self):
        t = self.commit(30)
        self.ledger(*t)
        with open(os.path.join(self.repo, "scratch.go"), "w") as f:
            f.write("".join(f"s {i}\n" for i in range(40)))
        self.assertFalse(self.gate()["required"])

    def test_head_names_the_branch_to_judge_from_another_checkout(self):
        self.commit(30)
        self.git("checkout", "-q", "main")
        self.assertFalse(self.gate()["required"])  # main itself has no Diff
        result = self.gate("--head", "feat")
        self.assertTrue(result["required"], result)
        self.assertEqual(result["head"], "feat")

    def test_head_falls_back_to_the_remote_ref(self):
        self.commit(30)
        self.git("update-ref", "refs/remotes/origin/only", "feat")
        self.git("checkout", "-q", "main")
        self.assertTrue(self.gate("--head", "only")["required"])

    def test_an_owner_qualified_head_names_its_branch(self):
        self.commit(30)
        self.git("checkout", "-q", "main")
        result = self.gate("--head", "someone:feat")
        self.assertTrue(result["required"], result)
        self.assertEqual(result["head"], "feat")

    def test_an_unresolvable_head_judges_HEAD_and_says_so(self):
        self.commit(30)
        result = self.gate("--head", "not-pushed-yet")
        self.assertTrue(result["required"], result)
        self.assertIn("not-pushed-yet", result["reason"])
        self.assertIn("judged HEAD", result["reason"])

    def test_a_head_that_looks_like_a_flag_fails_open(self):
        self.commit(30)
        result = self.gate("--head=--weird")
        self.assertFalse(result["required"])
        self.assertIn("head", result["reason"])

    def test_a_reviewed_tree_stays_covered_after_an_abandoned_follow_up_review(self):
        t1 = self.commit(30)
        self.ledger(*t1)
        os.makedirs(os.path.join(self.repo, "tmp"), exist_ok=True)
        with open(os.path.join(self.repo, "1-code.go"), "a") as f:
            f.write("".join(f"more {i}\n" for i in range(40)))
        self.git("add", "-A")
        snap = self.git("write-tree")
        self.git("reset", "-q", "--hard")
        self.ledger(t1[1], snap)  # a pre-commit Review of work then thrown away
        result = self.gate()
        self.assertEqual((result["required"], result["code_lines"]), (False, 0), result)

    def test_a_stacked_branchs_review_does_not_uncover_the_base_branch(self):
        t1 = self.commit(30)
        self.ledger(*t1)
        self.git("checkout", "-q", "-b", "stacked")
        self.commit(40)
        self.ledger(t1[1], self.tree())
        self.git("checkout", "-q", "feat")
        self.assertFalse(self.gate()["required"])

    def test_a_waiver_line_in_a_commit_message_does_not_bypass(self):
        self.commit(30)
        self.git("commit", "-q", "--allow-empty", "-m", "fix\n\nsecond-opinion waiver: the user accepted it")
        self.assertTrue(self.gate()["required"])

    def test_an_entry_ending_at_head_but_based_on_a_foreign_tree_does_not_count(self):
        # a foreign tree that differs from the start tree in a code path that matters (the start tree's own file)
        self.git("checkout", "-q", "main")
        with open(os.path.join(self.repo, "base.go"), "w") as f:
            f.write("".join(f"b{i}\n" for i in range(10)))
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "base")
        self.git("checkout", "-q", "-b", "feat2")
        self.commit(30)
        self.git("checkout", "-q", "-b", "side", "main")
        with open(os.path.join(self.repo, "base.go"), "w") as f:
            f.write("".join(f"other{i}\n" for i in range(40)))
        self.git("commit", "-qam", "foreign")
        foreign = self.tree()
        self.git("checkout", "-q", "feat2")
        self.ledger(foreign, self.tree())
        self.assertTrue(self.gate()["required"])

    def test_entries_without_a_known_status_are_ignored(self):
        self.ledger(*self.commit(30), status=None)
        self.assertTrue(self.gate()["required"])
        self.ledger(self.tree("main"), self.tree(), status="bogus")
        self.assertTrue(self.gate()["required"])

    def test_the_best_chain_end_is_reported_not_the_first_good_enough_one(self):
        self.commit(15)
        near = self.commit(15)[1]  # 10 lines short of the end
        far = self.commit(10)[1]
        start = self.tree("main")
        self.ledger(start, near)
        self.ledger(start, far)
        result = self.gate()
        self.assertEqual((result["required"], result["code_lines"], result["chain_end"]), (False, 0, far))

    def test_a_local_base_is_used_when_there_is_no_origin_and_master_is_found_without_a_name(self):
        self.git("branch", "-m", "main", "master")
        self.commit(30)
        code, result = run_script(self.repo, self.env, "gate")
        self.assertEqual((code, result["required"], result["base"]), (0, True, "master"))

    def test_the_remote_branch_beats_a_stale_local_one(self):
        self.commit(30)
        self.git("update-ref", "refs/remotes/origin/main", self.git("rev-parse", "main"))
        self.git("branch", "-f", "main", "HEAD")  # a local main that already holds the work
        result = self.gate()
        self.assertEqual((result["required"], result["base"]), (True, "origin/main"))

    def test_origin_head_names_the_default_base(self):
        self.git("branch", "-m", "main", "trunk")
        self.commit(30)
        self.git("update-ref", "refs/remotes/origin/trunk", self.git("rev-parse", "trunk"))
        self.git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/trunk")
        code, result = run_script(self.repo, self.env, "gate")
        self.assertEqual((code, result["required"], result["base"]), (0, True, "origin/trunk"))

    def test_no_base_branch_at_all_fails_open_and_says_so(self):
        self.git("branch", "-m", "main", "trunk")
        self.commit(30)
        code, result = run_script(self.repo, self.env, "gate")
        self.assertEqual((code, result["required"]), (0, False))
        self.assertIn("no base branch", result["reason"])

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

    def test_per_commit_reviews_chain_through_untracked_scratch_files(self):
        with open(os.path.join(self.repo, "notes.txt"), "w") as f:
            f.write("scratch\n")  # untracked: every snapshot holds it, no commit does
        for n in range(3):
            name = f"file{n}.go"
            with open(os.path.join(self.repo, name), "w") as f:
                f.write("".join(f"v{i}\n" for i in range(15)))
            code, _ = self.review("--auto")
            self.assertEqual(code, 4)
            self.git("add", name)
            self.git("commit", "-q", "-m", name)
        self.assertEqual(len(self.entries()), 3)
        result = self.gate()
        self.assertEqual((result["required"], result["code_lines"]), (False, 0), result)

    def test_per_commit_reviews_chain_through_an_untracked_valid_scratch_file(self):
        with open(os.path.join(self.repo, "scratch.go"), "w") as f:
            f.write("".join(f"s{i}\n" for i in range(30)))  # untracked, valid code, in every snapshot
        for n in range(3):
            name = f"file{n}.go"
            with open(os.path.join(self.repo, name), "w") as f:
                f.write("".join(f"v{i}\n" for i in range(15)))
            code, _ = self.review("--auto")
            self.assertEqual(code, 0)  # 45 snapshot lines: a real (fake-Muse) Review, not an auto-skip
            self.git("add", name)
            self.git("commit", "-q", "-m", name)
        result = self.gate()
        self.assertEqual((result["required"], result["code_lines"]), (False, 0), result)

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
