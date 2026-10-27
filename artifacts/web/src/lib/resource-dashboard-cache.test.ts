import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  getGetDashboardStatisticsQueryKey,
  getGetDashboardSummaryQueryKey,
} from "@workspace/api-client-react";
import {
  invalidateResourceDashboardQueries,
  refreshDashboardAfterMutation,
  subscribeToDashboardActivity,
} from "./resource-dashboard-cache";

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

  it.each([
    "crear una encuesta",
    "eliminar una encuesta",
    "crear un evento",
    "eliminar un evento",
    "crear un aviso de empresa",
    "eliminar un aviso de empresa",
  ])("actualiza los recuentos y gráficas al %s", async (operation) => {
    const queryClient = new QueryClient();
    const mutation = vi.fn().mockResolvedValue({ operation });
    const summaryKey = getGetDashboardSummaryQueryKey({
      startDate: "2026-09-01",
      endDate: "2027-08-31",
    });
    const statisticsKey = getGetDashboardStatisticsQueryKey({
      startDate: "2026-09-01",
      endDate: "2027-08-31",
    });
    queryClient.setQueryData(summaryKey, { activeSurveys: 2 });
    queryClient.setQueryData(statisticsKey, { surveysByStatus: [] });

    await expect(
      refreshDashboardAfterMutation(queryClient, mutation),
    ).resolves.toEqual({ operation });

    expect(mutation).toHaveBeenCalledOnce();
    expect(queryClient.getQueryState(summaryKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(statisticsKey)?.isInvalidated).toBe(true);
    queryClient.clear();
  });

  it("no invalida el panel si la mutación falla", async () => {
    const queryClient = new QueryClient();
    const mutation = vi.fn().mockRejectedValue(new Error("falló"));
    const summaryKey = getGetDashboardSummaryQueryKey();
    const statisticsKey = getGetDashboardStatisticsQueryKey();
    queryClient.setQueryData(summaryKey, { activeSurveys: 2 });
    queryClient.setQueryData(statisticsKey, { surveysByStatus: [] });

    await expect(
      refreshDashboardAfterMutation(queryClient, mutation),
    ).rejects.toThrow("falló");

    expect(mutation).toHaveBeenCalledOnce();
    expect(queryClient.getQueryState(summaryKey)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(statisticsKey)?.isInvalidated).toBe(false);
    queryClient.clear();
  });

  it("vuelve a consultar las tarjetas y gráficas activas sin desmontar el panel", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const period = { startDate: "2026-09-01", endDate: "2027-08-31" };
    let summaryFetches = 0;
    let statisticsFetches = 0;
    const summaryObserver = new QueryObserver(queryClient, {
      queryKey: getGetDashboardSummaryQueryKey(period),
      queryFn: async () => ({ activeSurveys: ++summaryFetches }),
    });
    const statisticsObserver = new QueryObserver(queryClient, {
      queryKey: getGetDashboardStatisticsQueryKey(period),
      queryFn: async () => ({ surveysByStatus: [{ value: ++statisticsFetches }] }),
    });
    const unsubscribeSummary = summaryObserver.subscribe(() => undefined);
    const unsubscribeStatistics = statisticsObserver.subscribe(() => undefined);

    await Promise.all([
      summaryObserver.refetch(),
      statisticsObserver.refetch(),
    ]);
    await refreshDashboardAfterMutation(queryClient, async () => undefined);

    expect(summaryObserver.getCurrentResult().data?.activeSurveys).toBe(2);
    expect(
      statisticsObserver.getCurrentResult().data?.surveysByStatus[0]?.value,
    ).toBe(2);

    unsubscribeSummary();
    unsubscribeStatistics();
    queryClient.clear();
  });

  it("actualiza el panel al recibir cambios y al reconectar el socket", async () => {
    const queryClient = new QueryClient();
    const summaryKey = getGetDashboardSummaryQueryKey({
      provinceId: 2,
      startDate: "2026-09-01",
      endDate: "2027-08-31",
    });
    const statisticsKey = getGetDashboardStatisticsQueryKey({
      provinceId: 2,
      startDate: "2026-09-01",
      endDate: "2027-08-31",
    });
    queryClient.setQueryData(summaryKey, { activeSurveys: 2 });
    queryClient.setQueryData(statisticsKey, { surveysByStatus: [] });

    const listeners = new Map<string, () => void>();
    const socket = {
      on: vi.fn((event: string, listener: () => void) => {
        listeners.set(event, listener);
        return socket;
      }),
      off: vi.fn((event: string) => {
        listeners.delete(event);
        return socket;
      }),
    };
    const unsubscribe = subscribeToDashboardActivity(
      socket as never,
      queryClient,
    );

    listeners.get("dashboard:activity")?.();
    expect(queryClient.getQueryState(summaryKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(statisticsKey)?.isInvalidated).toBe(true);

    await queryClient.resetQueries();
    listeners.get("connect")?.();
    expect(queryClient.getQueryState(summaryKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(statisticsKey)?.isInvalidated).toBe(true);

    unsubscribe();
    expect(listeners.size).toBe(0);
    queryClient.clear();
  });
});
