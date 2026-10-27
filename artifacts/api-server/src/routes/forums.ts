import { Router, type IRouter } from "express";
import {
  eq,
  and,
  or,
  isNull,
  inArray,
  ilike,
  sql,
  desc,
  asc,
  type SQL,
} from "drizzle-orm";
import {
  db,
  forumThreadsTable,
  forumPostsTable,
  forumThreadReadsTable,
  modulesTable,
  centersTable,
  usersTable,
  teachingAssignmentsTable,
  moduleMembershipsTable,
  type User,
} from "@workspace/db";
import {
  ListForumModulesResponse,
  GetForumThreadParams,
  GetForumThreadResponse,
  ListForumThreadsQueryParams,
  ListForumThreadsResponse,
  CreateForumThreadBody,
  DeleteForumThreadParams,
  UpdateForumThreadParams,
  UpdateForumThreadBody,
  PinForumThreadParams,
  PinForumThreadBody,
  MarkForumThreadReadParams,
  ListForumPostsParams,
  ListForumPostsResponse,
  CreateForumPostParams,
  CreateForumPostBody,
  UpdateForumPostParams,
  UpdateForumPostBody,
  DeleteForumPostParams,
} from "@workspace/api-zod";
import {
  requireAuth,
  resolveReadScope,
  hasScopeOver,
  isModuleCoordinator,
  isModuleForumModerator,
  type ReadScope,
} from "../middlewares/auth";
import { toForumModule, toForumThread, toForumPost } from "../lib/mappers";
import { notifyUsers } from "../lib/notify";
import { resolveAudienceUserIds } from "../lib/audience";
import { getActiveFamily, getActiveAcademicYear } from "../lib/settings";
import { moduleFamilyFilter } from "../lib/familyCatalog";

const router: IRouter = Router();

const MANAGER_ROLES = ["superadmin", "coordinator", "department_head"];

// Count of messages in a thread the caller hasn't seen yet: posts newer than
// the caller's read marker (or all of them if never opened), authored by
// someone else. Used as a correlated subquery against a thread alias column.
function unreadCountFor(callerId: number, threadIdCol: SQL | unknown): SQL<number> {
  return sql<number>`(
    select count(*)::int from ${forumPostsTable} p
    where p.thread_id = ${threadIdCol}
      and p.deleted_at is null
      and p.author_id is distinct from ${callerId}
      and p.created_at > coalesce((
        select r.last_read_at from ${forumThreadReadsTable} r
        where r.user_id = ${callerId} and r.thread_id = ${threadIdCol}
      ), '1970-01-01'::timestamptz)
  )`;
}

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

async function moduleBelongsToActiveFamily(moduleId: number): Promise<boolean> {
  const [matchingModule] = await db
    .select({ id: modulesTable.id })
    .from(modulesTable)
    .where(
      and(
        eq(modulesTable.id, moduleId),
        isNull(modulesTable.deletedAt),
        moduleFamilyFilter(await getActiveFamily()),
      ),
    )
    .limit(1);
  return matchingModule != null;
}

// Whether the caller may read/post within a specific module's forum.
async function moduleVisibleTo(
  caller: User,
  module: { id: number; centerId: number | null },
): Promise<boolean> {
  if (!(await moduleBelongsToActiveFamily(module.id))) return false;
  if (
    (await isModuleCoordinator(caller.id, module.id)) ||
    (await isModuleForumModerator(caller.id, module.id))
  ) {
    return true;
  }
  if (module.centerId == null) return true; // global module
  const scope = resolveReadScope(caller);
  if (scope.kind === "global") return true;
  if (scope.kind === "center" && module.centerId === scope.centerId) return true;
  if (scope.kind === "province") {
    const [center] = await db
      .select({ provinceId: centersTable.provinceId })
      .from(centersTable)
      .where(eq(centersTable.id, module.centerId));
    if (center?.provinceId === scope.provinceId) return true;
  }
  // Management scope and personal teaching center can differ. Teaching a module
  // grants forum participation without an additional manual enrollment.
  const year = await getActiveAcademicYear();
  if (!year) return false;
  const [assignment] = await db.select({ id: teachingAssignmentsTable.id })
    .from(teachingAssignmentsTable).where(and(
      eq(teachingAssignmentsTable.teacherId, caller.id),
      eq(teachingAssignmentsTable.moduleId, module.id),
      eq(teachingAssignmentsTable.schoolYear, year),
      isNull(teachingAssignmentsTable.deletedAt),
    )).limit(1);
  return assignment != null;
}

