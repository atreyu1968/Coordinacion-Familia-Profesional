import { createHash } from "node:crypto";
import {
  pool, TEST_TEACHER_EMAILS, TEST_TEACHER_LOCK, TEST_TEACHER_PURGE_ACTION,
  type PoolClient, type User,
} from "@workspace/db";
import { disconnectUserSessions } from "./realtime";
import { getSettings } from "./settings";
import { resolveNextcloudConfig, resolveNextcloudUrl, disableTestTeacherNextcloudAccount } from "./nextcloud";

export const TEST_TEACHER_CONFIRMATION = "ELIMINAR DOCENTES DE PRUEBA";
export class TestTeacherCleanupError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// Bound parameters are exclusively the server-selected fixture IDs and emails.
const own = (column: string) => `${column} = ANY($1::int[])`;
const sentMessages = `SELECT id FROM messages WHERE ${own("sender_id")} OR ${own("recipient_id")}`;
const threads = `SELECT id FROM forum_threads WHERE ${own("author_id")}`;
const surveys = `SELECT id FROM surveys WHERE ${own("created_by_id")}`;
const forms = `SELECT id FROM document_forms WHERE ${own("created_by_id")}`;
const courses = `SELECT id FROM lms_courses WHERE ${own("created_by")}`;
const events = `SELECT id FROM events WHERE ${own("created_by_id")}`;
const responses = `SELECT id FROM survey_responses WHERE ${own("user_id")} OR survey_id IN (${surveys})`;
const submissions = `SELECT id FROM document_submissions WHERE ${own("user_id")} OR form_id IN (${forms})`;
const pages = `WITH RECURSIVE p AS (
  SELECT id FROM wiki_pages WHERE ${own("created_by")}
  UNION SELECT w.id FROM wiki_pages w JOIN p ON w.parent_id = p.id
) SELECT id FROM p`;
const attendances = `SELECT id FROM event_attendances WHERE ${own("user_id")} OR lower(email) = ANY($2::text[]) OR event_id IN (${events})`;
type Rule = { table: string; label: string; where: string };
// Children precede parents, including relations not enforced by legacy FKs.
const deletions: Rule[] = [
  { table: "message_reactions", label: "Reacciones", where: `${own("user_id")} OR message_id IN (${sentMessages})` },
  { table: "messages", label: "Mensajes enviados y conversaciones directas", where: `${own("sender_id")} OR ${own("recipient_id")}` },
  { table: "forum_thread_reads", label: "Lecturas de foros", where: `${own("user_id")} OR thread_id IN (${threads})` },
  { table: "forum_posts", label: "Publicaciones en foros", where: `${own("author_id")} OR thread_id IN (${threads})` },
  { table: "forum_threads", label: "Hilos de prueba", where: own("author_id") },
  { table: "survey_answers", label: "Respuestas identificables a encuestas", where: `response_id IN (${responses}) OR survey_id IN (${surveys})` },
  { table: "survey_responses", label: "Participaciones en encuestas", where: `${own("user_id")} OR survey_id IN (${surveys})` },
  { table: "survey_questions", label: "Preguntas de encuestas de prueba", where: `survey_id IN (${surveys})` },
  { table: "surveys", label: "Encuestas de prueba", where: own("created_by_id") },
  { table: "document_submission_values", label: "Datos entregados en formularios", where: `submission_id IN (${submissions}) OR field_id IN (SELECT id FROM document_form_fields WHERE form_id IN (${forms}))` },
  { table: "document_submissions", label: "Entregas de formularios", where: `${own("user_id")} OR form_id IN (${forms})` },
  { table: "document_form_fields", label: "Campos de formularios de prueba", where: `form_id IN (${forms})` },
  { table: "document_forms", label: "Formularios de prueba", where: own("created_by_id") },
  { table: "lms_lesson_progress", label: "Progreso de formación", where: `${own("user_id")} OR course_id IN (${courses})` },
  { table: "lms_certificates", label: "Certificados de formación", where: `${own("user_id")} OR course_id IN (${courses})` },
  { table: "lms_upload_intents", label: "Subidas de formación", where: `${own("user_id")} OR course_id IN (${courses})` },
  { table: "lms_lessons", label: "Lecciones de cursos de prueba", where: `course_id IN (${courses})` },
  { table: "lms_courses", label: "Cursos de prueba", where: own("created_by") },
  { table: "lms_course_managers", label: "Permisos de formación", where: own("user_id") },
  { table: "wiki_upload_intents", label: "Subidas de documentación", where: `${own("user_id")} OR page_id IN (${pages})` },
  { table: "wiki_external_links", label: "Enlaces de documentación de prueba", where: `${own("created_by")} OR page_id IN (${pages})` },
  { table: "wiki_attachments", label: "Adjuntos de documentación de prueba", where: `${own("uploaded_by")} OR page_id IN (${pages})` },
  { table: "wiki_pages", label: "Páginas de documentación de prueba", where: `id IN (${pages})` },
  { table: "wiki_module_editors", label: "Permisos de documentación", where: own("user_id") },
  { table: "wiki_module_permission_group_members", label: "Grupos de permisos de documentación", where: own("user_id") },
  { table: "event_attendance_certificates", label: "Certificados de asistencia", where: `attendance_id IN (${attendances}) OR event_id IN (${events})` },
  { table: "event_attendances", label: "Asistencias", where: `id IN (${attendances})` },
  { table: "event_rsvps", label: "Inscripciones a eventos", where: `${own("user_id")} OR event_id IN (${events})` },
  { table: "event_staff", label: "Participaciones en organización", where: `${own("user_id")} OR event_id IN (${events})` },
  { table: "event_accreditations", label: "Acreditaciones", where: `lower(holder_email) = ANY($2::text[]) OR event_id IN (${events})` },
  { table: "event_spaces", label: "Espacios de eventos de prueba", where: `event_id IN (${events})` },
  { table: "meeting_minutes_messages", label: "Conversaciones privadas de actas", where: `${own("created_by")} OR event_id IN (${events})` },
  { table: "meeting_minutes_shared_documents", label: "Adjuntos de reuniones de prueba", where: `event_id IN (${events})` },
  { table: "meeting_minutes_sources", label: "Fuentes de reuniones de prueba", where: `event_id IN (${events})` },
  { table: "meeting_minutes", label: "Actas de eventos de prueba", where: `event_id IN (${events})` },
  { table: "event_attendance_settings", label: "Configuración de eventos de prueba", where: `event_id IN (${events})` },
  { table: "calendar_entries", label: "Entradas de calendario", where: `${own("created_by_id")} OR event_id IN (${events})` },
  { table: "events", label: "Eventos de prueba", where: own("created_by_id") },
  { table: "announcement_attachments", label: "Adjuntos de anuncios de prueba", where: `announcement_id IN (SELECT id FROM announcements WHERE ${own("author_id")})` },
  { table: "announcements", label: "Anuncios de prueba", where: own("author_id") },
  { table: "resources", label: "Recursos de prueba", where: own("author_id") },
  { table: "company_alerts", label: "Avisos de prueba", where: own("created_by_id") },
  { table: "annual_reports", label: "Informes de prueba", where: own("generated_by_id") },
  { table: "meetings", label: "Videoconferencias de prueba", where: own("host_id") },
  { table: "teaching_assignments", label: "Asignaciones docentes", where: own("teacher_id") },
  { table: "teacher_year_confirmations", label: "Confirmaciones de curso", where: own("teacher_id") },
  { table: "module_memberships", label: "Inscripciones en módulos", where: own("user_id") },
  { table: "chat_group_members", label: "Pertenencias a grupos de mensajes", where: own("user_id") },
  { table: "collaborative_space_members", label: "Pertenencias a espacios", where: own("user_id") },
  { table: "collaborative_space_audit", label: "Actividad en espacios", where: own("actor_id") },
  { table: "notifications", label: "Notificaciones", where: own("user_id") },
  { table: "push_tokens", label: "Dispositivos y notificaciones push", where: own("user_id") },
  { table: "app_feedback", label: "Comentarios enviados", where: own("user_id") },
  { table: "password_reset_tokens", label: "Recuperaciones de contraseña", where: own("user_id") },
  { table: "invitations", label: "Invitaciones de prueba", where: `${own("invited_by")} OR lower(email) = ANY($2::text[])` },
  { table: "certificate_email_verifications", label: "Verificaciones de correo", where: own("user_id") },
  { table: "ai_knowledge_entries", label: "Índice personal de IA", where: own("user_id") },
  { table: "ai_knowledge_accounts", label: "Preferencias personales de IA", where: own("user_id") },
  { table: "coordinator_tasks", label: "Tareas personales", where: own("owner_id") },
  { table: "coordinator_task_source_scans", label: "Historial de análisis de tareas", where: own("owner_id") },
  { table: "coordinator_mail_attachments", label: "Adjuntos de correo personales", where: `message_id IN (SELECT id FROM coordinator_mail_messages WHERE ${own("owner_id")})` },
  { table: "coordinator_mail_outbox", label: "Envíos de correo personales", where: `case_id IN (SELECT id FROM coordinator_mail_cases WHERE ${own("owner_id")})` },
  { table: "coordinator_mail_case_notes", label: "Notas de correo personales", where: `${own("created_by")} OR case_id IN (SELECT id FROM coordinator_mail_cases WHERE ${own("owner_id")})` },
  { table: "coordinator_mail_messages", label: "Correos personales", where: own("owner_id") },
  { table: "coordinator_mail_case_threads", label: "Hilos de correo personales", where: own("owner_id") },
  { table: "coordinator_mail_cases", label: "Asuntos de correo personales", where: own("owner_id") },
  { table: "coordinator_mail_case_groups", label: "Agrupaciones de correo personales", where: own("owner_id") },
  { table: "coordinator_mail_accounts", label: "Conexiones personales de correo", where: own("user_id") },
  { table: "account_audit", label: "Historial de las cuentas de prueba", where: `${own("actor_id")} OR ${own("target_id")}` },
];

