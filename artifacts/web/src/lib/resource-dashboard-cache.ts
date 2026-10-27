import type { QueryClient } from "@tanstack/react-query";
import type { Socket } from "socket.io-client";
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

export function subscribeToDashboardActivity(
  socket: Pick<Socket, "on" | "off">,
  queryClient: Pick<QueryClient, "invalidateQueries">,
): () => void {
  const refresh = () => {
    void invalidateResourceDashboardQueries(queryClient);
  };
  socket.on("dashboard:activity", refresh);
  socket.on("connect", refresh);
  return () => {
    socket.off("dashboard:activity", refresh);
    socket.off("connect", refresh);
  };
}

export async function refreshDashboardAfterMutation<T>(
  queryClient: Pick<QueryClient, "invalidateQueries">,
  mutate: () => Promise<T>,
): Promise<T> {
  const result = await mutate();
  await invalidateResourceDashboardQueries(queryClient);
  return result;
}
