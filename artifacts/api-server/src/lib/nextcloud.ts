import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Nextcloud (Drive) + Collabora (editor) collaborative space integration.
//
// The app self-hosts Nextcloud + Collabora (Docker Compose, see deploy/) and
// integrates them so each academic module gets a private group folder. This
// module resolves the configuration (control panel DB values take precedence
// over environment variables, same pattern as JaaS), and exposes the OCS
// provisioning helpers used to create groups, group folders, users and
// memberships.
//
// Source of truth for users stays in this app: Nextcloud users are created on
// demand with a stable uid (`coordina-<id>`) and authenticate exclusively via
// OIDC (user_oidc). Their Nextcloud password is random and never used to log in.
// ---------------------------------------------------------------------------

export interface NextcloudSettings {
  nextcloudUrl?: string | null;
  collaboraUrl?: string | null;
  nextcloudAdminUser?: string | null;
  nextcloudAdminPassword?: string | null;
  nextcloudOidcClientId?: string | null;
  nextcloudOidcClientSecret?: string | null;
}

export interface NextcloudConfig {
  url: string;
  adminUser: string;
  adminPassword: string;
}

export interface NextcloudOidcClient {
  clientId: string;
  clientSecret: string;
}

function clean(v?: string | null): string {
  return (v || "").trim();
}

function stripTrailingSlash(v: string): string {
  return v.replace(/\/+$/, "");
}

/**
 * Resolve the Nextcloud admin connection used for OCS provisioning. The whole
 * triplet (url + admin user + admin password) must be present from a single
 * source; the two sources are never mixed. DB (control panel) wins, env is the
 * fallback for self-hosted setups. Returns null when not fully configured.
 */
export function resolveNextcloudConfig(
  s?: NextcloudSettings | null,
): NextcloudConfig | null {
  // Credentials: DB (control panel) wins as a complete triplet; env is the
  // self-hosted fallback. Sources are never mixed for the credentials.
  const base =
    pickConfig(
      s?.nextcloudUrl,
      s?.nextcloudAdminUser,
      s?.nextcloudAdminPassword,
    ) ??
    pickConfig(
      process.env["NEXTCLOUD_ADMIN_URL"] || process.env["NEXTCLOUD_URL"],
      process.env["NEXTCLOUD_ADMIN_USER"],
      process.env["NEXTCLOUD_ADMIN_PASSWORD"],
    );
  if (!base) return null;
  // Transport override: when NEXTCLOUD_ADMIN_URL is set, always use it as the
  // base for admin OCS calls — even if the credentials came from the DB. This
  // matters because env→DB seeding backfills the DB with the PUBLIC NEXTCLOUD_URL,
  // which (behind a reverse proxy / tunnel) may not route /ocs from inside the
  // host. A private, server-reachable URL (e.g. http://127.0.0.1:8081) keeps
  // admin traffic local. The public URL still drives browser/SSO links via
  // resolveNextcloudUrl().
  const adminUrl = stripTrailingSlash(clean(process.env["NEXTCLOUD_ADMIN_URL"]));
  return adminUrl ? { ...base, url: adminUrl } : base;
}

function pickConfig(
  urlRaw?: string | null,
  userRaw?: string | null,
  passRaw?: string | null,
): NextcloudConfig | null {
  const url = stripTrailingSlash(clean(urlRaw));
  const adminUser = clean(userRaw);
  const adminPassword = clean(passRaw);
  if (!url || !adminUser || !adminPassword) return null;
  return { url, adminUser, adminPassword };
}

/**
 * Public base URL of Nextcloud for iframe embedding. May be set even when admin
 * credentials are not, so the UI can still resolve the URL; falls back to env.
 */
export function resolveNextcloudUrl(s?: NextcloudSettings | null): string | null {
  const fromDb = stripTrailingSlash(clean(s?.nextcloudUrl));
  if (fromDb) return fromDb;
  const fromEnv = stripTrailingSlash(clean(process.env["NEXTCLOUD_URL"]));
  return fromEnv || null;
}

