---
name: Preflight for model-default upgrades
description: Safely migrate an intentional string-default change in an existing database.
---

When `deploy/db.sh migrate` handles an existing database, schema preflight runs before migration SQL and checks existing defaults strictly. If a supported release intentionally changes a string default, allow only the exact known previous value for that column during `--allow-missing-upgrade-columns` preflight. The migration must then set the new default, transform only explicitly supported old data values, and pass the final full schema verification.

**Why:** an intentional vision-model default upgrade was already encoded in migration SQL, but preflight rejected the prior default before that SQL could run, causing post-merge setup to stop without applying the migration.

**How to apply:** scope compatibility to the exact table, column, and old value; test both the old-default upgrade and preservation of custom values on an isolated existing database. Do not broadly accept arbitrary string defaults.
