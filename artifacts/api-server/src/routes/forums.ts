import { Router, type IRouter } from "express";
import { eq, and, or, isNull, inArray, sql, desc, asc, type SQL } from "drizzle-orm";
import {
  db,
  forumThreadsTable,
  forumPostsTable,
  modulesTable,
  centersTable,
  usersTable,
  type User,
} from "@workspace/db";
import {
  ListForumModulesResponse,
  ListForumThreadsQueryParams,
  ListForumThreadsResponse,
  CreateForumThreadBody,
  DeleteForumThreadParams,
  ListForumPostsParams,
  ListForumPostsResponse,
  CreateForumPostParams,
  CreateForumPostBody,
  DeleteForumPostParams,
} from "@workspace/api-zod";
import {
  requireAuth,
  resolveReadScope,
  hasScopeOver,
  type ReadScope,
} from "../middlewares/auth";
import { toForumModule, toForumThread, toForumPost } from "../lib/mappers";

const router: IRouter = Router();

const MANAGER_ROLES = ["superadmin", "coordinator", "department_head"];

// Subquery of center ids belonging to a province (non-deleted).
function centerIdsInProvince(provinceId: number) {
  return db
    .select({ id: centersTable.id })
    .from(centersTable)
    .where(
      and(
        eq(centersTable.provinceId, provinceId),
        isNull(centersTable.deletedAt),
      ),
    );
}

// Scope filter mirroring the academics module visibility rules: global modules
// (centerId IS NULL) are visible to everyone; scoped modules only within the
// caller's province/center.
function moduleScopeFilter(scope: ReadScope): SQL | undefined {
  if (scope.kind === "province") {
    return or(
      isNull(modulesTable.centerId),
      inArray(modulesTable.centerId, centerIdsInProvince(scope.provinceId)),
    );
  }
  if (scope.kind === "center") {
    return or(
      isNull(modulesTable.centerId),
      eq(modulesTable.centerId, scope.centerId),
    );
  }
  if (scope.kind === "none") {
    return isNull(modulesTable.centerId);
  }
  return undefined;
}

// Whether the caller may read/post within a specific module's forum.
async function moduleVisibleTo(
  caller: User,
  module: { centerId: number | null },
): Promise<boolean> {
  if (module.centerId == null) return true; // global module
  const scope = resolveReadScope(caller);
  if (scope.kind === "global") return true;
  if (scope.kind === "center") return module.centerId === scope.centerId;
  if (scope.kind === "province") {
    const [center] = await db
      .select({ provinceId: centersTable.provinceId })
      .from(centersTable)
      .where(eq(centersTable.id, module.centerId));
    return center?.provinceId === scope.provinceId;
  }
  return false;
}

// Resolve the province a center belongs to (for manager scope checks).
async function provinceOfCenter(centerId: number | null): Promise<number | null> {
  if (centerId == null) return null;
  const [center] = await db
    .select({ provinceId: centersTable.provinceId })
    .from(centersTable)
    .where(eq(centersTable.id, centerId));
  return center?.provinceId ?? null;
}

// ---------------------------------------------------------------------------
// List modules with their forum thread counts (UI groups them by cycle)
// ---------------------------------------------------------------------------
router.get("/forum/modules", requireAuth, async (req, res): Promise<void> => {
  const scope = resolveReadScope(req.user!);

  const filters: SQL[] = [isNull(modulesTable.deletedAt)];
  const scopeMatch = moduleScopeFilter(scope);
  if (scopeMatch) filters.push(scopeMatch);

  const modules = await db
    .select()
    .from(modulesTable)
    .where(and(...filters))
    .orderBy(modulesTable.name);

  const counts = await db
    .select({
      moduleId: forumThreadsTable.moduleId,
      count: sql<number>`count(*)::int`,
    })
    .from(forumThreadsTable)
    .where(isNull(forumThreadsTable.deletedAt))
    .groupBy(forumThreadsTable.moduleId);
  const countMap = new Map(counts.map((c) => [c.moduleId, c.count]));

  res.json(
    ListForumModulesResponse.parse(
      modules.map((m) =>
        toForumModule({
          id: m.id,
          code: m.code,
          name: m.name,
          cycleName: m.cycleName,
          centerId: m.centerId,
          threadCount: countMap.get(m.id) ?? 0,
        }),
      ),
    ),
  );
});