/**
 * Resolve the OIDC client credentials Nextcloud's user_oidc app uses to
 * authenticate against this app. All-or-nothing, DB-then-env.
 */
export function resolveNextcloudOidcClient(
  s?: NextcloudSettings | null,
): NextcloudOidcClient | null {
  const id = clean(s?.nextcloudOidcClientId);
  const secret = clean(s?.nextcloudOidcClientSecret);
  if (id && secret) return { clientId: id, clientSecret: secret };
  const envId = clean(process.env["NEXTCLOUD_OIDC_CLIENT_ID"]);
  const envSecret = clean(process.env["NEXTCLOUD_OIDC_CLIENT_SECRET"]);
  if (envId && envSecret) return { clientId: envId, clientSecret: envSecret };
  return null;
}

/**
 * The collaborative space is "configured" when both the Nextcloud admin
 * connection (for provisioning) and the OIDC client (for SSO) are present.
 */
export function isNextcloudConfigured(s?: NextcloudSettings | null): boolean {
  return (
    resolveNextcloudConfig(s) !== null && resolveNextcloudOidcClient(s) !== null
  );
}

// ---------------------------------------------------------------------------
// Stable naming
// ---------------------------------------------------------------------------

/** Stable Nextcloud uid for an app user. Must match the OIDC `sub` claim. */
export function nextcloudUid(userId: number): string {
  return `coordina-${userId}`;
}

/** Stable Nextcloud group id for a module. */
export function moduleGroupId(moduleId: number): string {
  return `coordina-mod-${moduleId}`;
}

