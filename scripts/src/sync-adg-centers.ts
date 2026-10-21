import { db, pool } from "@workspace/db";
import { syncAdgCenters } from "./lib/sync-adg-centers";

const apply = process.argv.includes("--apply");
try {
  const result = await db.transaction((tx) => syncAdgCenters(tx, apply));
  console.log(JSON.stringify({ mode: apply ? "applied" : "preview", ...result }, null, 2));
  if (!apply) console.log("Preview only. Add --apply to update the listed centers and withdraw the 12 authorized codes from this family; no centers are deleted.");
} catch (error) {
  console.error("Center synchronization failed; the transaction was rolled back.", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
