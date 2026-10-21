#!/usr/bin/env python3
"""No Docker daemon, network, production credentials or existing install needed."""
import importlib.util
import json
import os
import pty
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("preflight", HERE / "preflight.py")
pf = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(pf)


class Inspection(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.env = self.directory / ".env"
        self.env.write_text("APP_DOMAIN=example.test\nPRIVATE_FIXTURE=must-not-appear\n")
        self.before = self.env.read_bytes()
        self.commands = []
        self.maintenance = False
        self.bad_http = False
        self.bad_wopi = False
        self.unhealthy = False

    def command(self, args):
        self.commands.append(args)
        if args[:2] == ["docker", "ps"]:
            return "existing"
        if "compose" in args and "ps" in args:
            return args[-1]
        if args[:2] == ["docker", "inspect"]:
            service = args[-1]
            source = "nextcloud:30-apache" if service == "nextcloud" else "collabora/code:25.04.1.2"
            return f"running|{'unhealthy' if self.unhealthy else ''}|sha256:fixture|{source}"
        if args[:3] == ["docker", "image", "inspect"]:
            return "nextcloud@sha256:fixture"
        if "status" in args:
            return json.dumps(self.status())
        if "app:list" in args:
            return json.dumps({"enabled": dict.fromkeys(("groupfolders", "user_oidc", "richdocuments"), "1.0")})
        if "config:app:get" in args:
            return ("http://wrong.test" if self.bad_wopi else "https://example.test/collabora")
        if "config:system:get" in args:
            return "https"
        raise AssertionError(f"Unexpected/mutating command: {args}")

    def status(self):
        return {"installed": True, "maintenance": self.maintenance, "needsDbUpgrade": False, "versionstring": "30.0.17"}

    def fetch(self, url):
        if self.bad_http and "https://" in url:
            raise OSError("fixture failure")
        if url.endswith("status.php"):
            return json.dumps(self.status())
        if url.endswith("discovery"):
            return "<wopi-discovery><net-zone /></wopi-discovery>"
        if url.endswith("capabilities"):
            return '{"productVersion":"25.04.1.2"}'
        if "openid-configuration" in url:
            return json.dumps({"issuer": "https://example.test/api/oidc", "authorization_endpoint": "https://example.test/api/oidc/auth", "token_endpoint": "https://example.test/api/oidc/token"})
        raise AssertionError(url)

    def inspect(self):
        with patch.object(pf, "command", side_effect=self.command), patch.object(pf, "fetch", side_effect=self.fetch):
            report = pf.inspect(self.directory, check_updates=False)
        self.assertEqual(self.before, self.env.read_bytes())
        self.assertNotIn("must-not-appear", json.dumps(report))
        return report

    def test_healthy_inspection_is_read_only(self):
        report = self.inspect()
        self.assertTrue(report["healthy"])
        self.assertEqual(len(report["pins"]), 4)
        self.assertEqual(report["versions"]["collabora"], "25.04.1.2")

    def test_maintenance_is_not_healthy(self):
        self.maintenance = True
        self.assertFalse(self.inspect()["healthy"])

    def test_public_https_failure_is_not_healthy(self):
        self.bad_http = True
        self.assertFalse(self.inspect()["healthy"])

    def test_wrong_office_configuration_is_not_healthy(self):
        self.bad_wopi = True
        self.assertFalse(self.inspect()["healthy"])

    def test_unhealthy_container_is_not_healthy(self):
        self.unhealthy = True
        self.assertFalse(self.inspect()["healthy"])

    def test_optional_public_wopi_value_does_not_trigger_repair(self):
        original = self.command
        def command(args):
            if args[-1] == "public_wopi_url":
                raise RuntimeError("Optional key absent")
            return original(args)
        self.command = command
        self.assertTrue(self.inspect()["healthy"])

    def test_working_legacy_local_paths_do_not_trigger_migration(self):
        original = self.fetch
        def fetch(url):
            if url.startswith("http://127.0.0.1:9980/collabora/"):
                raise OSError("Legacy local path is at root")
            return original(url)
        self.fetch = fetch
        report = self.inspect()
        self.assertTrue(report["healthy"])
        self.assertEqual(report["versions"]["collabora"], "25.04.1.2")

    def test_new_installation_is_distinct(self):
        self.env.unlink()
        with patch.object(pf, "command", return_value=""):
            self.assertFalse(pf.inspect(self.directory)["installed"])

    def test_docker_unavailable_never_means_new_install_when_env_exists(self):
        with patch.object(pf, "command", side_effect=OSError):
            report = pf.inspect(self.directory)
        self.assertTrue(report["installed"])
        self.assertFalse(report["healthy"])
        self.assertEqual(report["pins"], {})


class Releases(unittest.TestCase):
    def plan(self, nc_tags, co_tags, nc="30.0.17", co="25.04.1.2"):
        def fetch(url):
            tags = nc_tags if "library/nextcloud" in url else co_tags
            return json.dumps({"results": [{"name": tag} for tag in tags]})
        with patch.object(pf, "fetch", side_effect=fetch):
            return pf.update_plan(nc, co)

    def test_patch_updates_do_not_trigger_maintenance(self):
        updates, targets, _ = self.plan(["30.0.99-apache"], ["25.04.99.9"])
        self.assertEqual(updates, [])
        self.assertEqual(targets, {})

    def test_nextcloud_advances_only_one_major(self):
        updates, targets, _ = self.plan(["33.0.1-apache", "31.0.9-apache", "31.0.8-apache"], ["26.04.1.2"])
        self.assertEqual(targets["nextcloud"], "nextcloud:31.0.9-apache")
        self.assertEqual(updates[0]["available"], "33.0.1")
        self.assertEqual(targets["collabora"], "collabora/code:26.04.1.2")

    def test_nextcloud_missing_intermediate_never_skips_major(self):
        updates, targets, warnings = self.plan(["33.0.1-apache"], ["25.04.1.2"])
        self.assertTrue(updates)
        self.assertNotIn("nextcloud", targets)
        self.assertTrue(warnings)

    def test_prerelease_and_floating_tags_are_ignored(self):
        updates, _, _ = self.plan(["30.0.99-apache", "34.0.0-rc1-apache", "latest", "stable"], ["25.04.2.1", "27.04.0-beta", "latest"])
        self.assertFalse(updates)

    def test_network_failure_is_unknown_not_up_to_date(self):
        with patch.object(pf, "fetch", side_effect=OSError):
            updates, targets, warnings = pf.update_plan("30.0.17", "25.04.1.2")
        self.assertFalse(updates)
        self.assertFalse(targets)
        self.assertEqual(len(warnings), 2)

    def test_custom_images_are_not_replaced(self):
        with patch.object(pf, "fetch", side_effect=AssertionError("No registry lookup expected")):
            updates, targets, warnings = pf.update_plan("30.0.17", "25.04.1.2", {"nextcloud": "custom/nextcloud:30", "collabora": "custom/office:25"})
        self.assertFalse(updates)
        self.assertFalse(targets)
        self.assertEqual(len(warnings), 2)


class Decisions(unittest.TestCase):
    def decide(self, healthy=True, updates=None, targets=None, approve=None, pins=True, reply=None, malformed=False):
        report = {
            "installed": True, "healthy": healthy,
            "issues": [] if healthy else ["fixture unhealthy"],
            "warnings": [], "versions": {"nextcloud": "30.0.17", "collabora": "25.04.1.2"},
            "updates": updates or [], "targets": targets or {},
            "pins": {s: "sha256:fixture" for s in ("nextcloud", "nextcloud-db", "nextcloud-redis", "collabora")} if pins else {},
        }
        with tempfile.TemporaryDirectory() as temp:
            temp = Path(temp)
            (temp / "report.json").write_text("not-json" if malformed else json.dumps(report))
            wrapper = temp / "python3"
            wrapper.write_text('#!/usr/bin/env bash\nif [[ "${1##*/}" == preflight.py ]]; then cat "$REPORT_FILE"; else exec "$REAL_PYTHON" "$@"; fi\n')
            wrapper.chmod(0o755)
            env = dict(os.environ, PATH=f"{temp}:{os.environ['PATH']}", REPORT_FILE=str(temp / "report.json"),
                       REAL_PYTHON=os.sys.executable, HELPER=str(HERE / "preflight.sh"), DIR=str(HERE))
            env.pop("COLLAB_APPROVE_UPDATE", None)
            if approve is not None:
                env["COLLAB_APPROVE_UPDATE"] = approve
            args = ["bash", "-c", 'set -euo pipefail; SCRIPT_DIR="$DIR"; ENV_FILE="$DIR/.env"; source "$HELPER"; collab_preflight; printf "\\nRESULT:%s|%s|%s|%s\\n" "$COLLAB_SKIP" "$COLLAB_EXISTING" "$COLLAB_PULL_SERVICES" "${NEXTCLOUD_IMAGE:-unset}"']
            if reply is not None:
                master, slave = pty.openpty()
                try:
                    process = subprocess.Popen(args, env=env, stdin=slave, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                    os.close(slave)
                    slave = -1
                    os.write(master, reply.encode())
                    stdout, stderr = process.communicate(timeout=10)
                    self.assertEqual(process.returncode, 0, stderr)
                    return stdout + stderr
                finally:
                    os.close(master)
                    if slave != -1:
                        os.close(slave)
            result = subprocess.run(args, env=env, input="", capture_output=True, text=True, check=True)
            return result.stdout + result.stderr

    def test_healthy_is_untouched_even_with_approval(self):
        self.assertIn("RESULT:1|1||unset", self.decide(approve="yes"))

    def test_unhealthy_defaults_to_no_without_terminal(self):
        self.assertIn("RESULT:1|1||unset", self.decide(healthy=False))

    def test_major_update_defaults_to_no(self):
        update = [{"service": "nextcloud", "current": "30", "available": "31", "target": "31"}]
        self.assertIn("RESULT:1|1||unset", self.decide(updates=update, targets={"nextcloud": "nextcloud:31-apache"}))

    def test_decline_does_not_even_set_image_references(self):
        self.assertIn("RESULT:1|1||unset", self.decide(healthy=False, approve="no"))

    def test_approved_repair_pins_without_pulling(self):
        self.assertIn("RESULT:0|1||sha256:fixture", self.decide(healthy=False, approve="sí"))

    def test_approved_major_pulls_only_planned_service(self):
        update = [{"service": "nextcloud", "current": "30", "available": "33", "target": "31"}]
        self.assertIn("RESULT:0|1|nextcloud |nextcloud:31-apache", self.decide(updates=update, targets={"nextcloud": "nextcloud:31-apache"}, approve="yes"))

    def test_missing_pins_do_not_risk_downgrade(self):
        self.assertIn("RESULT:1|1||unset", self.decide(healthy=False, approve="yes", pins=False))

    def test_unsupported_major_does_not_reconfigure_healthy_install(self):
        update = [{"service": "nextcloud", "current": "30", "available": "33", "target": None}]
        self.assertIn("RESULT:1|1||unset", self.decide(updates=update, approve="yes"))

    def test_enter_in_real_terminal_declines_repair(self):
        output = self.decide(healthy=False, reply="\n")
        self.assertIn("¿Quieres actualizar o reparar", output)
        self.assertIn("RESULT:1|1||unset", output)

    def test_yes_in_real_terminal_authorizes_repair(self):
        output = self.decide(healthy=False, reply="sí\n")
        self.assertIn("¿Quieres actualizar o reparar", output)
        self.assertIn("RESULT:0|1||sha256:fixture", output)

    def test_healthy_real_terminal_does_not_ask(self):
        output = self.decide(reply="sí\n")
        self.assertNotIn("¿Quieres", output)
        self.assertIn("RESULT:1|1||unset", output)

    def test_major_update_asks_in_real_terminal(self):
        update = [{"service": "nextcloud", "current": "30", "available": "33", "target": "31"}]
        output = self.decide(updates=update, targets={"nextcloud": "nextcloud:31.0.9-apache"}, reply="sí\n")
        self.assertIn("¿Quieres actualizar o reparar", output)
        self.assertIn("RESULT:0|1|nextcloud |nextcloud:31.0.9-apache", output)

    def test_malformed_inspection_fails_closed(self):
        output = self.decide(malformed=True, approve="yes")
        self.assertIn("resultado inválido", output)
        self.assertIn("RESULT:1|0||unset", output)


if __name__ == "__main__":
    unittest.main()
