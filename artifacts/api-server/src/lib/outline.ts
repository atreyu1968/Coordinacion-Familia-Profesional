import { eq } from "drizzle-orm";
import {
  db,
  wikiModuleCollectionsTable,
  type WikiModuleCollection,
} from "@workspace/db";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Outline (open-source wiki / documentation) integration.
//
// The app self-hosts Outline (Docker Compose, see deploy/outline) on its own
// subdomain — Outline does not support subpath hosting. Each academic module
// gets an Outline "collection" of documents. Everyone can READ every collection
// (the collection's default member permission is "read"); only selected users
// can EDIT, via membership of a per-module Outline group that is granted
// "read_write" on the collection.
//
// Source of truth for identities stays in this app: Outline users are created on
// demand (and authenticate exclusively via OIDC/SSO against this app). This
// module resolves the configuration (control-panel DB values take precedence
// over environment variables, same pattern as Nextcloud/JaaS) and exposes the
// provisioning helpers (collections, groups, memberships) used by the wiki
// routes.
// ---------------------------------------------------------------------------

export interface OutlineSettings {
  outlineUrl?: string | null;
  outlineOidcClientId?: string | null;
  outlineOidcClientSecret?: string | null;
  outlineApiToken?: string | null;
}

export interface OutlineOidcClient {
  clientId: string;
  clientSecret: string;
}

export interface OutlineConfig {
  /** Base URL used for server-to-server API calls (may be an internal URL). */
  apiBase: string;
  apiToken: string;
}

function clean(v?: string | null): string {
  return (v || "").trim();
}

function stripTrailingSlash(v: string): string {
  return v.replace(/\/+$/, "");
}

/**
 * Public base URL of Outline (used for browser SSO links and the iframe / new
 * tab). DB (control panel) wins; env (OUTLINE_URL) is the self-hosted fallback.
 */
export function resolveOutlineUrl(s?: OutlineSettings | null): string | null {
  const fromDb = stripTrailingSlash(clean(s?.outlineUrl));
  if (fromDb) return fromDb;
  const fromEnv = stripTrailingSlash(clean(process.env["OUTLINE_URL"]));
  return fromEnv || null;
}

/**
 * Resolve the API connection (base URL + token) used for provisioning. The
 * token follows DB-then-env. The base URL prefers OUTLINE_ADMIN_URL (a private,
 * server-reachable URL such as http://127.0.0.1:3000) so admin traffic stays
 * local behind a reverse proxy / tunnel; otherwise the public URL is used.
 */
export function resolveOutlineConfig(
  s?: OutlineSettings | null,
): OutlineConfig | null {
  const apiToken =
    clean(s?.outlineApiToken) || clean(process.env["OUTLINE_API_TOKEN"]);
  if (!apiToken) return null;
  const adminUrl = stripTrailingSlash(clean(process.env["OUTLINE_ADMIN_URL"]));
  const apiBase = adminUrl || resolveOutlineUrl(s);
  if (!apiBase) return null;
  return { apiBase, apiToken };
}

/**
 * OIDC client credentials Outline uses to authenticate its users against this
 * app (SSO). All-or-nothing, DB-then-env.
 */
export function resolveOutlineOidcClient(
  s?: OutlineSettings | null,
): OutlineOidcClient | null {
  const id = clean(s?.outlineOidcClientId);
  const secret = clean(s?.outlineOidcClientSecret);
  if (id && secret) return { clientId: id, clientSecret: secret };
  const envId = clean(process.env["OUTLINE_OIDC_CLIENT_ID"]);
  const envSecret = clean(process.env["OUTLINE_OIDC_CLIENT_SECRET"]);
  if (envId && envSecret) return { clientId: envId, clientSecret: envSecret };
  return null;
}

/**
 * The wiki is "configured" when the public URL, the provisioning API token and
 * the OIDC client (for SSO) are all present.
 */
export function isOutlineConfigured(s?: OutlineSettings | null): boolean {
  return (
    resolveOutlineUrl(s) !== null &&
    resolveOutlineConfig(s) !== null &&
    resolveOutlineOidcClient(s) !== null
  );
}

/**
 * SSO sign-in works once the URL and OIDC client are present, even without the
 * API token. The token is only needed to provision per-module collections, so
 * this weaker check lets an admin bootstrap the first Outline login (to create
 * that token) before the wiki is "fully" configured.
 */
export function isOutlineLoginReady(s?: OutlineSettings | null): boolean {
  return resolveOutlineUrl(s) !== null && resolveOutlineOidcClient(s) !== null;
}

/**
 * Strict redirect_uri policy for the Outline OIDC client: the callback must live
 * on the same origin as the configured Outline base URL, under Outline's OIDC
 * callback path. Mirrors the Nextcloud check to avoid prefix-confusable hosts.
 */
