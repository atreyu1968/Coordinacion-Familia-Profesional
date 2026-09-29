import { sql, type SQL } from "drizzle-orm";
import { cyclesTable, modulesTable } from "@workspace/db";

// The global catalogs have no family column. Resolve their family membership
// through the cycles offered by non-deleted centers in the active family.
export function cycleFamilyFilter(activeFamily: string): SQL {
  const familyJson = JSON.stringify([activeFamily]);
  return sql`exists (
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
}

// Center-bound modules inherit their center's family. Global modules inherit
// the family of any center that offers their cycle. The name fallback keeps
// older modules/offers visible when one side has no cycle ID.
export function moduleFamilyFilter(activeFamily: string): SQL {
  const familyJson = JSON.stringify([activeFamily]);
  return sql`(
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
}