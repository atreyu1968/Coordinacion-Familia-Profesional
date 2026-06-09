import type {
  Center,
  Province,
  Department,
  TrainingOffer,
  Invitation,
} from "@workspace/db";

export function toProvince(row: Province) {
  return { id: row.id, name: row.name, code: row.code ?? undefined };
}

export function toCenter(row: Center) {
  return {
    id: row.id,
    name: row.name,
    code: row.code ?? undefined,
    provinceId: row.provinceId,
    islandId: row.islandId,
    municipalityId: row.municipalityId,
    address: row.address,
    latitude: row.latitude,
    longitude: row.longitude,
    phone: row.phone,
    email: row.email,
    website: row.website,
  };
}

export function toDepartment(row: Department) {
  return {
    id: row.id,
    centerId: row.centerId,
    name: row.name,
    headUserId: row.headUserId,
  };
}

export function toTrainingOffer(row: TrainingOffer) {
  return {
    id: row.id,
    centerId: row.centerId,
    cycleName: row.cycleName,
    level: row.level ?? undefined,
    shift: row.shift,
  };
}

export function toInvitation(row: Invitation) {
  return {
    id: row.id,
    code: row.code,
    email: row.email,
    role: row.role,
    provinceId: row.provinceId,
    centerId: row.centerId,
    departmentId: row.departmentId,
    status: row.status,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
    createdAt: row.createdAt,
  };
}
