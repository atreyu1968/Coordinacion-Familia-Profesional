#!/usr/bin/env python3
"""Exercise only the updater's optional settings; never run an update or read .env."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SOURCE = (Path(__file__).parent / "update.sh").read_text()
SETTINGS = SOURCE[
    SOURCE.index('MOBILE_WEB_URL="${'):
    SOURCE.index("is_tty()")
]
KEYS = ("MOBILE_WEB_URL", "PUBLIC_APP_URL", "LETSENCRYPT_EMAIL", "API_PORT", "DOMAIN")


class OptionalUpdateSettings(unittest.TestCase):
    def read_settings(self, content, **overrides):
        env = os.environ.copy()
        for key in (*KEYS, "PORT"):
            env.pop(key, None)
        env.update(overrides)
        with tempfile.TemporaryDirectory() as directory:
            fixture = Path(directory) / "fixture.env"
            fixture.write_text(content)
            env["ENV_FILE"] = str(fixture)
            result = subprocess.run(
                ["bash", "-euo", "pipefail", "-c",
                 SETTINGS + '\nprintf "%s\\n" "$MOBILE_WEB_URL" "$PUBLIC_APP_URL" '
                 '"$LETSENCRYPT_EMAIL" "$API_PORT" "$DOMAIN"\n'],
                env=env, capture_output=True, text=True, timeout=10,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(fixture.read_text(), content)
            return result.stdout.splitlines()

    def test_all_optional_keys_absent(self):
        self.assertEqual(self.read_settings(""), ["", "", "", "3001", ""])

    def test_old_install_with_public_url_only(self):
        self.assertEqual(
            self.read_settings("PUBLIC_APP_URL=https://example.test\n"),
            ["", "https://example.test", "", "3001", ""],
        )

    def test_configured_values(self):
        self.assertEqual(
            self.read_settings(
                "MOBILE_WEB_URL=https://example.test/app\n"
                "PUBLIC_APP_URL=https://example.test\n"
                "LETSENCRYPT_EMAIL=admin@example.test\nPORT=4001\n"
            ),
            ["https://example.test/app", "https://example.test",
             "admin@example.test", "4001", ""],
        )

    def test_explicit_overrides_win(self):
        self.assertEqual(
            self.read_settings(
                "PUBLIC_APP_URL=https://old.example.test\n",
                PUBLIC_APP_URL="https://new.example.test",
                MOBILE_WEB_URL="https://new.example.test/app",
                LETSENCRYPT_EMAIL="admin@example.test",
                DOMAIN="new.example.test",
            ),
            ["https://new.example.test/app", "https://new.example.test",
             "admin@example.test", "3001", "new.example.test"],
        )


if __name__ == "__main__":
    unittest.main()
