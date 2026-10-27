import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  getGetDashboardStatisticsQueryKey,
  getGetDashboardSummaryQueryKey,
} from "@workspace/api-client-react";
import { invalidateResourceDashboardQueries } from "./resource-dashboard-cache";

describe("dashboard refresh after resource changes", () => {
  it("invalidates summary and chart queries for every selected period", async () => {
    const queryClient = new QueryClient();
    const period = { startDate: "2026-09-01", endDate: "2027-08-31" };
    const keys = [
      getGetDashboardSummaryQueryKey(),
      getGetDashboardSummaryQueryKey(period),
      getGetDashboardStatisticsQueryKey(),
      getGetDashboardStatisticsQueryKey(period),
    ];
    for (const key of keys) queryClient.setQueryData(key, { resources: 3 });

    await invalidateResourceDashboardQueries(queryClient);

    for (const key of keys) {
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    }
    queryClient.clear();
  });
});