async function moduleVisibleById(
  caller: User,
  moduleId: number,
): Promise<boolean> {
  const [module] = await db
    .select({ id: modulesTable.id, centerId: modulesTable.centerId })
    .from(modulesTable)
    .where(
      and(
        eq(modulesTable.id, moduleId),
        isNull(modulesTable.deletedAt),
      ),
    );
  return module ? moduleVisibleTo(caller, module) : false;
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

async function canModerateForumModule(
  caller: User,
  moduleId: number,
  centerId: number | null,
): Promise<boolean> {
  const managerWithinScope =
    MANAGER_ROLES.includes(caller.role) &&
    hasScopeOver(caller, {
      provinceId: await provinceOfCenter(centerId),
      centerId,
    });
  return (
    managerWithinScope ||
    (await isModuleCoordinator(caller.id, moduleId)) ||
    (await isModuleForumModerator(caller.id, moduleId))
  );
}

// ---------------------------------------------------------------------------
// List modules with their forum thread counts (UI groups them by cycle)
// ---------------------------------------------------------------------------
router.get("/forum/modules", requireAuth, async (req, res): Promise<void> => {
  const caller = req.user!;
  const scope = resolveReadScope(caller);

  const filters: SQL[] = [
    isNull(modulesTable.deletedAt),
    moduleFamilyFilter(await getActiveFamily()),
  ];
  const scopeMatch = moduleScopeFilter(scope);
  if (scopeMatch) {
    const year = await getActiveAcademicYear();
    const visibleModuleClauses: SQL[] = [
      scopeMatch,
      inArray(
        modulesTable.id,
        db
          .select({ moduleId: moduleMembershipsTable.moduleId })
          .from(moduleMembershipsTable)
          .where(and(
            eq(moduleMembershipsTable.userId, caller.id),
            or(
              eq(moduleMembershipsTable.role, "coordinator"),
              eq(moduleMembershipsTable.forumModerator, true),
            ),
            isNull(moduleMembershipsTable.deletedAt),
          )),
      ),
    ];
    if (year) {
      visibleModuleClauses.push(
        inArray(
          modulesTable.id,
          db
            .select({ moduleId: teachingAssignmentsTable.moduleId })
            .from(teachingAssignmentsTable)
            .where(and(
              eq(teachingAssignmentsTable.teacherId, caller.id),
              eq(teachingAssignmentsTable.schoolYear, year),
              isNull(teachingAssignmentsTable.deletedAt),
            )),
        ),
      );
    }
    filters.push(or(...visibleModuleClauses)!);
  }

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

  // Unread messages per module: posts the caller hasn't seen, across all the
  // module's non-deleted threads.
  const unread = await db
    .select({
      moduleId: forumThreadsTable.moduleId,
      count: sql<number>`coalesce(sum(${unreadCountFor(
        caller.id,
        forumThreadsTable.id,
      )}), 0)::int`,
    })
    .from(forumThreadsTable)
    .where(isNull(forumThreadsTable.deletedAt))
    .groupBy(forumThreadsTable.moduleId);
  const unreadMap = new Map(unread.map((u) => [u.moduleId, u.count]));

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
          unreadCount: unreadMap.get(m.id) ?? 0,
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
  const canModerate = await canModerateForumModule(
    caller,
    module.id,
    module.centerId,
  );

  const threadFilters: SQL[] = [
    eq(forumThreadsTable.moduleId, query.data.moduleId),
    isNull(forumThreadsTable.deletedAt),
  ];
  const q = query.data.q?.trim();
  if (q) threadFilters.push(ilike(forumThreadsTable.title, `%${q}%`));

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
      pinnedAt: forumThreadsTable.pinnedAt,
      editedAt: forumThreadsTable.editedAt,
      createdAt: forumThreadsTable.createdAt,
      lastPostAt: forumThreadsTable.lastPostAt,
      postCount: sql<number>`(
        select count(*)::int from ${forumPostsTable}
        where ${forumPostsTable.threadId} = ${forumThreadsTable.id}
          and ${forumPostsTable.deletedAt} is null
      )`,
      unreadCount: unreadCountFor(caller.id, forumThreadsTable.id),
    })
    .from(forumThreadsTable)
    .leftJoin(modulesTable, eq(modulesTable.id, forumThreadsTable.moduleId))
    .leftJoin(usersTable, eq(usersTable.id, forumThreadsTable.authorId))
    .where(and(...threadFilters))
    .orderBy(
      // Pinned threads first (most recently pinned on top), then by activity.
      sql`${forumThreadsTable.pinnedAt} desc nulls last`,
      desc(forumThreadsTable.lastPostAt),
    );

  res.json(
    ListForumThreadsResponse.parse(
      rows.map((row) => ({ ...toForumThread(row), canModerate })),
    ),
  );
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

  const recipientIds = (await resolveAudienceUserIds("module", [module.id]))
    .filter((id) => id !== caller.id);
  if (recipientIds.length > 0) {
    await notifyUsers(recipientIds, {
      title: `Nuevo tema en el foro: ${thread.title}`,
      body: `Nuevo tema en el módulo ${module.name}.`,
      type: "forum_thread",
      data: { threadId: thread.id },
    });
  }

  res.status(201).json(
    {
      ...toForumThread({
        ...thread,
        moduleName: module.name,
        cycleName: module.cycleName,
        authorName: caller.name,
        postCount: 1,
        unreadCount: 0,
      }),
      canModerate: await canModerateForumModule(
        caller,
        module.id,
        module.centerId,
      ),
    },
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
    if (!(await moduleVisibleById(caller, thread.moduleId))) {
      res.status(403).json({ message: "Módulo fuera de tu ámbito" });
      return;
    }

    const isAuthor = thread.authorId === caller.id;
    const canManage = await canModerateForumModule(
      caller,
      thread.moduleId,
      thread.centerId,
    );
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
        editedAt: forumPostsTable.editedAt,
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

    // Notify everyone who has taken part in the thread (its author + previous
    // repliers), except the person replying now. Best-effort.
    void notifyThreadParticipants(thread.thread, caller, body.data.content);

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
    if (!thread || !(await moduleVisibleById(caller, thread.moduleId))) {
      res.status(403).json({ message: "Módulo fuera de tu ámbito" });
      return;
    }

    const isAuthor = post.authorId === caller.id;
    const canManage =
      thread != null &&
      (await canModerateForumModule(
        caller,
        thread.moduleId,
        thread.centerId,
      ));
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

// ---------------------------------------------------------------------------
// Edit a thread title (author only) — sets editedAt
// ---------------------------------------------------------------------------
router.patch(
  "/forum/threads/:id",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = UpdateForumThreadParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const body = UpdateForumThreadBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ message: body.error.message });
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
    if (!(await moduleVisibleById(caller, thread.moduleId))) {
      res.status(403).json({ message: "Módulo fuera de tu ámbito" });
      return;
    }
    if (thread.authorId !== caller.id) {
      res.status(403).json({ message: "Solo el autor puede editar" });
      return;
    }

    await db
      .update(forumThreadsTable)
      .set({ title: body.data.title, editedAt: new Date() })
      .where(eq(forumThreadsTable.id, thread.id));

    const out = await loadThreadResponse(thread.id, caller);
    res.json(out);
  },
);

