import React from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";

import { useListCompanyAlerts, type CompanyAlert } from "@workspace/api-client-react";

import { AppHeader } from "@/components/AppHeader";
import { Card, EmptyState, ErrorState, Loading } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { formatRelative } from "@/lib/format";

export default function AlertsScreen() {
  const colors = useColors();
  const { data, isLoading, isError, refetch, isRefetching } = useListCompanyAlerts();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader title="Alertas de empresa" subtitle="Oportunidades de FCT" showBack />
      {isLoading ? (
        <Loading />
      ) : isError ? (
        <ErrorState onRetry={refetch} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(item: CompanyAlert) => String(item.id)}
          contentContainerStyle={[styles.list, { flexGrow: 1 }]}
          onRefresh={refetch}
          refreshing={isRefetching}
          scrollEnabled={!!data && data.length > 0}
          ListEmptyComponent={
            <EmptyState
              icon="briefcase"
              title="Sin alertas"
              message="No hay oportunidades de empresa publicadas ahora mismo."
            />
          }
          renderItem={({ item }) => (
            <Card style={styles.card}>
              <View style={styles.head}>
                <Text style={[styles.company, { color: colors.primary }]} numberOfLines={1}>
                  {item.companyName}
                </Text>
                {item.createdAt ? (
                  <Text style={[styles.time, { color: colors.mutedForeground }]}>
                    {formatRelative(item.createdAt)}
                  </Text>
                ) : null}
              </View>
              {item.sector ? (
                <Text style={[styles.title, { color: colors.foreground }]}>{item.sector}</Text>
              ) : null}
              {item.description ? (
                <Text style={[styles.desc, { color: colors.mutedForeground }]}>
                  {item.description}
                </Text>
              ) : null}
              <View style={styles.metaRow}>
                {item.location ? (
                  <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                    📍 {item.location}
                  </Text>
                ) : null}
                {item.positions ? (
                  <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                    👥 {item.positions} plaza{item.positions === 1 ? "" : "s"}
                  </Text>
                ) : null}
              </View>
            </Card>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: 16, gap: 12 },
  card: { gap: 8 },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  company: { fontSize: 13, fontFamily: "Inter_600SemiBold", flex: 1 },
  time: { fontSize: 12, fontFamily: "Inter_400Regular" },
  title: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  desc: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 16, marginTop: 2 },
  meta: { fontSize: 13, fontFamily: "Inter_500Medium" },
});
