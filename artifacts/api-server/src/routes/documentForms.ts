import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { eq, and, isNull, inArray, desc, asc, count } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import {
  db,
  documentFormsTable,
  documentFormFieldsTable,
  documentSubmissionsTable,
  documentSubmissionValuesTable,
  usersTable,
  centersTable,
} from "@workspace/db";
import {
  ListDocumentFormsQueryParams,
  CreateDocumentFormBody,
  GetDocumentFormParams,
  DeleteDocumentFormParams,
  ListDocumentFormSubmissionsParams,
  SubmitDocumentFormParams,
  SubmitDocumentFormBody,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middlewares/auth";
import {
  canCreateFormsSurveys,
  validateAudience,
  getViewerContext,
  isInAudience,
  canManageAudience,
} from "../lib/audience";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { getObjectAclPolicy, setObjectAclPolicy } from "../lib/objectAcl";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

const FIELD_TYPES = new Set(["text", "textarea", "select", "file"]);

// ---------------------------------------------------------------------------
// List forms (visibility by audience membership)
// ---------------------------------------------------------------------------
router.get("/document-forms", requireAuth, async (req, res): Promise<void> => {
  const query = ListDocumentFormsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ message: query.error.message });
    return;
  }
  const caller = req.user!;

  const filters: SQL[] = [isNull(documentFormsTable.deletedAt)];

  if (query.data.status) {
    filters.push(eq(documentFormsTable.status, query.data.status));
  }

  const allRows = await db
    .select()
    .from(documentFormsTable)
    .where(and(...filters))
    .orderBy(desc(documentFormsTable.createdAt));

  // Visibility by audience membership. Superadmins see everything; creators see
  // their own; everyone else only forms whose audience includes them. Drafts are
  // only visible to superadmins and the creator.
  const isSuperadmin = caller.role === "superadmin";
  const viewerCtx = isSuperadmin ? null : await getViewerContext(caller);
  const rows = allRows.filter((r) => {
    const isCreator = r.createdById === caller.id;
    if (r.status === "draft" && !isSuperadmin && !isCreator) return false;
    if (isSuperadmin || isCreator) return true;
    return isInAudience(r.audienceType, r.audienceIds, viewerCtx!);
  });

  const formIds = rows.map((r) => r.id);

  // Field counts per form.
  const fieldCounts = formIds.length
    ? await db
        .select({
          formId: documentFormFieldsTable.formId,
          c: count(),
        })
        .from(documentFormFieldsTable)
        .where(inArray(documentFormFieldsTable.formId, formIds))
        .groupBy(documentFormFieldsTable.formId)
    : [];
  const countByForm = new Map(fieldCounts.map((f) => [f.formId, Number(f.c)]));

  // Which of these forms the caller has already submitted.
  const mySubs = formIds.length
    ? await db
        .select({ formId: documentSubmissionsTable.formId })
        .from(documentSubmissionsTable)
        .where(
          and(
            inArray(documentSubmissionsTable.formId, formIds),
            eq(documentSubmissionsTable.userId, caller.id),
          ),
        )
    : [];
  const submittedForms = new Set(mySubs.map((s) => s.formId));

  res.json(
    rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      status: r.status as "draft" | "open" | "closed",
      provinceId: r.provinceId,
      audienceType: r.audienceType as
        | "all"
        | "province"
        | "island"
        | "center"
        | "module"
        | "users",
      audienceIds: r.audienceIds ?? [],
      closesAt: r.closesAt,
      createdAt: r.createdAt,
      hasSubmitted: submittedForms.has(r.id),
      fieldCount: countByForm.get(r.id) ?? 0,
    })),
  );
});

