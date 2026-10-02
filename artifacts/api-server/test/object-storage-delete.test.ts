import { afterEach, describe, expect, it, vi } from "vitest";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const envKeys = ["STORAGE_DRIVER", "LOCAL_STORAGE_DIR", "PRIVATE_OBJECT_DIR"] as const;
const originalEnv = Object.fromEntries(
  envKeys.map((key) => [key, process.env[key]]),
) as Record<(typeof envKeys)[number], string | undefined>;
let tempDir: string | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  for (const key of envKeys) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("ObjectStorageService.deleteObjectEntity", () => {
  it("removes local objects and metadata, and treats missing files safely", async () => {
    vi.resetModules();
    tempDir = await mkdtemp(path.join(os.tmpdir(), "chat-object-delete-"));
    process.env.STORAGE_DRIVER = "local";
    process.env.LOCAL_STORAGE_DIR = tempDir;
    const { ObjectStorageService } = await import("../src/lib/objectStorage");
    const service = new ObjectStorageService();

    await expect(
      service.deleteObjectEntity("/objects/uploads/already-missing"),
    ).resolves.toBeUndefined();

    const objectPath = path.join(tempDir, "private", "uploads", "chat-file");
    await mkdir(path.dirname(objectPath), { recursive: true });
    await writeFile(objectPath, "attachment bytes");
    await writeFile(`${objectPath}.meta.json`, "{}");
    await service.deleteObjectEntity("/objects/uploads/chat-file");
    await expect(access(objectPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(`${objectPath}.meta.json`)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      service.deleteObjectEntity("/objects/uploads/../public/not-private"),
    ).rejects.toMatchObject({ name: "ObjectNotFoundError" });
  });

  it("asks Replit object storage to ignore missing objects", async () => {
    vi.resetModules();
    process.env.STORAGE_DRIVER = "replit";
    process.env.PRIVATE_OBJECT_DIR = "/bucket/private";
    const { ObjectStorageService, objectStorageClient } = await import(
      "../src/lib/objectStorage"
    );
    const deleteObject = vi.fn().mockResolvedValue(undefined);
    const file = { delete: deleteObject };
    vi.spyOn(objectStorageClient, "bucket").mockReturnValue({
      file: vi.fn().mockReturnValue(file),
    } as never);

    await expect(
      new ObjectStorageService().deleteObjectEntity(
        "/objects/uploads/already-missing",
      ),
    ).resolves.toBeUndefined();
    expect(deleteObject).toHaveBeenCalledWith({ ignoreNotFound: true });
  });
});