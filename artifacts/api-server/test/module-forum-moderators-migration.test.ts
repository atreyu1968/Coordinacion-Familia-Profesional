import { afterEach, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

describe("module forum moderator migration", () => {
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

  it("adds a false default for existing memberships and is repeatable", async () => {
    const client = await pool.connect();
    const schema = `forum_moderator_${randomUUID().replaceAll("-", "")}`;
    schemas.push(schema);
    try {
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(
        `CREATE TABLE "${schema}".module_memberships (id serial PRIMARY KEY, user_id integer NOT NULL)`,
      );
      await client.query(
        `INSERT INTO "${schema}".module_memberships (user_id) VALUES (41)`,
      );

      const sql = readFileSync(
        new URL(
          "../../../deploy/migrations/module-forum-moderators.sql",
          import.meta.url,
        ),
        "utf8",
      )
        .replaceAll("public.", `${schema}.`)
        .replaceAll("'public'", `'${schema}'`);
      await client.query(sql);
      await client.query(sql);

      const result = await client.query(
        `SELECT user_id, forum_moderator FROM "${schema}".module_memberships`,
      );
      expect(result.rows).toEqual([{ user_id: 41, forum_moderator: false }]);
    } finally {
      client.release();
    }
  });

  it("rejects an existing incompatible column without altering its data", async () => {
    const client = await pool.connect();
    const schema = `forum_moderator_${randomUUID().replaceAll("-", "")}`;
    schemas.push(schema);
    try {
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(
        `CREATE TABLE "${schema}".module_memberships (id serial PRIMARY KEY, forum_moderator text NOT NULL)`,
      );
      await client.query(
        `INSERT INTO "${schema}".module_memberships (forum_moderator) VALUES ('preserve')`,
      );

      const sql = readFileSync(
        new URL(
          "../../../deploy/migrations/module-forum-moderators.sql",
          import.meta.url,
        ),
        "utf8",
      )
        .replaceAll("public.", `${schema}.`)
        .replaceAll("'public'", `'${schema}'`);
      await expect(client.query(sql)).rejects.toThrow(
        /incompatible type, nullability, or default/,
      );
      await client.query("ROLLBACK");

      const result = await client.query(
        `SELECT forum_moderator FROM "${schema}".module_memberships`,
      );
      expect(result.rows).toEqual([{ forum_moderator: "preserve" }]);
    } finally {
      client.release();
    }
  });
});