/** Human-friendly group folder mount name for a module. */
export function moduleFolderName(opts: {
  moduleId: number;
  name: string;
  code?: string | null;
}): string {
  const label = opts.code ? `${opts.code} ${opts.name}` : opts.name;
  // Group Folders disallow "/" in mount names.
  return label.replace(/\//g, "-").trim() || `Módulo ${opts.moduleId}`;
}

// ---------------------------------------------------------------------------
// Access decision (pure, unit-tested)
// ---------------------------------------------------------------------------

export interface ModuleAccessInput {
  role: string;
  userCenterId: number | null;
  userProvinceId: number | null;
  moduleCenterId: number | null;
  moduleProvinceId: number | null;
  isAssigned: boolean;
}

/**
 * Whether a user may access a module's collaborative space.
 * - superadmin: always
 * - coordinator: global modules, modules in their province, or assigned ones
 * - department_head: modules in their center, or assigned ones
 * - teacher: only modules they are assigned to
 * - everyone else: no access
 */
export function decideModuleAccess(input: ModuleAccessInput): boolean {
  switch (input.role) {
    case "superadmin":
      return true;
    case "coordinator":
      return (
        input.moduleCenterId == null ||
        (input.userProvinceId != null &&
          input.moduleProvinceId === input.userProvinceId) ||
        input.isAssigned
      );
    case "department_head":
      return (
        (input.userCenterId != null &&
          input.moduleCenterId === input.userCenterId) ||
        input.isAssigned
      );
    case "teacher":
      return input.isAssigned;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// OCS provisioning client
// ---------------------------------------------------------------------------

class OcsError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly ocsCode: number | null = null,
  ) {
    super(message);
  }
}

// OCS success status codes: 100 (OCS v1) and 200 (OCS v2).
const OCS_SUCCESS = new Set([100, 200]);
// 102 = "already exists" for cloud users/groups operations.
const OCS_ALREADY_EXISTS = 102;

/** True when an OCS failure means the resource already exists (idempotent ok). */
function isAlreadyExists(err: unknown): boolean {
  return (
    err instanceof OcsError &&
    (err.ocsCode === OCS_ALREADY_EXISTS ||
      err.status === 409 ||
      err.status === 400)
  );
}

async function ocs(
  config: NextcloudConfig,
  method: string,
  path: string,
  form?: Record<string, string | string[]>,
): Promise<unknown> {
  const auth = Buffer.from(
    `${config.adminUser}:${config.adminPassword}`,
  ).toString("base64");
  const headers: Record<string, string> = {
    Authorization: `Basic ${auth}`,
    "OCS-APIRequest": "true",
    Accept: "application/json",
  };
  let body: string | undefined;
  if (form) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(form)) {
      if (Array.isArray(value)) {
        for (const v of value) params.append(`${key}[]`, v);
      } else {
        params.append(key, value);
      }
    }
    body = params.toString();
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  }
  const res = await fetch(`${config.url}${path}`, { method, headers, body });
  const text = await res.text();
  if (!res.ok) {
    throw new OcsError(res.status, `OCS ${method} ${path} -> ${res.status}: ${text}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Non-JSON success body (rare); nothing to validate.
    return text;
  }
  // Nextcloud OCS returns HTTP 200 even for logical errors, encoding the real
  // outcome in `ocs.meta.statuscode`. Treat anything outside the success set as
  // a failure so callers can react (e.g. distinguish "already exists" from a
  // genuine provisioning failure) instead of silently succeeding.
  const code = ocsStatusCode(parsed);
  if (code != null && !OCS_SUCCESS.has(code)) {
    throw new OcsError(
      res.status,
      `OCS ${method} ${path} -> statuscode ${code}: ${text}`,
      code,
    );
  }
  return parsed;
}

/** OCS responses wrap a `meta.statuscode`; 100/200 = success, 102 = already exists. */
function ocsStatusCode(payload: unknown): number | null {
  const ocsObj = (payload as { ocs?: { meta?: { statuscode?: number } } })?.ocs;
  return ocsObj?.meta?.statuscode ?? null;
}

async function ensureGroup(config: NextcloudConfig, groupId: string): Promise<void> {
  try {
    await ocs(config, "POST", "/ocs/v2.php/cloud/groups", { groupid: groupId });
  } catch (err) {
    // OCS code 102 (or HTTP 400/409) means it already exists — idempotent ok.
    if (isAlreadyExists(err)) return;
    throw err;
  }
}

async function ensureUser(
  config: NextcloudConfig,
  opts: { uid: string; displayName: string; email?: string | null },
): Promise<void> {
  try {
    const form: Record<string, string> = {
      userid: opts.uid,
      // Random password; the account only ever logs in via OIDC.
      password: cryptoRandom(),
      displayName: opts.displayName,
    };
    if (opts.email) form["email"] = opts.email;
    await ocs(config, "POST", "/ocs/v2.php/cloud/users", form);
  } catch (err) {
    // Already exists -> ignore (idempotent).
    if (isAlreadyExists(err)) return;
    throw err;
  }
}

async function addUserToGroup(
  config: NextcloudConfig,
  uid: string,
  groupId: string,
): Promise<void> {
  try {
    await ocs(config, "POST", `/ocs/v2.php/cloud/users/${encodeURIComponent(uid)}/groups`, {
      groupid: groupId,
    });
  } catch (err) {
    if (isAlreadyExists(err)) return;
    throw err;
  }
}

/** List the Nextcloud uids currently in a group. */
async function getGroupMembers(
  config: NextcloudConfig,
  groupId: string,
): Promise<string[]> {
  const res = (await ocs(
    config,
    "GET",
    `/ocs/v2.php/cloud/groups/${encodeURIComponent(groupId)}/users?format=json`,
  )) as { ocs?: { data?: { users?: string[] } } };
  return res?.ocs?.data?.users ?? [];
}

/** Remove a user from a group (idempotent: ignores "not a member"). */
async function removeUserFromGroup(
  config: NextcloudConfig,
  uid: string,
  groupId: string,
): Promise<void> {
  try {
    await ocs(
      config,
      "DELETE",
      `/ocs/v2.php/cloud/users/${encodeURIComponent(uid)}/groups`,
      { groupid: groupId },
    );
  } catch (err) {
    // Already not a member -> idempotent ok.
    if (isAlreadyExists(err)) return;
    throw err;
  }
}

/**
 * Ensure a Group Folder exists for the module's group and return its id. The
 * Group Folders app exposes its own OCS endpoints under /apps/groupfolders.
 */
async function ensureGroupFolder(
  config: NextcloudConfig,
  opts: { mount: string; groupId: string },
): Promise<number> {
  const list = (await ocs(
    config,
    "GET",
    "/apps/groupfolders/folders?format=json",
  )) as { ocs?: { data?: Record<string, { id: number; mount_point: string }> } };
  const existing = Object.values(list?.ocs?.data ?? {}).find(
    (f) => f.mount_point === opts.mount,
  );
  let folderId: number;
  if (existing) {
    folderId = existing.id;
  } else {
    const created = (await ocs(config, "POST", "/apps/groupfolders/folders?format=json", {
      mountpoint: opts.mount,
    })) as { ocs?: { data?: { id?: number } } };
    const id = created?.ocs?.data?.id;
    if (typeof id !== "number") {
      throw new Error("Group folder creation did not return an id");
    }
    folderId = id;
  }
  // Grant the module group access (idempotent). Permission 31 = all (read,
  // write, share, delete, create).
  await ocs(config, "POST", `/apps/groupfolders/folders/${folderId}/groups?format=json`, {
    group: opts.groupId,
  });
  await ocs(
    config,
    "POST",
    `/apps/groupfolders/folders/${folderId}/groups/${encodeURIComponent(opts.groupId)}?format=json`,
    { permissions: "31" },
  );
  return folderId;
}

function cryptoRandom(): string {
  // 32 hex chars; satisfies Nextcloud's default password policy.
  return (
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2) +
    "Aa1!"
  );
}

export interface ProvisionMember {
  userId: number;
  name: string;
  email?: string | null;
}

/**
 * Reconcile the module group + group folder so its members exactly match the
 * desired set: ensures the group/folder exist, adds/creates the desired members,
 * and removes any stale members that are no longer assigned/in-scope. This keeps
 * Nextcloud authorization in sync with the app (no drift after assignment
 * changes). Best-effort per member so one failure doesn't abort the rest; throws
 * only if the group/folder itself can't be created.
 */
export async function provisionModuleSpace(
  config: NextcloudConfig,
  opts: { moduleId: number; mount: string; members: ProvisionMember[] },
): Promise<void> {
  const groupId = moduleGroupId(opts.moduleId);
  await ensureGroup(config, groupId);
  await ensureGroupFolder(config, { mount: opts.mount, groupId });

  const desired = new Set(opts.members.map((m) => nextcloudUid(m.userId)));

  // Add / create the desired members.
  for (const m of opts.members) {
    const uid = nextcloudUid(m.userId);
    try {
      await ensureUser(config, {
        uid,
        displayName: m.name,
        email: m.email ?? null,
      });
      await addUserToGroup(config, uid, groupId);
    } catch (err) {
      logger.error(
        { err, uid, moduleId: opts.moduleId },
        "Failed to provision Nextcloud member",
      );
    }
  }

  // Remove stale members so access is revoked when assignments/scope change.
  // The group is fully app-managed (coordina-mod-*), so anyone outside the
  // desired set should not be a member.
  try {
    const current = await getGroupMembers(config, groupId);
    for (const uid of current) {
      if (desired.has(uid)) continue;
      try {
        await removeUserFromGroup(config, uid, groupId);
      } catch (err) {
        logger.error(
          { err, uid, moduleId: opts.moduleId },
          "Failed to remove stale Nextcloud member",
        );
      }
    }
  } catch (err) {
    logger.error(
      { err, moduleId: opts.moduleId },
      "Failed to reconcile Nextcloud group membership",
    );
  }
}

export { OcsError };