// ---------------------------------------------------------------------------
// Pin or unpin a thread (manager within scope only)
// ---------------------------------------------------------------------------
router.put(
  "/forum/threads/:id/pinned",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = PinForumThreadParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const body = PinForumThreadBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ message: body.error.message });
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
    if (!(await moduleVisibleById(caller, thread.moduleId))) {
      res.status(403).json({ message: "Módulo fuera de tu ámbito" });
      return;
    }

    const canManage = await canModerateForumModule(
      caller,
      thread.moduleId,
      thread.centerId,
    );
    if (!canManage) {
      res.status(403).json({ message: "Permiso denegado" });
      return;
    }

    await db
      .update(forumThreadsTable)
      .set({ pinnedAt: body.data.pinned ? new Date() : null })
      .where(eq(forumThreadsTable.id, thread.id));

    const out = await loadThreadResponse(thread.id, caller);
    res.json(out);
  },
);

// ---------------------------------------------------------------------------
// Mark a thread as read for the current user (upsert read marker)
// ---------------------------------------------------------------------------
router.post(
  "/forum/threads/:id/read",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = MarkForumThreadReadParams.safeParse(req.params);
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

    await db
      .insert(forumThreadReadsTable)
      .values({
        userId: caller.id,
        threadId: thread.thread.id,
        lastReadAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [forumThreadReadsTable.userId, forumThreadReadsTable.threadId],
        set: { lastReadAt: new Date() },
      });
    res.sendStatus(204);
  },
);

