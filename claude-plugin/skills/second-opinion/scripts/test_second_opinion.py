"""Contract tests for second-opinion.py, run against a throwaway repo and a fake `muse` on PATH.

  python3 -m unittest discover -s claude-plugin/skills/second-opinion/scripts
"""
import json, os, random, subprocess, sys, tempfile, unittest

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "second-opinion.py")

# Answers like `muse exec --json`: one terminal record whose text is an empty Findings list.
FAKE_MUSE = """#!/bin/sh
[ "$1" = "--version" ] && { echo "muse 0.0.0-fake"; exit 0; }
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


if __name__ == "__main__":
    unittest.main()