// ---------------------------------------------------------------------------
// Create form (superadmin global/any; coordinator pinned to own province)
// ---------------------------------------------------------------------------
router.post(
  "/document-forms",
  requireAuth,
  async (req, res): Promise<void> => {
    const caller = req.user!;
    if (!(await canCreateFormsSurveys(caller))) {
      res.status(403).json({ message: "Permiso denegado" });
      return;
    }
    const parsed = CreateDocumentFormBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }
    const data = parsed.data;

    const audience = await validateAudience(
      caller,
      data.audienceType,
      data.audienceIds,
    );
    if (!audience.ok) {
      res.status(403).json({ message: audience.message });
      return;
    }

    if (data.fields.length === 0) {
      res
        .status(400)
        .json({ message: "El formulario debe tener al menos un campo" });
      return;
    }
    for (const f of data.fields) {
      if (!FIELD_TYPES.has(f.type)) {
        res.status(400).json({ message: "Tipo de campo no válido" });
        return;
      }
      if (
        f.type === "select" &&
        (!f.options || f.options.filter((o) => o.trim().length > 0).length === 0)
      ) {
        res.status(400).json({
          message: "Los campos de selección requieren opciones",
        });
        return;
      }
    }

    // Legacy provinceId mirrors a single-province audience for display; null
    // otherwise. Audience is the source of truth for visibility.
    const provinceId =
      audience.audienceType === "province" && audience.audienceIds.length === 1
        ? audience.audienceIds[0]!
        : null;

    const created = await db.transaction(async (tx) => {
      const [form] = await tx
        .insert(documentFormsTable)
        .values({
          title: data.title,
          description: data.description ?? null,
          status: "open",
          provinceId,
          audienceType: audience.audienceType,
          audienceIds: audience.audienceIds,
          closesAt: data.closesAt ? new Date(data.closesAt) : null,
          createdById: caller.id,
        })
        .returning();

      const insertedFields = await tx
        .insert(documentFormFieldsTable)
        .values(
          data.fields.map((f, i) => ({
            formId: form!.id,
            label: f.label,
            type: f.type,
            options: f.options ?? [],
            required: f.required ?? true,
            order: f.order ?? i,
          })),
        )
        .returning();

      return { form: form!, fields: insertedFields };
    });

    res.status(201).json({
      id: created.form.id,
      title: created.form.title,
      description: created.form.description,
      status: created.form.status as "draft" | "open" | "closed",
      provinceId: created.form.provinceId,
      audienceType: created.form.audienceType as
        | "all"
        | "province"
        | "island"
        | "center"
        | "module"
        | "users",
      audienceIds: created.form.audienceIds ?? [],
      closesAt: created.form.closesAt,
      createdAt: created.form.createdAt,
      fields: created.fields
        .sort((a, b) => a.order - b.order)
        .map((f) => ({
          id: f.id,
          label: f.label,
          type: f.type as "text" | "textarea" | "select" | "file",
          options: f.options ?? [],
          required: f.required,
          order: f.order,
        })),
      mySubmission: null,
    });
  },
);

// ---------------------------------------------------------------------------
// Get form detail (fields + caller's own submission)
// ---------------------------------------------------------------------------
router.get(
  "/document-forms/:id",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = GetDocumentFormParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const caller = req.user!;

    const [form] = await db
      .select()
      .from(documentFormsTable)
      .where(
        and(
          eq(documentFormsTable.id, params.data.id),
          isNull(documentFormsTable.deletedAt),
        ),
      );
    if (!form) {
      res.status(404).json({ message: "Formulario no encontrado" });
      return;
    }
    const isSuperadmin = caller.role === "superadmin";
    const isCreator = form.createdById === caller.id;
    if (form.status === "draft" && !isSuperadmin && !isCreator) {
      res.status(403).json({ message: "Permiso denegado" });
      return;
    }
    if (!isSuperadmin && !isCreator) {
      const ctx = await getViewerContext(caller);
      if (!isInAudience(form.audienceType, form.audienceIds, ctx)) {
        res.status(403).json({ message: "Permiso denegado" });
        return;
      }
    }

    const fields = await db
      .select()
      .from(documentFormFieldsTable)
      .where(eq(documentFormFieldsTable.formId, form.id))
      .orderBy(asc(documentFormFieldsTable.order));

    const [submission] = await db
      .select()
      .from(documentSubmissionsTable)
      .where(
        and(
          eq(documentSubmissionsTable.formId, form.id),
          eq(documentSubmissionsTable.userId, caller.id),
        ),
      );

    let mySubmission = null;
    if (submission) {
      const values = await db
        .select()
        .from(documentSubmissionValuesTable)
        .where(eq(documentSubmissionValuesTable.submissionId, submission.id));
      mySubmission = {
        id: submission.id,
        createdAt: submission.createdAt,
        updatedAt: submission.updatedAt,
        values: values.map((v) => ({
          id: v.id,
          fieldId: v.fieldId,
          value: v.value,
          objectPath: v.objectPath,
          fileName: v.fileName,
          fileSize: v.fileSize,
          contentType: v.contentType,
        })),
      };
    }

    res.json({
      id: form.id,
      title: form.title,
      description: form.description,
      status: form.status as "draft" | "open" | "closed",
      provinceId: form.provinceId,
      audienceType: form.audienceType as
        | "all"
        | "province"
        | "island"
        | "center"
        | "module"
        | "users",
      audienceIds: form.audienceIds ?? [],
      closesAt: form.closesAt,
      createdAt: form.createdAt,
      fields: fields.map((f) => ({
        id: f.id,
        label: f.label,
        type: f.type as "text" | "textarea" | "select" | "file",
        options: f.options ?? [],
        required: f.required,
        order: f.order,
      })),
      mySubmission,
    });
  },
);

