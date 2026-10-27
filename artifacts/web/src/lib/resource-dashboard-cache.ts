import type { QueryClient } from "@tanstack/react-query";
import {
  getGetDashboardStatisticsQueryKey,
  getGetDashboardSummaryQueryKey,
} from "@workspace/api-client-react";

export function invalidateResourceDashboardQueries(
  queryClient: Pick<QueryClient, "invalidateQueries">,
) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }),
    queryClient.invalidateQueries({ queryKey: getGetDashboardStatisticsQueryKey() }),
  ]);
}

export async function refreshDashboardAfterMutation<T>(
  queryClient: Pick<QueryClient, "invalidateQueries">,
  mutate: () => Promise<T>,
): Promise<T> {
  const result = await mutate();
  await invalidateResourceDashboardQueries(queryClient);
  return result;
}