// ---------------------------------------------------------------------------
// List discussion threads for a module
// ---------------------------------------------------------------------------
router.get("/forum/threads", requireAuth, async (req, res): Promise<void> => {
  const query = ListForumThreadsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ message: query.error.message });
    return;
  }
  const caller = req.user!;

  const [module] = await db
    .select()
    .from(modulesTable)
    .where(
      and(
        eq(modulesTable.id, query.data.moduleId),
        isNull(modulesTable.deletedAt),
      ),
    );
  if (!module) {
    res.status(404).json({ message: "Módulo no encontrado" });
    return;
  }
  if (!(await moduleVisibleTo(caller, module))) {
    res.status(403).json({ message: "Módulo fuera de tu ámbito" });
    return;
  }

  const rows = await db
    .select({
      id: forumThreadsTable.id,
      moduleId: forumThreadsTable.moduleId,
      moduleName: modulesTable.name,
      cycleName: modulesTable.cycleName,
      centerId: forumThreadsTable.centerId,
      title: forumThreadsTable.title,
      authorId: forumThreadsTable.authorId,
      authorName: usersTable.name,
      createdAt: forumThreadsTable.createdAt,
      lastPostAt: forumThreadsTable.lastPostAt,
      postCount: sql<number>`(
        select count(*)::int from ${forumPostsTable}
        where ${forumPostsTable.threadId} = ${forumThreadsTable.id}
          and ${forumPostsTable.deletedAt} is null
      )`,
    })
    .from(forumThreadsTable)
    .leftJoin(modulesTable, eq(modulesTable.id, forumThreadsTable.moduleId))
    .leftJoin(usersTable, eq(usersTable.id, forumThreadsTable.authorId))
    .where(
      and(
        eq(forumThreadsTable.moduleId, query.data.moduleId),
        isNull(forumThreadsTable.deletedAt),
      ),
    )
    .orderBy(desc(forumThreadsTable.lastPostAt));

  res.json(ListForumThreadsResponse.parse(rows.map(toForumThread)));
});

// ---------------------------------------------------------------------------
// Open a new discussion thread (thread + opening post in one transaction)
// ---------------------------------------------------------------------------
router.post("/forum/threads", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateForumThreadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.message });
    return;
  }
  const caller = req.user!;

  const [module] = await db
    .select()
    .from(modulesTable)
    .where(
      and(
        eq(modulesTable.id, parsed.data.moduleId),
        isNull(modulesTable.deletedAt),
      ),
    );
  if (!module) {
    res.status(404).json({ message: "Módulo no encontrado" });
    return;
  }
  if (!(await moduleVisibleTo(caller, module))) {
    res.status(403).json({ message: "Módulo fuera de tu ámbito" });
    return;
  }

  const thread = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(forumThreadsTable)
      .values({
        moduleId: module.id,
        centerId: module.centerId,
        title: parsed.data.title,
        authorId: caller.id,
      })
      .returning();
    await tx.insert(forumPostsTable).values({
      threadId: created!.id,
      authorId: caller.id,
      content: parsed.data.content,
    });
    return created!;
  });

  res.status(201).json(
    toForumThread({
      ...thread,
      moduleName: module.name,
      cycleName: module.cycleName,
      authorName: caller.name,
      postCount: 1,
    }),
  );
});

// ---------------------------------------------------------------------------
// Delete a thread (author or manager within scope) — soft delete
// ---------------------------------------------------------------------------
router.delete(
  "/forum/threads/:id",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = DeleteForumThreadParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const caller = req.user!;

    const [thread] = await db
      .select()
      .from(forumThreadsTable)
      .where(
        and(
          eq(forumThreadsTable.id, params.data.id),
          isNull(forumThreadsTable.deletedAt),
        ),
      );
    if (!thread) {
      res.status(404).json({ message: "Tema no encontrado" });
      return;
    }

    const isAuthor = thread.authorId === caller.id;
    const canManage =
      MANAGER_ROLES.includes(caller.role) &&
      hasScopeOver(caller, {
        provinceId: await provinceOfCenter(thread.centerId),
        centerId: thread.centerId,
      });
    if (!isAuthor && !canManage) {
      res.status(403).json({ message: "Permiso denegado" });
      return;
    }

    await db
      .update(forumThreadsTable)
      .set({ deletedAt: new Date() })
      .where(eq(forumThreadsTable.id, thread.id));
    res.sendStatus(204);
  },
);

