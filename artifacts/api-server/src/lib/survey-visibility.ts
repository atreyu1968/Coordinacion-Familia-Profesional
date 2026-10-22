import type { User } from "@workspace/db";
import { getViewerContext, isInAudience } from "./audience";

type SurveyAudience = {
  status: string;
  createdById: number | null;
  audienceType: string;
  audienceIds: number[] | null;
};

/** Apply the same audience and private-draft rules to lists and dashboard figures. */
export async function filterVisibleSurveys<T extends SurveyAudience>(caller: User, rows: T[]): Promise<T[]> {
  if (caller.role === "superadmin") return rows;
  const viewer = await getViewerContext(caller);
  return rows.filter((survey) =>
    survey.createdById === caller.id ||
    (survey.status !== "draft" && isInAudience(survey.audienceType, survey.audienceIds, viewer)),
  );
}