export function isOutlineRedirectUri(
  redirectUri: string,
  outlineUrl: string,
): boolean {
  let target: URL;
  let base: URL;
  try {
    target = new URL(redirectUri);
    base = new URL(outlineUrl);
  } catch {
    return false;
  }
  if (target.protocol !== base.protocol) return false;
  if (target.host !== base.host) return false;
  const basePath = base.pathname.replace(/\/+$/, "");
  if (!target.pathname.startsWith(basePath)) return false;
  const rest = target.pathname.slice(basePath.length);
  // Outline's OIDC callback path.
  return /^\/auth\/oidc\.callback$/.test(rest);
}

// ---------------------------------------------------------------------------
// Stable naming
// ---------------------------------------------------------------------------

/** Stable Outline group name for a module's editors. */
export function moduleEditorGroupName(moduleId: number): string {
  return `coordina-wiki-mod-${moduleId}`;
}

/** Human-friendly Outline collection name for a module. */
export function moduleCollectionName(opts: {
  moduleId: number;
  name: string;
  code?: string | null;
}): string {
  const label = opts.code ? `${opts.code} ${opts.name}` : opts.name;
  return label.trim() || `Módulo ${opts.moduleId}`;
}

// ---------------------------------------------------------------------------
// Outline API client
// ---------------------------------------------------------------------------

class OutlineError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** True when an Outline failure means the resource already exists. */
function isAlreadyExists(err: unknown): boolean {
  return (
    err instanceof OutlineError &&
    (err.status === 400 || err.status === 409) &&
    /already|exist|conflict/i.test(err.message)
  );
}

/**
 * Call an Outline API method. All endpoints are POST with a JSON body and a
 * Bearer token. Outline returns { ok, data } on success and a non-2xx status
 * with { error, message } on failure.
 */
async function api<T = unknown>(
  config: OutlineConfig,
  method: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${config.apiBase}/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new OutlineError(res.status, `Outline ${method} -> ${res.status}: ${text}`);
  }
  if (!text) return undefined as T;
  try {
    const parsed = JSON.parse(text) as { data?: T };
    return (parsed?.data ?? (parsed as unknown)) as T;
  } catch {
    return undefined as T;
  }
}

interface OutlineUser {
  id: string;
  name: string;
  email?: string | null;
}

/**
 * Find an Outline user by email, inviting them if they do not exist yet. Outline
 * normally creates accounts on first SSO login; inviting lets us grant edit
 * access before the user has ever logged in. Returns the Outline user id, or
 * null if the user could not be resolved (best-effort: never throws).
 */
async function findOrInviteUser(
  config: OutlineConfig,
  opts: { email?: string | null; name: string },
): Promise<string | null> {
  const email = clean(opts.email).toLowerCase();
  if (!email) return null;
  try {
    const found = await api<OutlineUser[]>(config, "users.list", {
      query: email,
      limit: 25,
    });
    const match = (found ?? []).find(
      (u) => clean(u.email).toLowerCase() === email,
    );
    if (match) return match.id;
  } catch (err) {
    logger.warn({ err }, "Outline users.list failed");
  }
  try {
    const invited = await api<{ users?: OutlineUser[] }>(
      config,
      "users.invite",
      { invites: [{ email, name: opts.name, role: "member" }] },
    );
    const user = invited?.users?.find(
      (u) => clean(u.email).toLowerCase() === email,
    );
    if (user) return user.id;
  } catch (err) {
    if (!isAlreadyExists(err)) {
      logger.warn({ err }, "Outline users.invite failed");
    }
  }
  // Last attempt: re-query (invite may have created it without echoing it back).
  try {
    const found = await api<OutlineUser[]>(config, "users.list", {
      query: email,
      limit: 25,
    });
    const match = (found ?? []).find(
      (u) => clean(u.email).toLowerCase() === email,
    );
    return match?.id ?? null;
  } catch {
    return null;
  }
}

interface OutlineCollection {
  id: string;
  name: string;
}
interface OutlineGroup {
  id: string;
  name: string;
}

async function findCollectionByName(
  config: OutlineConfig,
  name: string,
): Promise<string | null> {
  const list = await api<OutlineCollection[]>(config, "collections.list", {
    limit: 100,
  });
  const match = (list ?? []).find((c) => c.name === name);
  return match?.id ?? null;
}

async function findGroupByName(
  config: OutlineConfig,
  name: string,
): Promise<string | null> {
  const list = await api<{ groups?: OutlineGroup[] } | OutlineGroup[]>(
    config,
    "groups.list",
    { limit: 100 },
  );
  const groups = Array.isArray(list) ? list : (list?.groups ?? []);
  const match = groups.find((g) => g.name === name);
  return match?.id ?? null;
}

export interface ProvisionWikiMember {
  userId: number;
  name: string;
  email?: string | null;
}

