import type { MyTeachingProfile } from "@workspace/api-client-react";

export interface TeachingProfileGateState {
  checking: boolean;
  failed: boolean;
  requiresCompletion: boolean;
}

export function getTeachingProfileGateState({
  isTeacher,
  isPending,
  isError,
  profile,
}: {
  isTeacher: boolean;
  isPending: boolean;
  isError: boolean;
  profile?: MyTeachingProfile;
}): TeachingProfileGateState {
  if (!isTeacher) {
    return { checking: false, failed: false, requiresCompletion: false };
  }

  if (!profile && isPending) {
    return { checking: true, failed: false, requiresCompletion: false };
  }

  if (!profile && isError) {
    return { checking: false, failed: true, requiresCompletion: false };
  }

  const savedCenterId =
    profile?.user.role === "teacher"
      ? profile.user.centerId
      : profile?.user.teachingCenterId ?? profile?.user.centerId;

  const requiresCompletion =
    !profile ||
    savedCenterId == null ||
    profile.targetProvinceId == null ||
    profile.targetCenterId !== savedCenterId ||
    (profile.user.role === "teacher" &&
      profile.user.provinceId !== profile.targetProvinceId) ||
    (Boolean(profile.activeYear) &&
      profile.moduleIds.length === 0 &&
      !profile.doesNotTeach);

  return {
    checking: false,
    failed: false,
    requiresCompletion,
  };
}
