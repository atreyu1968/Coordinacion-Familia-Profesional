import { Router, type IRouter } from "express";
import {
  eq,
  and,
  or,
  isNull,
  inArray,
  desc,
  asc,
  count,
  type SQL,
} from "drizzle-orm";
import {
  db,
  surveysTable,
  surveyQuestionsTable,
  surveyResponsesTable,
  surveyAnswersTable,
  centersTable,
} from "@workspace/db";
import {
  ListSurveysQueryParams,
  ListSurveysResponse,
  CreateSurveyBody,
  GetSurveyParams,
  DeleteSurveyParams,
  SubmitSurveyResponseParams,
  SubmitSurveyResponseBody,
  GetSurveyResultsParams,
} from "@workspace/api-zod";
import {
  requireAuth,
  requireRole,
  resolveReadScope,
  type ReadScope,
} from "../middlewares/auth";
import { toSurvey } from "../lib/mappers";

const router: IRouter = Router();

// Resolve the caller's effective province id (province roles carry it directly;
// center roles derive it from their center). Returns null for superadmin or a
// user without province/center.
async function resolveEffectiveProvinceId(
  scope: ReadScope,
): Promise<number | null> {
  if (scope.kind === "province") return scope.provinceId;
  if (scope.kind === "center") {
    const [center] = await db
      .select({ provinceId: centersTable.provinceId })
      .from(centersTable)
      .where(eq(centersTable.id, scope.centerId));
    return center?.provinceId ?? null;
  }
  return null;
}

function canManageSurveys(role: string | undefined): boolean {
  return role === "superadmin" || role === "coordinator";
}

// Whether the caller is allowed to see/interact with a survey given its
// province scope. Global surveys (provinceId null) are visible to everyone;
// province-scoped surveys only to superadmins and users in that province.
async function callerCanAccessSurvey(
  scope: ReadScope,
  surveyProvinceId: number | null,
): Promise<boolean> {
  if (scope.kind === "global") return true;
  if (surveyProvinceId == null) return true;
  const provinceId = await resolveEffectiveProvinceId(scope);
  return provinceId != null && provinceId === surveyProvinceId;
}

// ---------------------------------------------------------------------------
// List surveys (province + global scoped)
// ---------------------------------------------------------------------------
router.get("/surveys", requireAuth, async (req, res): Promise<void> => {
  const query = ListSurveysQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ message: query.error.message });
    return;
  }
  const caller = req.user!;
  const scope = resolveReadScope(caller);

  const filters: SQL[] = [isNull(surveysTable.deletedAt)];

  // Visibility: superadmin sees all; everyone else sees surveys in their own
  // province plus global surveys (provinceId IS NULL).
  if (scope.kind !== "global") {
    const provinceId = await resolveEffectiveProvinceId(scope);
    const scopeMatch =
      provinceId != null
        ? or(
            isNull(surveysTable.provinceId),
            eq(surveysTable.provinceId, provinceId),
          )
        : isNull(surveysTable.provinceId);
    if (scopeMatch) filters.push(scopeMatch);
  }

  // Drafts are only visible to users who can manage surveys; participants only
  // see surveys that are open or already closed.
  if (!canManageSurveys(caller.role)) {
    const notDraft = or(
      eq(surveysTable.status, "open"),
      eq(surveysTable.status, "closed"),
    );
    if (notDraft) filters.push(notDraft);
  }

  if (query.data.status) {
    filters.push(eq(surveysTable.status, query.data.status));
  }
  if (query.data.provinceId != null) {
    filters.push(eq(surveysTable.provinceId, query.data.provinceId));
  }

  const rows = await db
    .select()
    .from(surveysTable)
    .where(and(...filters))
    .orderBy(desc(surveysTable.createdAt));

  res.json(ListSurveysResponse.parse(rows.map(toSurvey)));
});

// ---------------------------------------------------------------------------
// Create survey (superadmin global/any; coordinator pinned to own province)
// ---------------------------------------------------------------------------
router.post(
  "/surveys",
  requireAuth,
  requireRole("superadmin", "coordinator"),
  async (req, res): Promise<void> => {
    const parsed = CreateSurveyBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }
    const caller = req.user!;
    const data = parsed.data;

    if (data.questions.length === 0) {
      res
        .status(400)
        .json({ message: "La encuesta debe tener al menos una pregunta" });
      return;
    }

    // Coordinators are province-bound: the survey is pinned to their province.
    let provinceId: number | null;
    if (caller.role === "superadmin") {
      provinceId = data.provinceId ?? null;
    } else {
      if (caller.provinceId == null) {
        res.status(403).json({ message: "No tienes una provincia asignada" });
        return;
      }
      provinceId = caller.provinceId;
    }

    const created = await db.transaction(async (tx) => {
      const [survey] = await tx
        .insert(surveysTable)
        .values({
          title: data.title,
          description: data.description ?? null,
          type: data.type,
          anonymous: data.anonymous,
          status: "open",
          provinceId,
          opensAt: data.opensAt ?? null,
          closesAt: data.closesAt ?? null,
          createdById: caller.id,
        })
        .returning();

      await tx.insert(surveyQuestionsTable).values(
        data.questions.map((q, i) => ({
          surveyId: survey!.id,
          text: q.text,
          type: q.type,
          options: q.options ?? [],
          order: q.order ?? i,
        })),
      );

      return survey!;
    });

    res.status(201).json(toSurvey(created));
  },
);

