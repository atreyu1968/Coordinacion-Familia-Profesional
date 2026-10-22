import { and, inArray, isNull, notInArray, or, sql, type SQL } from "drizzle-orm";
import { cyclesTable, modulesTable } from "@workspace/db";
import { fpCycleFamilies } from "./generated/fpCycleFamilies";

const officialNames = Object.keys(fpCycleFamilies);
function familyNames(activeFamily: string): string[] {
  const normalized = activeFamily.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return officialNames.filter((name) => fpCycleFamilies[name].some(
    (family) => family.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() === normalized,
  ));
}

// The global catalogs have no family column. Resolve their family membership
// through the cycles offered by non-deleted centers in the active family.
export function cycleFamilyFilter(activeFamily: string): SQL {
  const familyJson = JSON.stringify([activeFamily]);
  const legacyOffer = sql`exists (
    select 1
    from training_offer family_offer
    inner join centers family_center
      on family_center.id = family_offer.center_id
    where family_offer.deleted_at is null
      and family_center.deleted_at is null
      and family_center.families @> ${familyJson}::jsonb
      and (
        family_offer.cycle_id = ${cyclesTable.id}
        or (
          family_offer.cycle_id is null
          and family_offer.cycle_name = ${cyclesTable.name}
        )
      )
  )`;
  // Official Grados D cycles remain available even before a center records
  // its own training offer. Custom cycles still derive family from an offer.
  return or(
    inArray(cyclesTable.name, familyNames(activeFamily)),
    and(notInArray(cyclesTable.name, officialNames), legacyOffer),
  )!;
}

// Center-bound modules inherit their center's family. Global modules inherit
// the family of any center that offers their cycle. The name fallback keeps
// older modules/offers visible when one side has no cycle ID.
export function moduleFamilyFilter(activeFamily: string): SQL {
  const familyJson = JSON.stringify([activeFamily]);
  const legacyOffer = sql`(
    (
      ${modulesTable.centerId} is not null
      and exists (
        select 1
        from centers module_family_center
        where module_family_center.id = ${modulesTable.centerId}
          and module_family_center.deleted_at is null
          and module_family_center.families @> ${familyJson}::jsonb
      )
    )
    or
    (
      ${modulesTable.centerId} is null
      and exists (
        select 1
        from training_offer module_family_offer
        inner join centers module_offer_center
          on module_offer_center.id = module_family_offer.center_id
        where module_family_offer.deleted_at is null
          and module_offer_center.deleted_at is null
          and module_offer_center.families @> ${familyJson}::jsonb
          and (
            (
              ${modulesTable.cycleId} is not null
              and (
                module_family_offer.cycle_id = ${modulesTable.cycleId}
                or (
                  module_family_offer.cycle_id is null
                  and module_family_offer.cycle_name = ${modulesTable.cycleName}
                )
              )
            )
            or (
              ${modulesTable.cycleId} is null
              and module_family_offer.cycle_name = ${modulesTable.cycleName}
            )
          )
      )
    )
  )`;
  const cycleName = sql<string>`coalesce(
    (select family_cycle.name from cycles family_cycle where family_cycle.id = ${modulesTable.cycleId}),
    ${modulesTable.cycleName}
  )`;
  const centerInFamily = sql`(
    ${modulesTable.centerId} is null or exists (
      select 1 from centers module_center
      where module_center.id = ${modulesTable.centerId}
        and module_center.deleted_at is null
        and module_center.families @> ${familyJson}::jsonb
    )
  )`;
  return and(centerInFamily, or(
    inArray(cycleName, familyNames(activeFamily)),
    and(or(isNull(cycleName), notInArray(cycleName, officialNames)), legacyOffer),
  ))!;
}