import { getSettings } from "./settings";
import { resolveNextcloudConfig, resolveNextcloudUrl, type NextcloudConfig } from "./nextcloud";

export type GroupFolder = { id: number; mountPoint: string; groups: Record<string, number> };
export type GroupFolderFile = { folderId: number; mountPoint: string; path: string[]; fileName: string; etag: string; size: number };

function auth(config: NextcloudConfig) {
  return {
    Authorization: `Basic ${Buffer.from(`${config.adminUser}:${config.adminPassword}`).toString("base64")}`,
    "OCS-APIRequest": "true",
    "User-Agent": "Coordina ADG / consulta privada de IA",
  };
}
async function boundedBytes(response: Response, limit: number): Promise<Buffer> {
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > limit) throw new Error("La respuesta de Nextcloud supera el límite de lectura.");
  if (!response.body) throw new Error("Nextcloud devolvió una respuesta vacía.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) throw new Error("La respuesta de Nextcloud supera el límite de lectura.");
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}
async function connection() {
  const settings = await getSettings();
  const config = resolveNextcloudConfig(settings);
  const publicUrl = resolveNextcloudUrl(settings);
  if (!config || !publicUrl) throw new Error("Configura Nextcloud en el panel de control antes de consultar sus archivos.");
  return { config, publicUrl };
}
async function fetchOcs(config: NextcloudConfig, path: string): Promise<unknown> {
  const response = await fetch(`${config.url}/ocs/v2.php/${path}`, {
    headers: auth(config), redirect: "error", signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error("No se pudo consultar el índice de espacios de Nextcloud.");
  const xmlOrJson = await response.text();
  if (xmlOrJson.length > 8 * 1024 * 1024 || !/^\s*\{/.test(xmlOrJson)) throw new Error("Nextcloud no devolvió una respuesta OCS JSON válida.");
  const result = JSON.parse(xmlOrJson) as { ocs?: { meta?: { statuscode?: number }; data?: unknown } };
  if (![100, 200].includes(Number(result.ocs?.meta?.statuscode)) || result.ocs?.data == null) throw new Error("Nextcloud rechazó la consulta administrativa de solo lectura.");
  return result.ocs.data;
}
export async function listManagedGroupFolders(): Promise<{ publicUrl: string; folders: GroupFolder[] }> {
  const { config, publicUrl } = await connection();
  const data = await fetchOcs(config, "apps/groupfolders/folders?format=json");
  const rows = Array.isArray(data) ? data : Object.values(data as Record<string, unknown>);
  const folders: GroupFolder[] = [];
  for (const item of rows) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = Number(row.id ?? row.folder_id ?? row.folderId);
    const mountPoint = typeof (row.mount_point ?? row.mountpoint) === "string" ? String(row.mount_point ?? row.mountpoint) : "";
    const rawGroups = row.groups && typeof row.groups === "object" ? row.groups as Record<string, unknown> : {};
    const groups: Record<string, number> = {};
    for (const [key, val] of Object.entries(rawGroups)) {
      const rights = typeof val === "object" && val !== null ? Number((val as Record<string, unknown>).permissions) : Number(val);
      if (Number.isFinite(rights) && (rights & 1) === 1) groups[key] = rights;
    }
    if (Number.isSafeInteger(id) && id > 0 && mountPoint && !/[\/\\\x00-\x1f]/.test(mountPoint)) folders.push({ id, mountPoint, groups });
  }
  return { publicUrl, folders };
}
function unescapeXml(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n: string) => {
      const cp = n.toLowerCase().startsWith("x") ? parseInt(n.slice(1), 16) : Number(n);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
    }).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
function tag(xml: string, name: string) {
  const match = xml.match(new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${name}>`, "i"));
  return match ? unescapeXml(match[1]) : "";
}
export function parseGroupFolderDav(xml: string, folderId: number): GroupFolderFile[] {
  if (xml.length > 8 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Respuesta WebDAV no válida.");
  const files: GroupFolderFile[] = [];
  for (const match of xml.matchAll(/<(?:[\w-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?response>/gi)) {
    const body = match[1];
    const href = tag(body, "href");
    let pathname: string;
    try { pathname = new URL(href, "https://nextcloud.invalid").pathname; } catch { continue; }
    const prefix = `/remote.php/dav/groupfolders/${folderId}/`;
    if (!pathname.startsWith(prefix)) continue;
    const path = pathname.slice(prefix.length).replace(/\/$/, "").split("/").filter(Boolean).map(part => {
      try { return decodeURIComponent(part); } catch { return ""; }
    });
    if (!path.length || path.some(part => !part || part === "." || part === ".." || /[/\\\x00-\x1f]/.test(part))) continue;
    const properties = [...body.matchAll(/<(?:[\w-]+:)?propstat\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?propstat>/gi)]
      .filter(row => /\s200(?:\s|<)/.test(tag(row[1], "status"))).map(row => row[1]).join("");
    if (!properties || /<(?:[\w-]+:)?collection\b/i.test(properties)) continue;
    const permissions = tag(properties, "permissions");
    if (permissions && !permissions.includes("R")) continue;
    files.push({ folderId, mountPoint: "", path, fileName: path.at(-1)!, etag: tag(properties, "getetag"), size: Number(tag(properties, "getcontentlength")) || 0 });
  }
  return files;
}
export async function listGroupFolderFiles(folderId: number): Promise<GroupFolderFile[]> {
  if (!Number.isSafeInteger(folderId) || folderId <= 0) throw new Error("Carpeta de Nextcloud no válida.");
  const { config } = await connection();
  const folders: string[][] = [[]];
  const files: GroupFolderFile[] = [];
  for (let i = 0; i < folders.length; i++) {
    if (files.length >= 10000 || folders.length > 2000) throw new Error("El espacio de Nextcloud supera el límite seguro de indexación; no se enviará un índice parcial a la IA.");
    const parent = folders[i];
    const url = `${config.url}/remote.php/dav/groupfolders/${folderId}/${parent.map(encodeURIComponent).join("/")}`;
    const response = await fetch(url, {
      method: "PROPFIND", redirect: "error", signal: AbortSignal.timeout(20000),
      headers: { ...auth(config), Depth: "1", "Content-Type": "application/xml" },
      body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><d:resourcetype/><d:getetag/><d:getcontentlength/><oc:permissions/></d:prop></d:propfind>',
    });
    if ([403, 404].includes(response.status)) throw new Error("La cuenta administrativa no puede leer un espacio de Nextcloud. No se usará su contenido.");
    if (response.status !== 207) throw new Error("Nextcloud no autorizó la lectura WebDAV del espacio.");
    const bytes = await boundedBytes(response, 8 * 1024 * 1024);
    const children = parseGroupFolderDav(bytes.toString("utf8"), folderId);
    const rootName = children.length ? children[0].path[0] : "";
    for (const child of children) {
      if (child.path.length !== parent.length + 1 || !parent.every((part, index) => child.path[index] === part)) continue;
      child.mountPoint = rootName;
      files.push(child);
    }
    const xmlPath = `/remote.php/dav/groupfolders/${folderId}/`;
    for (const match of bytes.toString("utf8").matchAll(/<(?:[\w-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?response>/gi)) {
      const body = match[1];
      const href = tag(body, "href");
      let pathname: string;
      try { pathname = new URL(href, "https://nextcloud.invalid").pathname; } catch { continue; }
      if (!pathname.startsWith(xmlPath)) continue;
      const relative = pathname.slice(xmlPath.length).replace(/\/$/, "").split("/").filter(Boolean).map(p => {
        try { return decodeURIComponent(p); } catch { return ""; }
      });
      if (relative.length !== parent.length + 1 || !parent.every((part, n) => relative[n] === part) ||
        relative.some(part => !part || part === "." || part === ".." || /[/\\\x00-\x1f]/.test(part))) continue;
      const prop = [...body.matchAll(/<(?:[\w-]+:)?propstat\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?propstat>/gi)]
        .filter(p => /\s200(?:\s|<)/.test(tag(p[1], "status"))).map(p => p[1]).join("");
      if (/<(?:[\w-]+:)?collection\b/i.test(prop)) folders.push(relative);
    }
  }
  return files;
}
export async function readGroupFolderFile(file: GroupFolderFile, expectedEtag: string): Promise<Buffer> {
  const { config } = await connection();
  if (!file.folderId || !expectedEtag || file.path.some(p => !p || p === "." || p === ".." || /[/\\\x00-\x1f]/.test(p))) throw new Error("La ruta del archivo no es válida.");
  const url = `${config.url}/remote.php/dav/groupfolders/${file.folderId}/${file.path.map(encodeURIComponent).join("/")}`;
  const response = await fetch(url, { headers: { ...auth(config), "If-Match": expectedEtag }, redirect: "error", signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error("El archivo cambió o la lectura de Nextcloud está denegada; se descartó el contenido almacenado.");
  return boundedBytes(response, 100 * 1024 * 1024);
}