// ---------------------------------------------------------------------------
// List the messages in a thread
// ---------------------------------------------------------------------------
router.get(
  "/forum/threads/:id/posts",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = ListForumPostsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const caller = req.user!;

    const thread = await loadVisibleThread(params.data.id, caller);
    if (!thread.ok) {
      res.status(thread.status).json({ message: thread.message });
      return;
    }

    const rows = await db
      .select({
        id: forumPostsTable.id,
        threadId: forumPostsTable.threadId,
        authorId: forumPostsTable.authorId,
        authorName: usersTable.name,
        content: forumPostsTable.content,
        createdAt: forumPostsTable.createdAt,
      })
      .from(forumPostsTable)
      .leftJoin(usersTable, eq(usersTable.id, forumPostsTable.authorId))
      .where(
        and(
          eq(forumPostsTable.threadId, thread.thread.id),
          isNull(forumPostsTable.deletedAt),
        ),
      )
      .orderBy(asc(forumPostsTable.createdAt));

    res.json(ListForumPostsResponse.parse(rows.map(toForumPost)));
  },
);

// ---------------------------------------------------------------------------
// Reply in a thread
// ---------------------------------------------------------------------------
router.post(
  "/forum/threads/:id/posts",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = CreateForumPostParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const body = CreateForumPostBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ message: body.error.message });
      return;
    }
    const caller = req.user!;

    const thread = await loadVisibleThread(params.data.id, caller);
    if (!thread.ok) {
      res.status(thread.status).json({ message: thread.message });
      return;
    }

    const [created] = await db
      .insert(forumPostsTable)
      .values({
        threadId: thread.thread.id,
        authorId: caller.id,
        content: body.data.content,
      })
      .returning();
    await db
      .update(forumThreadsTable)
      .set({ lastPostAt: new Date() })
      .where(eq(forumThreadsTable.id, thread.thread.id));

    res.status(201).json(
      toForumPost({ ...created!, authorName: caller.name }),
    );
  },
);

// ---------------------------------------------------------------------------
// Delete a post (author or manager within scope) — soft delete
// ---------------------------------------------------------------------------
router.delete(
  "/forum/posts/:id",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = DeleteForumPostParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const caller = req.user!;

    const [post] = await db
      .select()
      .from(forumPostsTable)
      .where(
        and(
          eq(forumPostsTable.id, params.data.id),
          isNull(forumPostsTable.deletedAt),
        ),
      );
    if (!post) {
      res.status(404).json({ message: "Mensaje no encontrado" });
      return;
    }
    const [thread] = await db
      .select()
      .from(forumThreadsTable)
      .where(eq(forumThreadsTable.id, post.threadId));

    const isAuthor = post.authorId === caller.id;
    const canManage =
      MANAGER_ROLES.includes(caller.role) &&
      hasScopeOver(caller, {
        provinceId: await provinceOfCenter(thread?.centerId ?? null),
        centerId: thread?.centerId ?? null,
      });
    if (!isAuthor && !canManage) {
      res.status(403).json({ message: "Permiso denegado" });
      return;
    }

    await db
      .update(forumPostsTable)
      .set({ deletedAt: new Date() })
      .where(eq(forumPostsTable.id, post.id));
    res.sendStatus(204);
  },
);

// Load a non-deleted thread and enforce that its module is visible to caller.
async function loadVisibleThread(
  id: number,
  caller: User,
): Promise<
  | { ok: true; thread: typeof forumThreadsTable.$inferSelect }
  | { ok: false; status: number; message: string }
> {
  const [thread] = await db
    .select()
    .from(forumThreadsTable)
    .where(
      and(eq(forumThreadsTable.id, id), isNull(forumThreadsTable.deletedAt)),
    );
  if (!thread) return { ok: false, status: 404, message: "Tema no encontrado" };
  if (!(await moduleVisibleTo(caller, { centerId: thread.centerId }))) {
    return { ok: false, status: 403, message: "Permiso denegado" };
  }
  return { ok: true, thread };
}

export default router;
