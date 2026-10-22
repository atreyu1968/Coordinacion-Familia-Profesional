import React from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";

import {
  getListEventsQueryKey,
  useListEvents,
  useListPublishedMinutes,
} from "@workspace/api-client-react";
import { AppHeader } from "@/components/AppHeader";
import { ErrorState } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

const PARAMS = { type: "coordination_meeting" as const };

export default function ActasScreen() {
  const colors = useColors();
  const { user } = useAuth();
  const isDepartmentHead = user?.role === "department_head";
  const eventsQuery = useListEvents(PARAMS, {
    query: { queryKey: getListEventsQueryKey(PARAMS), enabled: !isDepartmentHead },
  });
  const publishedQuery = useListPublishedMinutes({ query: { enabled: isDepartmentHead } });
  const query = isDepartmentHead ? publishedQuery : eventsQuery;
  const events = eventsQuery.data ?? [];
  const publishedMinutes = publishedQuery.data ?? [];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader title="Actas de coordinación" subtitle={isDepartmentHead ? "Actas oficiales publicadas" : "Reuniones de coordinación"} showBack />
      {query.isLoading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : query.error ? (
        <ErrorState onRetry={query.refetch} />
      ) : isDepartmentHead ? (
        <FlatList
          data={publishedMinutes}
          keyExtractor={(item) => String(item.eventId)}
          scrollEnabled={publishedMinutes.length > 0}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.center}>
              <Feather name="file-text" size={28} color={colors.mutedForeground} />
              <Text style={[styles.empty, { color: colors.mutedForeground }]}>Todavía no hay actas oficiales publicadas.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              testID={`row-acta-${item.eventId}`}
              accessibilityRole="button"
              accessibilityLabel={`Ver acta publicada de ${item.eventName}`}
              onPress={() => router.push({
                pathname: "/acta/[id]",
                params: {
                  id: String(item.eventId),
                  name: item.eventName,
                  startAt: item.eventStartAt ?? "",
                },
              })}
              style={({ pressed }) => [styles.row, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={2}>{item.eventName}</Text>
                {item.eventStartAt ? (
                  <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                    {new Date(item.eventStartAt).toLocaleDateString("es-ES", { dateStyle: "long" })}
                  </Text>
                ) : null}
                <Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={1}>{item.actaDocument.fileName}</Text>
              </View>
              <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
            </Pressable>
          )}
        />
      ) : (
        <FlatList
          data={events}
          keyExtractor={(e) => String(e.id)}
          scrollEnabled={events.length > 0}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.center}>
              <Feather name="file-text" size={28} color={colors.mutedForeground} />
              <Text style={[styles.empty, { color: colors.mutedForeground }]}>No hay reuniones de coordinación.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              testID={`row-acta-${item.id}`}
              accessibilityRole="button"
              accessibilityLabel={`Ver acta de ${item.name}`}
              onPress={() => router.push({
                pathname: "/acta/[id]",
                params: { id: String(item.id), name: item.name, startAt: item.startAt ?? "" },
              })}
              style={({ pressed }) => [styles.row, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={2}>{item.name}</Text>
                {item.startAt ? (
                  <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                    {new Date(item.startAt).toLocaleDateString("es-ES", { dateStyle: "long" })}
                  </Text>
                ) : null}
              </View>
              <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 8 },
  list: { padding: 16, gap: 10, paddingBottom: 48 },
  empty: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 12, padding: 14 },
  name: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  meta: { fontSize: 12, marginTop: 3, fontFamily: "Inter_400Regular" },
});
