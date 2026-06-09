import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { eq, and, or, isNull, inArray, desc, asc, count } from "drizzle-orm";
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
import {
  requireAuth,
  requireRole,
  resolveReadScope,
  type ReadScope,
} from "../middlewares/auth";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { getObjectAclPolicy, setObjectAclPolicy } from "../lib/objectAcl";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

const FIELD_TYPES = new Set(["text", "textarea", "select", "file"]);

// Resolve the caller's effective province id (province roles carry it directly;
// center roles derive it from their center).
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

function canManageForms(role: string | undefined): boolean {
  return role === "superadmin" || role === "coordinator";
}

// Whether the caller may see/interact with a form given its province scope.
// Global forms (provinceId null) are visible to everyone; province-scoped forms
// only to superadmins and users in that province.
async function callerCanAccessForm(
  scope: ReadScope,
  formProvinceId: number | null,
): Promise<boolean> {
  if (scope.kind === "global") return true;
  if (formProvinceId == null) return true;
  const provinceId = await resolveEffectiveProvinceId(scope);
  return provinceId != null && provinceId === formProvinceId;
}

// ---------------------------------------------------------------------------
// List forms (province + global scoped)
// ---------------------------------------------------------------------------
router.get("/document-forms", requireAuth, async (req, res): Promise<void> => {
  const query = ListDocumentFormsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ message: query.error.message });
    return;
  }
  const caller = req.user!;
  const scope = resolveReadScope(caller);

  const filters: SQL[] = [isNull(documentFormsTable.deletedAt)];

  if (scope.kind !== "global") {
    const provinceId = await resolveEffectiveProvinceId(scope);
    const scopeMatch =
      provinceId != null
        ? or(
            isNull(documentFormsTable.provinceId),
            eq(documentFormsTable.provinceId, provinceId),
          )
        : isNull(documentFormsTable.provinceId);
    if (scopeMatch) filters.push(scopeMatch);
  }

  // Drafts only visible to managers; participants see open/closed.
  if (!canManageForms(caller.role)) {
    const notDraft = or(
      eq(documentFormsTable.status, "open"),
      eq(documentFormsTable.status, "closed"),
    );
    if (notDraft) filters.push(notDraft);
  }

  if (query.data.status) {
    filters.push(eq(documentFormsTable.status, query.data.status));
  }

  const rows = await db
    .select()
    .from(documentFormsTable)
    .where(and(...filters))
    .orderBy(desc(documentFormsTable.createdAt));

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
  requireRole("superadmin", "coordinator"),
  async (req, res): Promise<void> => {
    const parsed = CreateDocumentFormBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }
    const caller = req.user!;
    const data = parsed.data;

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
      const [form] = await tx
        .insert(documentFormsTable)
        .values({
          title: data.title,
          description: data.description ?? null,
          status: "open",
          provinceId,
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
    if (!(await callerCanAccessForm(resolveReadScope(caller), form.provinceId))) {
      res.status(403).json({ message: "Permiso denegado" });
      return;
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
    if (
      caller.role === "coordinator" &&
      form.provinceId !== caller.provinceId
    ) {
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
    if (
      caller.role === "coordinator" &&
      form.provinceId !== caller.provinceId
    ) {
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
    if (!(await callerCanAccessForm(resolveReadScope(caller), form.provinceId))) {
      res.status(403).json({ message: "Permiso denegado" });
      return;
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
        formProvinceId: documentFormsTable.provinceId,
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
    let isManager = false;
    if (caller.role === "superadmin") {
      isManager = true;
    } else if (caller.role === "coordinator") {
      // Coordinators manage only forms pinned to their own province — global
      // forms (provinceId null) are superadmin-managed, consistent with the
      // list-submissions and delete routes. Owners can still download via isOwner.
      isManager =
        row.formProvinceId != null &&
        row.formProvinceId === caller.provinceId;
    }
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