/**
 * Ensure the module's Outline collection and editor group exist, returning the
 * cached mapping. Idempotent: reuses the stored mapping, otherwise finds the
 * resources by their deterministic names, otherwise creates them. The collection
 * is created with default member permission "read" (everyone reads) and the
 * editor group is granted "read_write" on it.
 */
export async function ensureModuleWiki(
  config: OutlineConfig,
  module: { id: number; name: string; code?: string | null },
): Promise<WikiModuleCollection> {
  const [existing] = await db
    .select()
    .from(wikiModuleCollectionsTable)
    .where(eq(wikiModuleCollectionsTable.moduleId, module.id));
  if (existing) return existing;

  const collName = moduleCollectionName({
    moduleId: module.id,
    name: module.name,
    code: module.code,
  });
  const groupName = moduleEditorGroupName(module.id);

  // Collection: reuse by name, else create with everyone-read default.
  let collectionId = await findCollectionByName(config, collName).catch(
    () => null,
  );
  if (!collectionId) {
    const created = await api<OutlineCollection>(config, "collections.create", {
      name: collName,
      permission: "read",
      description: "Documentación del módulo gestionada por Coordina ADG.",
    });
    collectionId = created.id;
  }

  // Editor group: reuse by name, else create.
  let editorGroupId = await findGroupByName(config, groupName).catch(() => null);
  if (!editorGroupId) {
    try {
      const created = await api<OutlineGroup>(config, "groups.create", {
        name: groupName,
      });
      editorGroupId = created.id;
    } catch (err) {
      if (isAlreadyExists(err)) {
        editorGroupId = await findGroupByName(config, groupName);
      } else {
        throw err;
      }
    }
  }
  if (!editorGroupId) {
    throw new Error("No se pudo crear el grupo de editores en Outline");
  }

  // Grant the editor group read_write on the collection (idempotent).
  try {
    await api(config, "collections.add_group", {
      id: collectionId,
      collectionId,
      groupId: editorGroupId,
      permission: "read_write",
    });
  } catch (err) {
    if (!isAlreadyExists(err)) throw err;
  }

  const [row] = await db
    .insert(wikiModuleCollectionsTable)
    .values({ moduleId: module.id, collectionId, editorGroupId })
    .onConflictDoUpdate({
      target: wikiModuleCollectionsTable.moduleId,
      set: { collectionId, editorGroupId },
    })
    .returning();
  return row;
}

/**
 * Reconcile the module's Outline editor group so its membership exactly matches
 * the desired set of app users (resolving/inviting each Outline account by
 * email). Best-effort per member so one failure doesn't abort the rest.
 */
export async function syncModuleWikiEditors(
  config: OutlineConfig,
  editorGroupId: string,
  members: ProvisionWikiMember[],
): Promise<void> {
  // Desired Outline user ids.
  const desired = new Map<string, ProvisionWikiMember>();
  for (const m of members) {
    const outlineId = await findOrInviteUser(config, {
      email: m.email,
      name: m.name,
    });
    if (outlineId) desired.set(outlineId, m);
  }

  // Current group membership.
  let current: string[] = [];
  try {
    const res = await api<{ users?: OutlineUser[] }>(
      config,
      "groups.memberships",
      { id: editorGroupId, limit: 100 },
    );
    current = (res?.users ?? []).map((u) => u.id);
  } catch (err) {
    logger.warn({ err }, "Outline groups.memberships failed");
  }
  const currentSet = new Set(current);

  // Add missing.
  for (const userId of desired.keys()) {
    if (currentSet.has(userId)) continue;
    try {
      await api(config, "groups.add_user", { id: editorGroupId, userId });
    } catch (err) {
      if (!isAlreadyExists(err)) {
        logger.warn({ err, userId }, "Outline groups.add_user failed");
      }
    }
  }
  // Remove stale.
  for (const userId of currentSet) {
    if (desired.has(userId)) continue;
    try {
      await api(config, "groups.remove_user", { id: editorGroupId, userId });
    } catch (err) {
      logger.warn({ err, userId }, "Outline groups.remove_user failed");
    }
  }
}

/**
 * Resolve the public deep-link URL for a module's collection (where SSO lands).
 * Falls back to the Outline home when the module has no collection yet.
 */
export function moduleCollectionPath(
  mapping: WikiModuleCollection | null,
): string {
  if (mapping) return `/collection/${mapping.collectionId}`;
  return "/home";
}

/** Look up the cached collection mapping for a module (null when not provisioned). */
export async function getModuleWikiMapping(
  moduleId: number,
): Promise<WikiModuleCollection | null> {
  const [row] = await db
    .select()
    .from(wikiModuleCollectionsTable)
    .where(eq(wikiModuleCollectionsTable.moduleId, moduleId));
  return row ?? null;
}