// ---------------------------------------------------------------------------
// Edit a message (author only) — sets editedAt
// ---------------------------------------------------------------------------
router.patch(
  "/forum/posts/:id",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = UpdateForumPostParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const body = UpdateForumPostBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ message: body.error.message });
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
    if (!thread || !(await moduleVisibleById(caller, thread.moduleId))) {
      res.status(403).json({ message: "Módulo fuera de tu ámbito" });
      return;
    }
    if (post.authorId !== caller.id) {
      res.status(403).json({ message: "Solo el autor puede editar" });
      return;
    }

    const [updated] = await db
      .update(forumPostsTable)
      .set({ content: body.data.content, editedAt: new Date() })
      .where(eq(forumPostsTable.id, post.id))
      .returning();
    res.json(toForumPost({ ...updated!, authorName: caller.name }));
  },
);

// Build the full ForumThread response shape for a single thread (used after
// edit/pin mutations so the client gets the recomputed counts and flags).
async function loadThreadResponse(threadId: number, caller: User) {
  const [row] = await db
    .select({
      id: forumThreadsTable.id,
      moduleId: forumThreadsTable.moduleId,
      moduleName: modulesTable.name,
      cycleName: modulesTable.cycleName,
      centerId: forumThreadsTable.centerId,
      title: forumThreadsTable.title,
      authorId: forumThreadsTable.authorId,
      authorName: usersTable.name,
      pinnedAt: forumThreadsTable.pinnedAt,
      editedAt: forumThreadsTable.editedAt,
      createdAt: forumThreadsTable.createdAt,
      lastPostAt: forumThreadsTable.lastPostAt,
      postCount: sql<number>`(
        select count(*)::int from ${forumPostsTable}
        where ${forumPostsTable.threadId} = ${forumThreadsTable.id}
          and ${forumPostsTable.deletedAt} is null
      )`,
      unreadCount: unreadCountFor(caller.id, forumThreadsTable.id),
    })
    .from(forumThreadsTable)
    .leftJoin(modulesTable, eq(modulesTable.id, forumThreadsTable.moduleId))
    .leftJoin(usersTable, eq(usersTable.id, forumThreadsTable.authorId))
    .where(eq(forumThreadsTable.id, threadId));
  return row
    ? {
        ...toForumThread(row),
        canModerate: await canModerateForumModule(
          caller,
          row.moduleId,
          row.centerId,
        ),
      }
    : null;
}

// Notify the thread's author and prior repliers (except the current poster)
// that a new reply was posted. Best-effort: failures are swallowed by notify.
async function notifyThreadParticipants(
  thread: typeof forumThreadsTable.$inferSelect,
  poster: User,
  content: string,
): Promise<void> {
  const repliers = await db
    .selectDistinct({ authorId: forumPostsTable.authorId })
    .from(forumPostsTable)
    .where(
      and(
        eq(forumPostsTable.threadId, thread.id),
        isNull(forumPostsTable.deletedAt),
      ),
    );
  const ids = new Set<number>();
  if (thread.authorId != null) ids.add(thread.authorId);
  for (const r of repliers) if (r.authorId != null) ids.add(r.authorId);
  ids.delete(poster.id);
  if (ids.size === 0) return;

  const participants = await db
    .select()
    .from(usersTable)
    .where(
      and(
        inArray(usersTable.id, [...ids]),
        eq(usersTable.status, "active"),
        isNull(usersTable.deletedAt),
      ),
    );
  const visibleIds = (
    await Promise.all(
      participants.map(async (participant) =>
        (await moduleVisibleById(participant, thread.moduleId))
          ? participant.id
          : null,
      ),
    )
  ).filter((id): id is number => id != null);
  if (visibleIds.length === 0) return;

  const snippet = content.length > 120 ? `${content.slice(0, 117)}…` : content;
  await notifyUsers(visibleIds, {
    title: `Nueva respuesta en «${thread.title}»`,
    body: `${poster.name}: ${snippet}`,
    type: "forum_reply",
    data: { threadId: thread.id },
  });
}

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
  if (!(await moduleVisibleById(caller, thread.moduleId))) {
    return { ok: false, status: 403, message: "Permiso denegado" };
  }
  return { ok: true, thread };
}

router.get("/forum/threads/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetForumThreadParams.safeParse(req.params);
  if (!params.success || !Number.isSafeInteger(params.data.id) || params.data.id < 1 || params.data.id > 2147483647) {
    res.status(400).json({ error: "Identificador no válido" });
    return;
  }
  const loaded = await loadVisibleThread(params.data.id, req.user!);
  if (!loaded.ok) {
    res.status(loaded.status).json({ error: loaded.message });
    return;
  }
  res.json(
    GetForumThreadResponse.parse(
      await loadThreadResponse(loaded.thread.id, req.user!),
    ),
  );
});

export default router;