// ---------------------------------------------------------------------------
// Delete form (soft delete; managers within scope only)
// ---------------------------------------------------------------------------
router.delete(
  "/document-forms/:id",
  requireAuth,
  requireRole("superadmin", "coordinator"),
  async (req, res): Promise<void> => {
    const params = DeleteDocumentFormParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const caller = req.user!;

    const [form] = await db
      .select()
      .from(documentFormsTable)
      .where(
        and(
          eq(documentFormsTable.id, params.data.id),
          isNull(documentFormsTable.deletedAt),
        ),
      );
    if (!form) {
      res.status(404).json({ message: "Formulario no encontrado" });
      return;
    }
    if (!(await canManageAudience(caller, form.audienceType, form.audienceIds))) {
      res.status(403).json({ message: "Permiso denegado" });
      return;
    }

    await db
      .update(documentFormsTable)
      .set({ deletedAt: new Date() })
      .where(eq(documentFormsTable.id, form.id));

    res.status(204).end();
  },
);

// ---------------------------------------------------------------------------
// List submissions for a form (managers only)
// ---------------------------------------------------------------------------
router.get(
  "/document-forms/:id/submissions",
  requireAuth,
  requireRole("superadmin", "coordinator"),
  async (req, res): Promise<void> => {
    const params = ListDocumentFormSubmissionsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const caller = req.user!;

    const [form] = await db
      .select()
      .from(documentFormsTable)
      .where(
        and(
          eq(documentFormsTable.id, params.data.id),
          isNull(documentFormsTable.deletedAt),
        ),
      );
    if (!form) {
      res.status(404).json({ message: "Formulario no encontrado" });
      return;
    }
    if (!(await canManageAudience(caller, form.audienceType, form.audienceIds))) {
      res.status(403).json({ message: "Permiso denegado" });
      return;
    }

    const fields = await db
      .select()
      .from(documentFormFieldsTable)
      .where(eq(documentFormFieldsTable.formId, form.id))
      .orderBy(asc(documentFormFieldsTable.order));

    const submissions = await db
      .select({
        id: documentSubmissionsTable.id,
        userId: documentSubmissionsTable.userId,
        userName: usersTable.name,
        userEmail: usersTable.email,
        createdAt: documentSubmissionsTable.createdAt,
        updatedAt: documentSubmissionsTable.updatedAt,
      })
      .from(documentSubmissionsTable)
      .leftJoin(usersTable, eq(usersTable.id, documentSubmissionsTable.userId))
      .where(eq(documentSubmissionsTable.formId, form.id))
      .orderBy(desc(documentSubmissionsTable.createdAt));

    const submissionIds = submissions.map((s) => s.id);
    const values = submissionIds.length
      ? await db
          .select()
          .from(documentSubmissionValuesTable)
          .where(
            inArray(documentSubmissionValuesTable.submissionId, submissionIds),
          )
      : [];
    const valuesBySubmission = new Map<number, typeof values>();
    for (const v of values) {
      const list = valuesBySubmission.get(v.submissionId) ?? [];
      list.push(v);
      valuesBySubmission.set(v.submissionId, list);
    }

    res.json({
      formId: form.id,
      total: submissions.length,
      fields: fields.map((f) => ({
        id: f.id,
        label: f.label,
        type: f.type as "text" | "textarea" | "select" | "file",
        options: f.options ?? [],
        required: f.required,
        order: f.order,
      })),
      submissions: submissions.map((s) => ({
        id: s.id,
        userId: s.userId,
        userName: s.userName ?? null,
        userEmail: s.userEmail ?? null,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        values: (valuesBySubmission.get(s.id) ?? []).map((v) => ({
          id: v.id,
          fieldId: v.fieldId,
          value: v.value,
          objectPath: v.objectPath,
          fileName: v.fileName,
          fileSize: v.fileSize,
          contentType: v.contentType,
        })),
      })),
    });
  },
);

