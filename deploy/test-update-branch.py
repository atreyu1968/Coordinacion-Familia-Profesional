#!/usr/bin/env python3
"""Check the production branch guard in temporary repos, never on a live install."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SOURCE = (Path(__file__).parent / "update.sh").read_text()
GUARD_START = SOURCE.index("# BEGIN production branch guard")
GUARD_END = SOURCE.index("# END production branch guard.")
GUARD = SOURCE[GUARD_START:GUARD_END]
PULL = next(line for line in SOURCE.splitlines()
            if line.startswith("run_as_user ") and "git pull --ff-only" in line)


class ProductionBranchGuard(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.repo = self.root / "app"
        self.repo.mkdir()
        self.env = os.environ.copy()
        self.env.update(GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull,
                        APP_DIR=str(self.repo), SERVICE_USER="root")
        self.git("init", "-q", "-b", "main")
        (self.repo / "fixture").write_text("initial\n")
        self.git("add", "fixture")
        self.git("-c", "user.name=Fixture", "-c", "user.email=test@example.invalid",
                 "commit", "-qm", "Initial fixture")
        self.git("remote", "add", "origin", str(self.root / "remote.git"))

    def git(self, *args):
        result = subprocess.run(["git", "-C", str(self.repo), *args],
                                env=self.env, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.strip()

    def guard(self, suffix="", **overrides):
        return subprocess.run(["bash", "-euo", "pipefail", "-c", GUARD + suffix],
                              env={**self.env, **overrides}, capture_output=True,
                              text=True, timeout=10)

    def test_main_is_allowed_without_contacting_remote_or_reading_env(self):
        # origin deliberately does not exist on disk; preflight is local-only.
        self.assertEqual(self.guard().returncode, 0)
        self.assertFalse((self.repo / ".env").exists())

    def test_other_branch_stops_without_changing_branch_commits_or_files(self):
        self.git("switch", "-qc", "feature/example")
        (self.repo / "fixture").write_text("uncommitted\n")
        (self.repo / "local-only").write_text("keep\n")
        before = self.git("status", "--porcelain")
        head = self.git("rev-parse", "HEAD")
        result = self.guard('\nprintf REACHED')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('rama actual es "feature/example"', result.stderr)
        self.assertNotIn("REACHED", result.stdout)
        self.assertEqual(self.git("branch", "--show-current"), "feature/example")
        self.assertEqual(self.git("rev-parse", "HEAD"), head)
        self.assertEqual(self.git("status", "--porcelain"), before)
        self.assertEqual((self.repo / "fixture").read_text(), "uncommitted\n")
        self.assertEqual((self.repo / "local-only").read_text(), "keep\n")

    def test_detached_head_is_rejected(self):
        self.git("checkout", "--detach", "-q")
        result = self.guard()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("HEAD separado", result.stderr)

    def test_missing_origin_is_rejected(self):
        self.git("remote", "remove", "origin")
        result = self.guard()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Falta el remoto origin", result.stderr)

    def test_non_repository_is_rejected(self):
        outside = self.root / "outside"
        outside.mkdir()
        result = self.guard(APP_DIR=str(outside))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("repositorio válido", result.stderr)

    def test_guard_runs_as_service_user(self):
        binary = self.root / "bin"
        binary.mkdir()
        sudo = binary / "sudo"
        sudo.write_text('#!/bin/bash\n'
                        '[[ "$1" == "-u" && "$2" == "fixture-user" && "$3" == "-H" ]] || exit 99\n'
                        'shift 3\nexec "$@"\n')
        sudo.chmod(0o755)
        result = self.guard(SERVICE_USER="fixture-user",
                            PATH=str(binary) + os.pathsep + self.env["PATH"])
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_guard_precedes_settings_database_and_services_and_rechecks_before_pull(self):
        self.assertLess(GUARD_END, SOURCE.index('ENV_FILE="${APP_DIR}/.env"'))
        self.assertEqual(SOURCE.count("\nrequire_production_main\n"), 2)
        self.assertIn('require_production_main\n' + PULL, SOURCE)
        self.assertIn("git pull --ff-only origin main", PULL)

    def test_pull_uses_origin_main_even_with_other_upstream_and_refuses_divergence(self):
        remote = self.root / "remote.git"
        subprocess.run(["git", "init", "--bare", "-q", "--initial-branch=main", str(remote)],
                       env=self.env, check=True, capture_output=True, timeout=10)
        self.git("push", "-q", "origin", "main")
        self.git("switch", "-qc", "other")
        (self.repo / "wrong").write_text("do not deploy\n")
        self.git("add", "wrong")
        self.git("-c", "user.name=Fixture", "-c", "user.email=test@example.invalid",
                 "commit", "-qm", "Other branch")
        self.git("push", "-q", "origin", "other")
        self.git("switch", "-q", "main")
        self.git("branch", "--set-upstream-to=origin/other", "main")
        before = self.git("rev-parse", "HEAD")
        suffix = '\nrun_as_user() { bash -c "$*"; }\n' + PULL
        result = self.guard(suffix)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.git("rev-parse", "HEAD"), before)
        self.assertFalse((self.repo / "wrong").exists())

        # Create a remote main which diverges from the server's local main.
        self.git("push", "-q", "origin", "other:main")
        (self.repo / "local").write_text("keep local commit\n")
        self.git("add", "local")
        self.git("-c", "user.name=Fixture", "-c", "user.email=test@example.invalid",
                 "commit", "-qm", "Local main")
        local_head = self.git("rev-parse", "HEAD")
        result = self.guard(suffix)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.git("rev-parse", "HEAD"), local_head)
        self.assertFalse((self.repo / "wrong").exists())
        self.assertEqual((self.repo / "local").read_text(), "keep local commit\n")


if __name__ == "__main__":
    unittest.main()