// ---------------------------------------------------------------------------
// Get survey detail (with questions and whether the caller has voted)
// ---------------------------------------------------------------------------
router.get("/surveys/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetSurveyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ message: params.error.message });
    return;
  }
  const caller = req.user!;

  const [survey] = await db
    .select()
    .from(surveysTable)
    .where(
      and(eq(surveysTable.id, params.data.id), isNull(surveysTable.deletedAt)),
    );
  if (!survey) {
    res.status(404).json({ message: "Encuesta no encontrada" });
    return;
  }

  if (!(await callerCanAccessSurvey(resolveReadScope(caller), survey.provinceId))) {
    res.status(403).json({ message: "Permiso denegado" });
    return;
  }

  const questions = await db
    .select()
    .from(surveyQuestionsTable)
    .where(eq(surveyQuestionsTable.surveyId, survey.id))
    .orderBy(asc(surveyQuestionsTable.order));

  const [voted] = await db
    .select({ id: surveyResponsesTable.id })
    .from(surveyResponsesTable)
    .where(
      and(
        eq(surveyResponsesTable.surveyId, survey.id),
        eq(surveyResponsesTable.userId, caller.id),
      ),
    );

  res.json({
    ...toSurvey(survey),
    questions: questions.map((q) => ({
      id: q.id,
      text: q.text,
      type: q.type as "single" | "multiple" | "text" | "scale",
      options: q.options ?? [],
      order: q.order,
    })),
    hasVoted: Boolean(voted),
  });
});

// ---------------------------------------------------------------------------
// Delete survey (soft delete; managers within scope only)
// ---------------------------------------------------------------------------
router.delete(
  "/surveys/:id",
  requireAuth,
  requireRole("superadmin", "coordinator"),
  async (req, res): Promise<void> => {
    const params = DeleteSurveyParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const caller = req.user!;

    const [survey] = await db
      .select()
      .from(surveysTable)
      .where(
        and(eq(surveysTable.id, params.data.id), isNull(surveysTable.deletedAt)),
      );
    if (!survey) {
      res.status(404).json({ message: "Encuesta no encontrada" });
      return;
    }

    // Coordinators may only delete surveys within their own province.
    if (
      caller.role === "coordinator" &&
      survey.provinceId !== caller.provinceId
    ) {
      res.status(403).json({ message: "Permiso denegado" });
      return;
    }

    await db
      .update(surveysTable)
      .set({ deletedAt: new Date() })
      .where(eq(surveysTable.id, survey.id));

    res.status(204).end();
  },
);