// Preserve shared catalogues/configuration; clear attribution, not other users.
const detach: Array<Rule & { columns: string[]; replaceWithAdmin?: boolean }> = [
  { table: "users", label: "Autoría de otras cuentas", columns: ["created_by"], where: own("created_by") },
  { table: "centers", label: "Autoría de centros", columns: ["created_by"], where: own("created_by") },
  { table: "cycles", label: "Autoría del catálogo", columns: ["created_by"], where: own("created_by") },
  { table: "chat_groups", label: "Autoría de grupos compartidos", columns: ["created_by_id"], where: own("created_by_id") },
  { table: "collaborative_spaces", label: "Autoría de espacios compartidos", columns: ["created_by"], where: own("created_by") },
  { table: "wiki_pages", label: "Última edición de documentación compartida", columns: ["updated_by"], where: own("updated_by"), replaceWithAdmin: true },
  { table: "wiki_permission_groups", label: "Autoría de permisos compartidos", columns: ["created_by"], where: own("created_by"), replaceWithAdmin: true },
  { table: "wiki_module_permission_group_members", label: "Concesiones de permisos", columns: ["created_by"], where: own("created_by"), replaceWithAdmin: true },
  { table: "lms_course_managers", label: "Concesiones de formación", columns: ["granted_by"], where: own("granted_by"), replaceWithAdmin: true },
  { table: "messages", label: "Referencias a mensajes eliminados", columns: ["reply_to_id"], where: `reply_to_id IN (${sentMessages})` },
  ...[
    ["meeting_minutes", "published_by"], ["meeting_minutes", "generation_requested_by"],
    ["meeting_minutes_sources", "consent_by"], ["meeting_minutes_shared_documents", "created_by"],
    ["event_attendances", "confirmed_by"], ["event_attendance_certificates", "issued_by"],
    ["event_attendance_certificates", "revoked_by"], ["coordinator_mail_cases", "ai_requested_by"],
  ].map(([table, column]) => ({ table, label: "Referencias en documentos compartidos", columns: [column], where: own(column) })),
];
const blockers: Rule[] = [
  { table: "forum_posts", label: "Respuestas reales a hilos de prueba", where: `thread_id IN (${threads}) AND author_id IS NOT NULL AND NOT (${own("author_id")})` },
  { table: "survey_responses", label: "Participaciones reales en encuestas de prueba", where: `survey_id IN (${surveys}) AND NOT (${own("user_id")})` },
  { table: "document_submissions", label: "Entregas reales en formularios de prueba", where: `form_id IN (${forms}) AND NOT (${own("user_id")})` },
  { table: "lms_lesson_progress", label: "Progreso real en cursos de prueba", where: `course_id IN (${courses}) AND NOT (${own("user_id")})` },
  { table: "lms_certificates", label: "Certificados reales en cursos de prueba", where: `course_id IN (${courses}) AND NOT (${own("user_id")})` },
  { table: "wiki_pages", label: "Documentos reales bajo páginas de prueba", where: `id IN (${pages}) AND NOT (${own("created_by")})` },
  { table: "wiki_pages", label: "Páginas de prueba revisadas por usuarios reales", where: `${own("created_by")} AND NOT (${own("updated_by")})` },
  { table: "wiki_attachments", label: "Adjuntos reales en documentación de prueba", where: `page_id IN (${pages}) AND NOT (${own("uploaded_by")})` },
  { table: "wiki_external_links", label: "Enlaces reales en documentación de prueba", where: `page_id IN (${pages}) AND NOT (${own("created_by")})` },
  { table: "event_attendances", label: "Asistentes reales en eventos de prueba", where: `event_id IN (${events}) AND NOT (lower(email) = ANY($2::text[])) AND (user_id IS NULL OR NOT (${own("user_id")}))` },
  { table: "event_rsvps", label: "Inscripciones reales en eventos de prueba", where: `event_id IN (${events}) AND NOT (${own("user_id")})` },
  { table: "event_staff", label: "Personal real en eventos de prueba", where: `event_id IN (${events}) AND NOT (${own("user_id")})` },
  { table: "event_accreditations", label: "Acreditaciones reales en eventos de prueba", where: `event_id IN (${events}) AND (holder_email IS NULL OR NOT (lower(holder_email) = ANY($2::text[])))` },
  { table: "meeting_minutes", label: "Actas oficiales en eventos de prueba", where: `event_id IN (${events}) AND published_at IS NOT NULL` },
  { table: "survey_answers", label: "Respuestas anónimas no atribuibles en encuestas de prueba", where: `survey_id IN (${surveys}) AND response_id IS NULL` },
];
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
type Captured = Rule & { tids: string[] };
async function capture(client: PoolClient, rules: Rule[], parameters: unknown[]) {
  const result: Captured[] = [];
  const hashes: string[] = [];
  for (const rule of rules) {
    const rows = await client.query<{ tid: string; hash: string }>(
      `SELECT t.ctid::text AS tid, md5(row_to_json(t)::text) AS hash FROM ${quote(rule.table)} t WHERE ${rule.where} ORDER BY t.ctid`,
      parameters,
    );
    result.push({ ...rule, tids: rows.rows.map(row => row.tid) });
    hashes.push(rule.table, rule.where, ...rows.rows.map(row => row.hash));
  }
  return { result, hashes };
}
async function snapshot(client: PoolClient) {
  const accounts = await client.query<{ id: number; name: string; email: string; role: string }>(
    "SELECT id, name, email, role FROM users WHERE lower(email) = ANY($1::text[]) ORDER BY id",
    [[...TEST_TEACHER_EMAILS]],
  );
  const ids = accounts.rows.map(row => row.id);
  const parameters = [ids, [...TEST_TEACHER_EMAILS]];
  // Every statement receives both placeholders, including rules using only $1.
  const withParameters = (rules: Rule[]) => rules.map(rule => ({ ...rule, where: `(${rule.where}) AND $2::text[] IS NOT NULL` }));
  const deletionRows = await capture(client, withParameters([...deletions, { table: "users", label: "Cuentas de prueba", where: own("id") }]), parameters);
  const detachRows = await capture(client, withParameters(detach), parameters);
  const blockedRows = await capture(client, withParameters(blockers), parameters);
  const blockedReasons = blockedRows.result.filter(row => row.tids.length).map(row => row.label);
  if (accounts.rows.some(row => row.role !== "teacher")) blockedReasons.unshift("Una identidad de prueba tiene un rol distinto de docente. Revísala antes de borrar.");
  const fingerprint = createHash("sha256").update(JSON.stringify([
    ...deletionRows.hashes, ...detachRows.hashes, ...blockedRows.hashes,
  ])).digest("hex");
  return {
    ids, deletionRows: deletionRows.result, detachRows: detachRows.result,
    preview: {
      accounts: accounts.rows.map(({ id, name, email }) => ({ id, name, email })),
      assignments: deletionRows.result.find(row => row.table === "teaching_assignments")!.tids.length,
      history: deletionRows.result.filter(row => row.table !== "users" && row.table !== "teaching_assignments" && row.tids.length)
        .map(row => ({ label: row.label, count: row.tids.length })),
      blockedReasons, fingerprint,
    },
  };
}
export async function previewTestTeacherCleanup() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const { preview } = await snapshot(client);
    await client.query("COMMIT");
    return preview;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
