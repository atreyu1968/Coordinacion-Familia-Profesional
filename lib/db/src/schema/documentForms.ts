import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

// A document-submission form: a coordinator/superadmin defines a set of fields
// (including file-upload slots) that users fill in and submit, attaching the
// requested documents. Mirrors the surveys machinery (province scope + status +
// soft delete).
export const documentFormsTable = pgTable("document_forms", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("open"), // draft | open | closed
  provinceId: integer("province_id"),
  // Recipient/audience targeting. audienceType: all | province | island |
  // center | module | users. audienceIds holds the target ids for the chosen
  // type (province/island/center/module ids, or user ids for "users"); empty
  // for "all".
  audienceType: text("audience_type").notNull().default("all"),
  audienceIds: integer("audience_ids").array(),
  closesAt: timestamp("closes_at", { withTimezone: true }),
  createdById: integer("created_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const documentFormFieldsTable = pgTable("document_form_fields", {
  id: serial("id").primaryKey(),
  formId: integer("form_id").notNull(),
  label: text("label").notNull(),
  type: text("type").notNull(), // text | textarea | select | file
  options: text("options").array(),
  required: boolean("required").notNull().default(true),
  order: integer("order").notNull().default(0),
});

// One submission per user per form (enforced by the unique constraint). A user
// may update their submission (replace values) while the form is open.
export const documentSubmissionsTable = pgTable(
  "document_submissions",
  {
    id: serial("id").primaryKey(),
    formId: integer("form_id").notNull(),
    userId: integer("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqUserPerForm: unique().on(t.formId, t.userId),
  }),
);

// One value per submission per field. Text-like fields use `value`; file fields
// store the object storage path plus the file metadata for display/download.
export const documentSubmissionValuesTable = pgTable(
  "document_submission_values",
  {
    id: serial("id").primaryKey(),
    submissionId: integer("submission_id").notNull(),
    fieldId: integer("field_id").notNull(),
    value: text("value"),
    objectPath: text("object_path"),
    fileName: text("file_name"),
    fileSize: integer("file_size"),
    contentType: text("content_type"),
  },
);

export type DocumentForm = typeof documentFormsTable.$inferSelect;
export type InsertDocumentForm = typeof documentFormsTable.$inferInsert;
export type DocumentFormField = typeof documentFormFieldsTable.$inferSelect;
export type DocumentSubmission = typeof documentSubmissionsTable.$inferSelect;
export type DocumentSubmissionValue =
  typeof documentSubmissionValuesTable.$inferSelect;
