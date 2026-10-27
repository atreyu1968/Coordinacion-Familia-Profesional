import { and, eq, isNull, sql } from "drizzle-orm";
import { db, integrationSettingsTable, usersTable, wikiPagesTable, wikiExternalLinksTable, normativaPublicationsTable } from "@workspace/db";
import { isUneditedNormativaIndex, loadNormativaCatalog, normativaIndexContent, normativaSectionContent } from "./normativa-catalog";

/** Adds references without overwriting human edits or reviving deleted content. */
export async function seedNormativaCatalog() {
  const catalog = loadNormativaCatalog();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('coordina:normativa-fp'))`);
    const [settings] = await tx.select({ family: integrationSettingsTable.professionalFamily })
      .from(integrationSettingsTable).limit(1);
    const family = settings?.family?.trim() || "Administración y Gestión";
    if (family !== catalog.family) return { pages: 0, links: 0, skipped: "Otra familia profesional activa" };
    const [actor] = await tx.select({ id: usersTable.id }).from(usersTable)
      .where(and(eq(usersTable.role, "superadmin"), eq(usersTable.status, "active"), isNull(usersTable.deletedAt)))
      .orderBy(usersTable.id).limit(1);
    if (!actor) return { pages: 0, links: 0, skipped: "Pendiente de crear el primer administrador" };

    // Known references are a baseline, not new alerts. Never reset an existing review.
    for (const section of catalog.sections) {
      for (const reference of section.references) {
        const url = new URL(reference.url);
        const boe = reference.url.match(/BOE-A-\d{4}-\d+/i)?.[0]?.toUpperCase();
        const boc = url.pathname.match(/\/boc\/(?:archivo\/)?(\d{4})\/(\d+)\/(\d+)\.html/i);
        const bocPdf = url.pathname.match(/boc-a-(\d{4})-(\d+)-(\d+)\.pdf/i);
        const parts = boc ?? bocPdf;
        const officialId = boe ?? (parts ? `BOC-A-${parts[1]}-${Number(parts[2])}-${Number(parts[3])}` : null);
        if (!officialId) continue;
        await tx.insert(normativaPublicationsTable).values({
          source: boe ? "BOE" : "BOC", officialId, title: reference.title, url: reference.url,
          relevance: "uncertain", reason: "Referencia del catálogo inicial; no implica vigencia.",
          status: "catalog",
        }).onConflictDoNothing();
      }
    }

    let pages = 0;
    let links = 0;
    const page = async (key: string, title: string, content: string, parentId: number | null) => {
      const marker = `catalogo-normativa:${key}`;
      const [existing] = await tx.select().from(wikiPagesTable)
        .where(and(isNull(wikiPagesTable.moduleId), sql`${marker} = ANY(${wikiPagesTable.tags})`)).limit(1);
      if (existing) {
        if (existing.deletedAt) return null;
        if (key === "indice" && existing.content !== content && isUneditedNormativaIndex(existing.content, catalog)) {
          await tx.update(wikiPagesTable).set({ content, updatedBy: actor.id })
            .where(and(eq(wikiPagesTable.id, existing.id), eq(wikiPagesTable.content, existing.content)));
        }
        return existing.id;
      }
      // Respect a pre-existing user-created page with the same title and scope.
      const [sameTitle] = await tx.select().from(wikiPagesTable).where(and(
        isNull(wikiPagesTable.moduleId), isNull(wikiPagesTable.deletedAt),
        parentId === null ? isNull(wikiPagesTable.parentId) : eq(wikiPagesTable.parentId, parentId),
        eq(wikiPagesTable.title, title),
      )).limit(1);
      if (sameTitle) return sameTitle.id;
      const [created] = await tx.insert(wikiPagesTable).values({
        title, content, parentId, moduleId: null,
        tags: ["normativa", "fp", "canarias", "administracion-y-gestion", marker],
        createdBy: actor.id, updatedBy: actor.id,
      }).returning({ id: wikiPagesTable.id });
      pages++;
      return created!.id;
    };
    const root = await page("indice", "Normativa", normativaIndexContent(catalog), null);
    if (root === null) return { pages, links, skipped: "Apartado retirado por la administración" };
    for (const section of catalog.sections) {
      const id = await page(section.key, `Normativa · ${section.title}`, normativaSectionContent(catalog, section), root);
      if (id === null) continue;
      const existingLinks = await tx.select({ url: wikiExternalLinksTable.url }).from(wikiExternalLinksTable)
        .where(eq(wikiExternalLinksTable.pageId, id));
      const knownUrls = new Set(existingLinks.map((link) => link.url));
      for (const reference of section.references) {
        if (knownUrls.has(reference.url)) continue;
        await tx.insert(wikiExternalLinksTable).values({
          pageId: id, title: reference.title, url: reference.url, createdBy: actor.id,
        });
        links++;
      }
    }
    return { pages, links, skipped: null };
  });
}