// ---------------------------------------------------------------------------
// Submit / update the caller's own submission
// ---------------------------------------------------------------------------
router.post(
  "/document-forms/:id/submissions",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = SubmitDocumentFormParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const body = SubmitDocumentFormBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ message: body.error.message });
      return;
    }
    const caller = req.user!;

    const [form] = await db
      .select()
      .from(documentFormsTable)
      .where(
        and(
          eq(documentFormsTable.id, params.data.id),
          isNull(documentFormsTable.deletedAt),
        ),
      );
    if (!form) {
      res.status(404).json({ message: "Formulario no encontrado" });
      return;
    }
    if (caller.role !== "superadmin" && form.createdById !== caller.id) {
      const ctx = await getViewerContext(caller);
      if (!isInAudience(form.audienceType, form.audienceIds, ctx)) {
        res.status(403).json({ message: "Permiso denegado" });
        return;
      }
    }
    if (form.status !== "open") {
      res
        .status(409)
        .json({ message: "Este formulario no está abierto a entregas" });
      return;
    }

    const fields = await db
      .select()
      .from(documentFormFieldsTable)
      .where(eq(documentFormFieldsTable.formId, form.id));
    const fieldById = new Map(fields.map((f) => [f.id, f]));

    const valueByField = new Map<number, (typeof body.data.values)[number]>();
    for (const v of body.data.values) {
      if (!fieldById.has(v.fieldId)) {
        res.status(400).json({ message: "Respuesta a un campo inexistente" });
        return;
      }
      if (valueByField.has(v.fieldId)) {
        res
          .status(400)
          .json({ message: "Respuesta duplicada para un mismo campo" });
        return;
      }
      valueByField.set(v.fieldId, v);
    }

    // Validate required fields and per-type constraints.
    for (const f of fields) {
      const v = valueByField.get(f.id);
      const hasText = !!v?.value && v.value.trim().length > 0;
      const hasFile = !!v?.objectPath;
      if (f.required) {
        if (f.type === "file" && !hasFile) {
          res
            .status(400)
            .json({ message: `Falta el documento: ${f.label}` });
          return;
        }
        if (f.type !== "file" && !hasText) {
          res.status(400).json({ message: `Falta el campo: ${f.label}` });
          return;
        }
      }
      if (f.type === "select" && hasText) {
        const allowed = new Set(f.options ?? []);
        if (!allowed.has(v!.value!.trim())) {
          res.status(400).json({ message: `Opción no válida: ${f.label}` });
          return;
        }
      }
    }

    // Bind each uploaded document to the caller before accepting it. This both
    // verifies the object actually exists and prevents a user from attaching an
    // object owned by someone else (path-reuse). On resubmit the owner already
    // matches, so the operation is idempotent.
    const ownerId = String(caller.id);
    for (const f of fields) {
      if (f.type !== "file") continue;
      const v = valueByField.get(f.id);
      if (!v?.objectPath) continue;
      let objectFile;
      try {
        objectFile = await objectStorageService.getObjectEntityFile(
          v.objectPath,
        );
      } catch (err) {
        if (err instanceof ObjectNotFoundError) {
          res
            .status(400)
            .json({ message: `Documento no encontrado: ${f.label}` });
          return;
        }
        throw err;
      }
      const policy = await getObjectAclPolicy(objectFile);
      if (policy?.owner && policy.owner !== ownerId) {
        res
          .status(403)
          .json({ message: `No puedes usar este documento: ${f.label}` });
        return;
      }
      if (!policy?.owner) {
        await setObjectAclPolicy(objectFile, {
          owner: ownerId,
          visibility: "private",
        });
      }
    }

    // Upsert: one submission per user per form. Replace values on resubmit.
    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(documentSubmissionsTable)
        .where(
          and(
            eq(documentSubmissionsTable.formId, form.id),
            eq(documentSubmissionsTable.userId, caller.id),
          ),
        );

      let submissionId: number;
      if (existing) {
        submissionId = existing.id;
        await tx
          .update(documentSubmissionsTable)
          .set({ updatedAt: new Date() })
          .where(eq(documentSubmissionsTable.id, submissionId));
        await tx
          .delete(documentSubmissionValuesTable)
          .where(eq(documentSubmissionValuesTable.submissionId, submissionId));
      } else {
        const [created] = await tx
          .insert(documentSubmissionsTable)
          .values({ formId: form.id, userId: caller.id })
          .returning();
        submissionId = created!.id;
      }

      const rows = Array.from(valueByField.values())
        .filter((v) => {
          const f = fieldById.get(v.fieldId)!;
          if (f.type === "file") return !!v.objectPath;
          return !!v.value && v.value.trim().length > 0;
        })
        .map((v) => {
          const f = fieldById.get(v.fieldId)!;
          const isFile = f.type === "file";
          return {
            submissionId,
            fieldId: v.fieldId,
            value: isFile ? null : (v.value ?? null),
            objectPath: isFile ? (v.objectPath ?? null) : null,
            fileName: isFile ? (v.fileName ?? null) : null,
            fileSize: isFile ? (v.fileSize ?? null) : null,
            contentType: isFile ? (v.contentType ?? null) : null,
          };
        });

      if (rows.length > 0) {
        await tx.insert(documentSubmissionValuesTable).values(rows);
      }
    });

    res.json({ ok: true });
  },
);

