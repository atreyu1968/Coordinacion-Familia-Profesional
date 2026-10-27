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
