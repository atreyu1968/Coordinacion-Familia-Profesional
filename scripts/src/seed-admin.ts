import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, pool, usersTable } from "@workspace/db";

// Creates the first superadmin account on a fresh database. Registration in the
// app is invitation-only, so a brand-new install has no way to log in until this
// account exists. Idempotent: if the email already exists it is left untouched
// unless SEED_ADMIN_RESET_PASSWORD=true is set.
//
// Required env: SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD
// Optional env: SEED_ADMIN_NAME (default "Administrador"),
//               SEED_ADMIN_RESET_PASSWORD ("true" to reset an existing account)

async function main(): Promise<void> {
  const email = (process.env.SEED_ADMIN_EMAIL || "").trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || "";
  const name = (process.env.SEED_ADMIN_NAME || "Administrador").trim();
  const resetPassword =
    (process.env.SEED_ADMIN_RESET_PASSWORD || "").trim().toLowerCase() === "true";

  if (!email || !password) {
    console.error(
      "SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD are required to seed the admin user.",
    );
    process.exitCode = 1;
    return;
  }

  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email));

  if (existing) {
    if (resetPassword) {
      const passwordHash = await bcrypt.hash(password, 10);
      await db
        .update(usersTable)
        .set({
          passwordHash,
          role: "superadmin",
          status: "active",
          deletedAt: null,
        })
        .where(eq(usersTable.id, existing.id));
      console.log(`Updated existing user "${email}" (password reset, role superadmin).`);
    } else {
      console.log(`User "${email}" already exists — leaving it unchanged.`);
    }
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await db.insert(usersTable).values({
    name: name || email,
    email,
    passwordHash,
    role: "superadmin",
    status: "active",
  });
  console.log(`Created superadmin "${email}".`);
}

main()
  .catch((err) => {
    console.error("Failed to seed admin user:", err);
    process.exitCode = 1;
  })
  .finally(() => {
    void pool.end();
  });
