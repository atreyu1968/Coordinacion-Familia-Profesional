import React from "react";
import { FlatList, Platform, StyleSheet, Text, View } from "react-native";

import {
  useListAnnouncements,
  type Announcement,
} from "@workspace/api-client-react";

import { AppHeader } from "@/components/AppHeader";
import { Card, EmptyState, ErrorState, Loading } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { formatRelative } from "@/lib/format";

export default function BoardScreen() {
  const colors = useColors();
  const { data, isLoading, isError, refetch, isRefetching } =
    useListAnnouncements();

  const bottomPad = Platform.OS === "web" ? 100 : 90;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader logo title="Tablón" subtitle="Anuncios y comunicados" />
      {isLoading ? (
        <Loading />
      ) : isError ? (
        <ErrorState onRetry={refetch} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(item: Announcement) => String(item.id)}
          contentContainerStyle={[styles.list, { paddingBottom: bottomPad }]}
          onRefresh={refetch}
          refreshing={isRefetching}
          scrollEnabled={!!data && data.length > 0}
          ListEmptyComponent={
            <EmptyState
              icon="layout"
              title="Sin anuncios"
              message="Cuando la coordinación publique comunicados aparecerán aquí."
            />
          }
          renderItem={({ item }) => (
            <Card style={styles.card}>
              <Text style={[styles.title, { color: colors.foreground }]}>
                {item.title}
              </Text>
              <Text style={[styles.body, { color: colors.mutedForeground }]}>
                {item.body}
              </Text>
              <View style={styles.metaRow}>
                <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                  {item.authorName ?? "Coordinación"}
                </Text>
                <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                  {formatRelative(item.createdAt)}
                </Text>
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
  list: { padding: 16, gap: 12, flexGrow: 1 },
  card: { gap: 8 },
  title: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  body: { fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 21 },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
  },
  meta: { fontSize: 12, fontFamily: "Inter_500Medium" },
});