export async function purgeTestTeachers(actor: User, fingerprint: string, confirmation: string) {
  if (actor.role !== "superadmin") throw new TestTeacherCleanupError(403, "Solo superadministración puede eliminar los datos de prueba.");
  if (confirmation !== TEST_TEACHER_CONFIRMATION) throw new TestTeacherCleanupError(400, "Escribe la confirmación exacta.");
  const settings = await getSettings();
  const nextcloud = resolveNextcloudConfig(settings);
  const client = await pool.connect();
  let ids: number[] = [];
  let result: { accountsDeleted: number; assignmentsDeleted: number; historyDeleted: number };
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '3s'");
    await client.query("SET LOCAL statement_timeout = '15s'");
    await client.query("SELECT pg_advisory_xact_lock($1)", [TEST_TEACHER_LOCK]);
    const tables = [...new Set([...deletions, ...detach, ...blockers].map(rule => rule.table))].sort();
    await client.query(`LOCK TABLE users IN ACCESS EXCLUSIVE MODE`);
    await client.query(`LOCK TABLE ${tables.filter(table => table !== "users").map(quote).join(", ")} IN SHARE ROW EXCLUSIVE MODE`);
    const currentActor = await client.query(
      "SELECT id FROM users WHERE id=$1 AND role='superadmin' AND status='active' AND deleted_at IS NULL AND token_version=$2 AND session_nonce=$3",
      [actor.id, actor.tokenVersion, actor.sessionNonce],
    );
    if (!currentActor.rowCount) throw new TestTeacherCleanupError(403, "Tu sesión o tus permisos han cambiado. Inicia sesión de nuevo.");
    const data = await snapshot(client);
    if (data.preview.fingerprint !== fingerprint) throw new TestTeacherCleanupError(409, "Los datos han cambiado. Vuelve a revisar la vista previa antes de confirmar.");
    if (data.preview.blockedReasons.length) throw new TestTeacherCleanupError(409, "Hay actividad compartida de usuarios reales. Revísala o transfiérela antes de eliminar las cuentas de prueba.");
    ids = data.ids;
    if (ids.length && resolveNextcloudUrl(settings) && !nextcloud) {
      throw new TestTeacherCleanupError(503, "Configura las credenciales administrativas de Nextcloud antes de eliminar sus usuarios de prueba.");
    }
    if (nextcloud) {
      try { await Promise.all(ids.map(id => disableTestTeacherNextcloudAccount(nextcloud, id))); }
      catch {
        throw new TestTeacherCleanupError(503, "No se pudo confirmar la revocación en Nextcloud. No se han borrado datos locales; alguna cuenta remota puede haber quedado deshabilitada. Comprueba Nextcloud y reintenta.");
      }
    }
    const affectedGroups = await client.query<{ id: number }>(`SELECT DISTINCT group_id AS id FROM messages WHERE group_id IS NOT NULL AND (${own("sender_id")} OR ${own("recipient_id")})`, [ids]);
    // Preserve replies written by other users, but remove their stale pointer.
    await client.query(
      `UPDATE messages SET reply_to_id=NULL WHERE reply_to_id IN (${sentMessages}) AND NOT (${own("sender_id")}) AND (recipient_id IS NULL OR NOT (${own("recipient_id")}))`,
      [ids],
    );
    // Capture every child before deleting any parent (legacy relations do not
    // all have FKs). No writes can race these captures under the table locks.
    const deletionSnapshot = await capture(client, deletions.map(rule => ({ ...rule, where: `(${rule.where}) AND $2::text[] IS NOT NULL` })), [ids, [...TEST_TEACHER_EMAILS]]);
    for (const row of deletionSnapshot.result) {
      if (row.tids.length) await client.query(`DELETE FROM ${quote(row.table)} WHERE ctid = ANY($1::tid[])`, [row.tids]);
    }
    for (const rule of detach.filter(rule => rule.table !== "messages")) {
      await client.query(
        `UPDATE ${quote(rule.table)} SET ${rule.columns.map(column => `${quote(column)} = ${rule.replaceWithAdmin ? "$3::int" : "NULL"}`).join(", ")} WHERE (${rule.where}) AND $2::text[] IS NOT NULL${rule.replaceWithAdmin ? " AND $3::int IS NOT NULL" : ""}`,
        rule.replaceWithAdmin ? [ids, [...TEST_TEACHER_EMAILS], actor.id] : [ids, [...TEST_TEACHER_EMAILS]],
      );
    }
    await client.query("DELETE FROM users WHERE id = ANY($1::int[])", [ids]);
    if (affectedGroups.rows.length) await client.query(
      "UPDATE chat_groups g SET last_message_at = (SELECT max(created_at) FROM messages m WHERE m.group_id = g.id AND m.deleted_at IS NULL) WHERE g.id = ANY($1::int[])",
      [affectedGroups.rows.map(row => row.id)],
    );
    await client.query(
      `INSERT INTO account_audit (actor_id, actor_name, target_id, action, changes, before_role, after_role)
       VALUES ($1, $2, $1, $3, $4::jsonb, 'superadmin', 'superadmin')`,
      [actor.id, actor.name, TEST_TEACHER_PURGE_ACTION, JSON.stringify([{ field: "status", before: `${ids.length} cuentas de prueba`, after: "Eliminadas definitivamente; recreación deshabilitada" }])],
    );
    result = { accountsDeleted: ids.length, assignmentsDeleted: data.preview.assignments, historyDeleted: data.preview.history.reduce((sum, row) => sum + row.count, 0) };
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof TestTeacherCleanupError) throw error;
    const code = (error as { code?: string }).code;
    if (["23503", "55P03", "40P01", "40001", "57014"].includes(code ?? "")) {
      throw new TestTeacherCleanupError(409, "No se ha eliminado nada: hay relaciones o actividad concurrente que requieren revisión. Vuelve a consultar la vista previa.");
    }
    throw error;
  } finally { client.release(); }
  ids.forEach(disconnectUserSessions);
  return result;
}
