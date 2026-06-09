import { Router, type IRouter } from "express";
import express from "express";
import JSZip from "jszip";
import {
  getTableColumns,
  getTableName,
  sql,
  type Table,
} from "drizzle-orm";
import {
  db,
  provincesTable,
  islandsTable,
  municipalitiesTable,
  usersTable,
  invitationsTable,
  centersTable,
  trainingOfferTable,
  modulesTable,
  groupsTable,
  teachingAssignmentsTable,
  resourcesTable,
  companyAlertsTable,
  gdcanResourcesTable,
  surveysTable,
  surveyQuestionsTable,
  surveyResponsesTable,
  surveyAnswersTable,
  eventsTable,
  eventAccreditationsTable,
  eventStaffTable,
  eventSpacesTable,
  eventRsvpsTable,
  calendarEntriesTable,
  annualReportsTable,
  integrationSettingsTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/auth";

const router: IRouter = Router();

const BACKUP_FORMAT = "coordina-adg-backup";
const BACKUP_VERSION = 1;

// Tables are ordered parent-first. Backups are written in this order and
// restored in this order; deletion happens in reverse. The schema has no
// enforced foreign keys, but keeping a stable order makes the dump readable
// and the restore deterministic.
const TABLES: [string, Table][] = [
  ["provinces", provincesTable],
  ["islands", islandsTable],
  ["municipalities", municipalitiesTable],
  ["users", usersTable],
  ["invitations", invitationsTable],
  ["centers", centersTable],
  ["trainingOffer", trainingOfferTable],
  ["modules", modulesTable],
  ["groups", groupsTable],
  ["teachingAssignments", teachingAssignmentsTable],
  ["resources", resourcesTable],
  ["companyAlerts", companyAlertsTable],
  ["gdcanResources", gdcanResourcesTable],
  ["surveys", surveysTable],
  ["surveyQuestions", surveyQuestionsTable],
  ["surveyResponses", surveyResponsesTable],
  ["surveyAnswers", surveyAnswersTable],
  ["events", eventsTable],
  ["eventAccreditations", eventAccreditationsTable],
  ["eventStaff", eventStaffTable],
  ["eventSpaces", eventSpacesTable],
  ["eventRsvps", eventRsvpsTable],
  ["calendarEntries", calendarEntriesTable],
  ["annualReports", annualReportsTable],
  ["integrationSettings", integrationSettingsTable],
];

type BackupFile = {
  format: string;
  version: number;
  generatedAt: string;
  data: Record<string, Record<string, unknown>[]>;
};

// Restore values come back as plain JSON: timestamps are ISO strings. Drizzle's
// timestamp columns (dataType "date") expect Date instances, so revive them.
function reviveRow(
  table: Table,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const columns = getTableColumns(table);
  const out: Record<string, unknown> = { ...row };
  for (const [key, column] of Object.entries(columns)) {
    const value = out[key];
    if (column.dataType === "date" && typeof value === "string") {
      out[key] = new Date(value);
    }
  }
  return out;
}

router.get(
  "/backup",
  requireAuth,
  requireRole("superadmin"),
  async (_req, res): Promise<void> => {
    const data: Record<string, Record<string, unknown>[]> = {};
    for (const [name, table] of TABLES) {
      data[name] = (await db.select().from(table)) as Record<string, unknown>[];
    }

    const payload: BackupFile = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      generatedAt: new Date().toISOString(),
      data,
    };

    const zip = new JSZip();
    zip.file("backup.json", JSON.stringify(payload, null, 2));
    const buffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    const date = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="coordina-adg-backup-${date}.zip"`,
    );
    res.send(buffer);
  },
);

router.post(
  "/restore",
  requireAuth,
  requireRole("superadmin"),
  express.raw({ type: "application/zip", limit: "100mb" }),
  async (req, res): Promise<void> => {
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      res.status(400).json({
        message: "No se ha recibido ningún archivo de copia de seguridad.",
      });
      return;
    }

    let payload: BackupFile;
    try {
      const zip = await JSZip.loadAsync(body);
      const entry = zip.file("backup.json");
      if (!entry) {
        res.status(400).json({
          message:
            "El archivo no es una copia de seguridad válida (falta backup.json).",
        });
        return;
      }
      payload = JSON.parse(await entry.async("string")) as BackupFile;
    } catch {
      res.status(400).json({
        message: "No se ha podido leer el archivo ZIP de copia de seguridad.",
      });
      return;
    }

    if (
      payload?.format !== BACKUP_FORMAT ||
      typeof payload.data !== "object" ||
      payload.data == null
    ) {
      res.status(400).json({
        message: "El archivo no es una copia de seguridad de Coordina ADG.",
      });
      return;
    }

    if (payload.version !== BACKUP_VERSION) {
      res.status(400).json({
        message: `La versión de la copia de seguridad (${payload.version}) no es compatible con esta plataforma.`,
      });
      return;
    }

    // Validate completeness and shape BEFORE touching live data: every table
    // must be present and be an array of plain objects. This prevents a
    // truncated or incompatible backup from silently wiping tables it omits.
    const isPlainObject = (value: unknown): value is Record<string, unknown> =>
      typeof value === "object" && value !== null && !Array.isArray(value);

    for (const [name] of TABLES) {
      const rows = payload.data[name];
      if (!Array.isArray(rows)) {
        res.status(400).json({
          message: `La copia de seguridad está incompleta: falta la tabla "${name}".`,
        });
        return;
      }
      if (!rows.every(isPlainObject)) {
        res.status(400).json({
          message: `La copia de seguridad tiene un formato no válido en la tabla "${name}".`,
        });
        return;
      }
    }

    const counts: Record<string, number> = {};
    try {
      await db.transaction(async (tx) => {
        // Wipe everything first (children before parents).
        for (const [, table] of [...TABLES].reverse()) {
          await tx.delete(table);
        }

        // Re-insert in parent-first order.
        for (const [name, table] of TABLES) {
          const rows = payload.data[name];
          if (!Array.isArray(rows) || rows.length === 0) {
            counts[name] = 0;
            continue;
          }
          const revived = rows.map((row) =>
            reviveRow(table, row as Record<string, unknown>),
          );
          const CHUNK = 500;
          for (let i = 0; i < revived.length; i += CHUNK) {
            await tx.insert(table).values(revived.slice(i, i + CHUNK));
          }
          counts[name] = revived.length;
        }

        // Realign serial sequences so future inserts don't collide with the
        // restored ids. Names come from our own schema, so raw SQL is safe.
        for (const [, table] of TABLES) {
          const dbName = getTableName(table);
          await tx.execute(
            sql.raw(
              `SELECT setval(pg_get_serial_sequence('"${dbName}"', 'id'), ` +
                `GREATEST((SELECT COALESCE(MAX(id), 0) FROM "${dbName}"), 1))`,
            ),
          );
        }
      });
    } catch {
      res.status(500).json({
        message:
          "No se pudo restaurar la copia de seguridad. No se ha modificado ningún dato.",
      });
      return;
    }

    res.json({ restored: true, counts });
  },
);

export default router;
