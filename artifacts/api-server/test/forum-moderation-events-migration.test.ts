import { afterEach, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

describe("forum moderation events migration", () => {
  const schemas: string[] = [];

  afterEach(async () => {
    const client = await pool.connect();
    try {
      for (const schema of schemas.splice(0)) {
        await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      }
    } finally {
      client.release();
    }
  });

  it("creates the metadata-only audit table idempotently", async () => {
    const client = await pool.connect();
    const schema = `forum_events_${randomUUID().replaceAll("-", "")}`;
    schemas.push(schema);
    try {
      await client.query(`CREATE SCHEMA "${schema}"`);
      const sql = readFileSync(
        new URL(
          "../../../deploy/migrations/forum-moderation-events.sql",
          import.meta.url,
        ),
        "utf8",
      )
        .replaceAll("public.", `${schema}.`)
        .replaceAll("'public'", `'${schema}'`);

      await client.query(sql);
      await client.query(sql);

      const result = await client.query(
        `INSERT INTO "${schema}".forum_moderation_events
          (module_id, actor_id, actor_name, action)
         VALUES (12, 41, 'Moderador', 'thread_pinned')
         RETURNING id, module_id, actor_id, actor_name, action, created_at`,
      );
      expect(result.rows[0]).toMatchObject({
        id: expect.any(Number),
        module_id: 12,
        actor_id: 41,
        actor_name: "Moderador",
        action: "thread_pinned",
      });
      expect(result.rows[0].created_at).toBeInstanceOf(Date);
    } finally {
      client.release();
    }
  });

  it("rejects an incompatible existing table without changing its data", async () => {
    const client = await pool.connect();
    const schema = `forum_events_${randomUUID().replaceAll("-", "")}`;
    schemas.push(schema);
    try {
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(
        `CREATE TABLE "${schema}".forum_moderation_events
          (id integer PRIMARY KEY, action text)`,
      );
      await client.query(
        `INSERT INTO "${schema}".forum_moderation_events (id, action)
         VALUES (7, 'preserve')`,
      );
      const sql = readFileSync(
        new URL(
          "../../../deploy/migrations/forum-moderation-events.sql",
          import.meta.url,
        ),
        "utf8",
      )
        .replaceAll("public.", `${schema}.`)
        .replaceAll("'public'", `'${schema}'`);

      await expect(client.query(sql)).rejects.toThrow(
        /incompatible schema/,
      );
      await client.query("ROLLBACK");

      const result = await client.query(
        `SELECT id, action FROM "${schema}".forum_moderation_events`,
      );
      expect(result.rows).toEqual([{ id: 7, action: "preserve" }]);
    } finally {
      client.release();
    }
  });
});
