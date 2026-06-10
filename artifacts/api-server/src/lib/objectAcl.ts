import type { File } from "@google-cloud/storage";
import { promises as fs } from "fs";

const ACL_POLICY_METADATA_KEY = "custom:aclPolicy";

// A handle to a stored object. The GCS backend wraps a @google-cloud/storage
// File; the local backend wraps an absolute path on disk. Every consumer treats
// this as an opaque reference and only passes it back to the storage service.
export type StoredObject =
  | { kind: "gcs"; file: File }
  | { kind: "local"; absPath: string };

// Sidecar metadata for the local backend, persisted next to the object as
// "<absPath>.meta.json". Holds the original content type/size (so downloads can
// set the right headers) and the ACL policy.
export interface LocalObjectMeta {
  contentType?: string;
  size?: number;
  acl?: ObjectAclPolicy;
}

function localMetaPath(absPath: string): string {
  return `${absPath}.meta.json`;
}

export async function readLocalMeta(absPath: string): Promise<LocalObjectMeta> {
  try {
    const raw = await fs.readFile(localMetaPath(absPath), "utf8");
    return JSON.parse(raw) as LocalObjectMeta;
  } catch {
    return {};
  }
}

export async function writeLocalMeta(
  absPath: string,
  meta: LocalObjectMeta,
): Promise<void> {
  await fs.writeFile(localMetaPath(absPath), JSON.stringify(meta), "utf8");
}

// Can be flexibly defined according to the use case.
//
// Examples:
// - USER_LIST: the users from a list stored in the database;
// - EMAIL_DOMAIN: the users whose email is in a specific domain;
// - GROUP_MEMBER: the users who are members of a specific group;
// - SUBSCRIBER: the users who are subscribers of a specific service / content
//   creator.
export enum ObjectAccessGroupType {}

export interface ObjectAccessGroup {
  type: ObjectAccessGroupType;
  // The logic id that identifies qualified group members. Format depends on the
  // ObjectAccessGroupType — e.g. a user-list DB id, an email domain, a group id.
  id: string;
}

export enum ObjectPermission {
  READ = "read",
  WRITE = "write",
}

export interface ObjectAclRule {
  group: ObjectAccessGroup;
  permission: ObjectPermission;
}

// Stored as object custom metadata under "custom:aclPolicy" (JSON string) for
// the GCS backend, or inside the sidecar .meta.json for the local backend.
export interface ObjectAclPolicy {
  owner: string;
  visibility: "public" | "private";
  aclRules?: Array<ObjectAclRule>;
}

function isPermissionAllowed(
  requested: ObjectPermission,
  granted: ObjectPermission,
): boolean {
  if (requested === ObjectPermission.READ) {
    return [ObjectPermission.READ, ObjectPermission.WRITE].includes(granted);
  }
  return granted === ObjectPermission.WRITE;
}

abstract class BaseObjectAccessGroup implements ObjectAccessGroup {
  constructor(
    public readonly type: ObjectAccessGroupType,
    public readonly id: string,
  ) {}

  public abstract hasMember(userId: string): Promise<boolean>;
}

function createObjectAccessGroup(
  group: ObjectAccessGroup,
): BaseObjectAccessGroup {
  switch (group.type) {
    // Implement per access group type, e.g.:
    // case "USER_LIST":
    //   return new UserListAccessGroup(group.id);
    default:
      throw new Error(`Unknown access group type: ${group.type}`);
  }
}

export async function setObjectAclPolicy(
  objectFile: StoredObject,
  aclPolicy: ObjectAclPolicy,
): Promise<void> {
  if (objectFile.kind === "local") {
    const meta = await readLocalMeta(objectFile.absPath);
    await writeLocalMeta(objectFile.absPath, { ...meta, acl: aclPolicy });
    return;
  }

  const [exists] = await objectFile.file.exists();
  if (!exists) {
    throw new Error(`Object not found: ${objectFile.file.name}`);
  }

  await objectFile.file.setMetadata({
    metadata: {
      [ACL_POLICY_METADATA_KEY]: JSON.stringify(aclPolicy),
    },
  });
}

export async function getObjectAclPolicy(
  objectFile: StoredObject,
): Promise<ObjectAclPolicy | null> {
  if (objectFile.kind === "local") {
    const meta = await readLocalMeta(objectFile.absPath);
    return meta.acl ?? null;
  }

  const [metadata] = await objectFile.file.getMetadata();
  const aclPolicy = metadata?.metadata?.[ACL_POLICY_METADATA_KEY];
  if (!aclPolicy) {
    return null;
  }
  return JSON.parse(aclPolicy as string);
}

export async function canAccessObject({
  userId,
  objectFile,
  requestedPermission,
}: {
  userId?: string;
  objectFile: StoredObject;
  requestedPermission: ObjectPermission;
}): Promise<boolean> {
  const aclPolicy = await getObjectAclPolicy(objectFile);
  if (!aclPolicy) {
    return false;
  }

  if (
    aclPolicy.visibility === "public" &&
    requestedPermission === ObjectPermission.READ
  ) {
    return true;
  }

  if (!userId) {
    return false;
  }

  if (aclPolicy.owner === userId) {
    return true;
  }

  for (const rule of aclPolicy.aclRules || []) {
    const accessGroup = createObjectAccessGroup(rule.group);
    if (
      (await accessGroup.hasMember(userId)) &&
      isPermissionAllowed(requestedPermission, rule.permission)
    ) {
      return true;
    }
  }

  return false;
}
