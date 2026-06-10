---
name: Bash domain/regex validation depends on locale
description: Why deploy scripts validate domains with `LC_ALL=C grep`, not bash `=~`
---

When validating a hostname/domain in the deploy shell scripts (`deploy/install.sh`,
`deploy/update.sh`), match with `LC_ALL=C grep -qE '...'`, NOT a bash `[[ ... =~ ... ]]`
test.

**Why:** under a UTF-8 locale, the bracket range `[a-z]` is interpreted by collation,
so accented UTF-8 letters (e.g. `ó` in `coordinción.iesmmg.org`) fall *inside* the
range and pass validation. This silently let an invalid (accented) domain through,
which then broke nginx/certbot later in confusing ways. `LC_ALL=C` forces byte-wise
ranges so only true ASCII `a-z`/`0-9` match.

**How to apply:** any future hostname/identifier validation in shell here should use
the shared `clean_domain` helper in `deploy/update.sh` (trim ends + lowercase, then
`LC_ALL=C grep` for `^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+...$`). Trim leading/trailing
whitespace with `sed`, but do NOT `tr -d '[:space:]'` — that silently rewrites input
with internal spaces instead of rejecting the typo.
