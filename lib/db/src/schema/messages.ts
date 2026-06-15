import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";

export const messagesTable = pgTable("messages", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id"),
  senderId: integer("sender_id").notNull(),
  recipientId: integer("recipient_id"),
  content: text("content").notNull(),
  // WhatsApp-style extras.
  // Kind drives how the bubble is rendered: text | image | file | audio.
  kind: text("kind").notNull().default("text"),
  // Reply/quote: points at the message being answered (same group).
  replyToId: integer("reply_to_id"),
  // Forwarded marker: the original sender's display name (denormalized so the
  // "Reenviado" label survives even if the source message is later deleted).
  forwardedFrom: text("forwarded_from"),
  // Attachment (also used for voice notes, kind = "audio").
  attachmentPath: text("attachment_path"),
  attachmentName: text("attachment_name"),
  attachmentType: text("attachment_type"),
  attachmentSize: integer("attachment_size"),
  editedAt: timestamp("edited_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Message = typeof messagesTable.$inferSelect;
export type InsertMessage = typeof messagesTable.$inferInsert;