// ---------------------------------------------------------------------------
// Submit a response / vote
// ---------------------------------------------------------------------------
router.post(
  "/surveys/:id/responses",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = SubmitSurveyResponseParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const body = SubmitSurveyResponseBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ message: body.error.message });
      return;
    }
    const caller = req.user!;

    const [survey] = await db
      .select()
      .from(surveysTable)
      .where(
        and(eq(surveysTable.id, params.data.id), isNull(surveysTable.deletedAt)),
      );
    if (!survey) {
      res.status(404).json({ message: "Encuesta no encontrada" });
      return;
    }
    if (
      !(await callerCanAccessSurvey(resolveReadScope(caller), survey.provinceId))
    ) {
      res.status(403).json({ message: "Permiso denegado" });
      return;
    }
    if (survey.status !== "open") {
      res
        .status(409)
        .json({ message: "Esta encuesta no está abierta a participación" });
      return;
    }

    // Load the full question set so we can validate answers server-side.
    const questions = await db
      .select()
      .from(surveyQuestionsTable)
      .where(eq(surveyQuestionsTable.surveyId, survey.id));
    const questionById = new Map(questions.map((q) => [q.id, q]));

    // Reject duplicate questionIds so a single user cannot over-weight results.
    const seen = new Set<number>();
    for (const ans of body.data.answers) {
      if (seen.has(ans.questionId)) {
        res
          .status(400)
          .json({ message: "Respuesta duplicada para una pregunta" });
        return;
      }
      seen.add(ans.questionId);
    }

    // Require exactly one answer per question (every question answered, nothing
    // extra) and enforce type-specific constraints.
    if (body.data.answers.length !== questions.length) {
      res
        .status(400)
        .json({ message: "Debes responder todas las preguntas" });
      return;
    }
    for (const ans of body.data.answers) {
      const q = questionById.get(ans.questionId);
      if (!q) {
        res
          .status(400)
          .json({ message: "Respuesta a una pregunta inexistente" });
        return;
      }
      const allowed = new Set(q.options ?? []);
      if (q.type === "single" || q.type === "scale") {
        if (ans.value.length !== 1 || !allowed.has(ans.value[0]!)) {
          res
            .status(400)
            .json({ message: "Selecciona una única opción válida" });
          return;
        }
      } else if (q.type === "multiple") {
        if (
          ans.value.length === 0 ||
          new Set(ans.value).size !== ans.value.length ||
          ans.value.some((v) => !allowed.has(v))
        ) {
          res
            .status(400)
            .json({ message: "Selección de opciones no válida" });
          return;
        }
      } else {
        // text
        if (ans.value.length !== 1 || ans.value[0]!.trim().length === 0) {
          res
            .status(400)
            .json({ message: "La respuesta de texto no puede estar vacía" });
          return;
        }
      }
    }

    try {
      await db.transaction(async (tx) => {
        // Participation marker (also enforces one-response-per-user via the
        // unique constraint). For anonymous surveys we deliberately do NOT
        // attach this id to the answers, so answers stay unlinkable to the user.
        const [response] = await tx
          .insert(surveyResponsesTable)
          .values({ surveyId: survey.id, userId: caller.id })
          .returning();

        const responseId = survey.anonymous ? null : response!.id;
        // Anonymous answers carry no timestamp: a per-answer timestamp could be
        // correlated with the participation-marker timestamp to re-link a user
        // to their answers. Non-anonymous answers keep a timestamp for auditing.
        const createdAt = survey.anonymous ? null : new Date();

        if (body.data.answers.length > 0) {
          await tx.insert(surveyAnswersTable).values(
            body.data.answers.map((a) => ({
              surveyId: survey.id,
              questionId: a.questionId,
              responseId,
              value: a.value,
              createdAt,
            })),
          );
        }
      });
    } catch (err) {
      // Unique violation => the user already responded. Drizzle wraps the pg
      // error, so the SQLSTATE code may live on the error or its `cause`.
      const code =
        (err as { code?: string })?.code ??
        (err as { cause?: { code?: string } })?.cause?.code;
      if (code === "23505") {
        res.status(409).json({ message: "Ya has participado en esta encuesta" });
        return;
      }
      throw err;
    }

    res.json({ ok: true });
  },
);

// ---------------------------------------------------------------------------
// Aggregated, real-time results
// ---------------------------------------------------------------------------
router.get(
  "/surveys/:id/results",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = GetSurveyResultsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const caller = req.user!;

    const [survey] = await db
      .select()
      .from(surveysTable)
      .where(
        and(eq(surveysTable.id, params.data.id), isNull(surveysTable.deletedAt)),
      );
    if (!survey) {
      res.status(404).json({ message: "Encuesta no encontrada" });
      return;
    }
    if (
      !(await callerCanAccessSurvey(resolveReadScope(caller), survey.provinceId))
    ) {
      res.status(403).json({ message: "Permiso denegado" });
      return;
    }

    const questions = await db
      .select()
      .from(surveyQuestionsTable)
      .where(eq(surveyQuestionsTable.surveyId, survey.id))
      .orderBy(asc(surveyQuestionsTable.order));

    const [{ total } = { total: 0 }] = await db
      .select({ total: count() })
      .from(surveyResponsesTable)
      .where(eq(surveyResponsesTable.surveyId, survey.id));

    const questionIds = questions.map((q) => q.id);
    const answers = questionIds.length
      ? await db
          .select({
            questionId: surveyAnswersTable.questionId,
            value: surveyAnswersTable.value,
          })
          .from(surveyAnswersTable)
          .where(inArray(surveyAnswersTable.questionId, questionIds))
      : [];

    const byQuestion = new Map<number, string[][]>();
    for (const a of answers) {
      const list = byQuestion.get(a.questionId) ?? [];
      list.push(a.value);
      byQuestion.set(a.questionId, list);
    }

    const questionResults = questions.map((q) => {
      const rawAnswers = byQuestion.get(q.id) ?? [];
      if (q.type === "text") {
        // Free-text answers are listed verbatim (one entry per submitted value).
        const textAnswers = rawAnswers
          .flat()
          .filter((v) => v.trim().length > 0);
        return { questionId: q.id, text: q.text, textAnswers };
      }
      // Option-based: count each selected label. For scale questions the value
      // is the chosen number as a string label.
      const counts = new Map<string, number>();
      const labels =
        q.options && q.options.length > 0
          ? [...q.options]
          : [];
      for (const label of labels) counts.set(label, 0);
      for (const valueArr of rawAnswers) {
        for (const v of valueArr) {
          counts.set(v, (counts.get(v) ?? 0) + 1);
        }
      }
      const options = [...counts.entries()].map(([label, c]) => ({
        label,
        count: c,
      }));
      return { questionId: q.id, text: q.text, options };
    });

    res.json({
      surveyId: survey.id,
      totalResponses: total,
      questions: questionResults,
    });
  },
);

export default router;