// ---------------------------------------------------------------------------
// Download a submitted document (admin within scope OR the owner)
// Streamed binary — authorization enforced against the DB. Not generated as a
// typed client hook; the frontend fetches this with the Authorization header.
// ---------------------------------------------------------------------------
router.get(
  "/document-forms/submission-values/:valueId/file",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const valueId = Number(req.params.valueId);
    if (!Number.isInteger(valueId) || valueId <= 0) {
      res.status(400).json({ message: "Identificador no válido" });
      return;
    }
    const caller = req.user!;

    const [row] = await db
      .select({
        objectPath: documentSubmissionValuesTable.objectPath,
        fileName: documentSubmissionValuesTable.fileName,
        ownerId: documentSubmissionsTable.userId,
        formAudienceType: documentFormsTable.audienceType,
        formAudienceIds: documentFormsTable.audienceIds,
      })
      .from(documentSubmissionValuesTable)
      .innerJoin(
        documentSubmissionsTable,
        eq(
          documentSubmissionsTable.id,
          documentSubmissionValuesTable.submissionId,
        ),
      )
      .innerJoin(
        documentFormsTable,
        eq(documentFormsTable.id, documentSubmissionsTable.formId),
      )
      .where(eq(documentSubmissionValuesTable.id, valueId));

    if (!row || !row.objectPath) {
      res.status(404).json({ message: "Documento no encontrado" });
      return;
    }

    const isOwner = row.ownerId === caller.id;
    // Managers (superadmin, or a provincial coordinator whose scope covers the
    // form's audience) can download any submission file; owners always can.
    const isManager = await canManageAudience(
      caller,
      row.formAudienceType,
      row.formAudienceIds,
    );
    if (!isOwner && !isManager) {
      res.status(403).json({ message: "Permiso denegado" });
      return;
    }

    try {
      const objectFile = await objectStorageService.getObjectEntityFile(
        row.objectPath,
      );
      const response = await objectStorageService.downloadObject(objectFile);
      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));
      if (row.fileName) {
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${encodeURIComponent(row.fileName)}"`,
        );
      }
      if (response.body) {
        const nodeStream = Readable.fromWeb(
          response.body as ReadableStream<Uint8Array>,
        );
        nodeStream.pipe(res);
      } else {
        res.end();
      }
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ message: "Documento no encontrado" });
        return;
      }
      req.log.error({ err: error }, "Error serving submission document");
      res.status(500).json({ message: "No se pudo servir el documento" });
    }
  },
);

export default router;
