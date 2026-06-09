---
name: Document/file upload submissions security
description: Rules for accepting client-supplied object-storage paths in submissions (document-forms feature)
---

# Accepting client-supplied object paths

When a submission stores a file by trusting a client-provided `objectPath` (presigned-upload flow), the server MUST bind that object to the caller before persisting it.

**Why:** the download route authorizes by *submission ownership* (owner-or-manager). Without binding, a user could attach an object they don't own (path-reuse) and then download it via the owner path — broken object-level authorization.

**How to apply:** at submit time, for each file value: load the object (404 if missing), read its ACL policy; if it already has an `owner` that isn't the caller → reject 403; if it has no owner → set ACL `{ owner: String(caller.id), visibility: "private" }`. This is idempotent on resubmit (owner already matches). Do storage I/O *before* the DB transaction.

# Submission value integrity
- Reject duplicate `fieldId`s in one submission payload AND build the insert rows from the de-duplicated map, not the raw request array. Validating a map but inserting the raw array lets duplicates slip through. (surveys route already rejects duplicates — mirror it.)

# Province/role scoping consistency
- Keep coordinator scope identical across list-submissions, delete, and file-download: coordinators manage only forms pinned to their own province; global forms (provinceId null) are superadmin-managed. Owners can still download their own files via the owner check. A null-province "manager" allowance on one route but not others is an inconsistency bug.
