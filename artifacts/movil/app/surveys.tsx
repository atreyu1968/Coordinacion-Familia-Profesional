import React from "react";
import { FlatList, StyleSheet, Text, View, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";

import { useListSurveys, type Survey } from "@workspace/api-client-react";

import { AppHeader } from "@/components/AppHeader";
import { Card, EmptyState, ErrorState, Loading } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { formatDate } from "@/lib/format";

const STATUS_LABEL: Record<string, string> = {
  draft: "Borrador",
  open: "Abierta",
  closed: "Cerrada",
};

export default function SurveysScreen() {
  const colors = useColors();
  const { data, isLoading, isError, refetch, isRefetching } = useListSurveys();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader title="Encuestas" subtitle="Participación y votaciones" showBack />
      {isLoading ? (
        <Loading />
      ) : isError ? (
        <ErrorState onRetry={refetch} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(item: Survey) => String(item.id)}
          contentContainerStyle={[styles.list, { flexGrow: 1 }]}
          onRefresh={refetch}
          refreshing={isRefetching}
          scrollEnabled={!!data && data.length > 0}
          ListEmptyComponent={
            <EmptyState
              icon="bar-chart-2"
              title="Sin encuestas"
              message="No hay encuestas ni votaciones disponibles ahora mismo."
            />
          }
          renderItem={({ item }) => {
            const isOpen = item.status === "open";
            return (
              <Pressable
                onPress={() =>
                  router.push({ pathname: "/survey/[id]", params: { id: String(item.id) } })
                }
                style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
              >
                <Card style={styles.card}>
                  <View style={styles.cardHead}>
                    <View
                      style={[
                        styles.badge,
                        {
                          backgroundColor: isOpen ? colors.accent : colors.muted,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.badgeText,
                          { color: isOpen ? colors.accentForeground : colors.mutedForeground },
                        ]}
                      >
                        {item.type === "vote" ? "Votación" : "Encuesta"} ·{" "}
                        {STATUS_LABEL[item.status] ?? item.status}
                      </Text>
                    </View>
                    <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
                  </View>
                  <Text style={[styles.title, { color: colors.foreground }]}>{item.title}</Text>
                  {item.description ? (
                    <Text style={[styles.desc, { color: colors.mutedForeground }]} numberOfLines={2}>
                      {item.description}
                    </Text>
                  ) : null}
                  {item.closesAt ? (
                    <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                      Cierra el {formatDate(item.closesAt)}
                    </Text>
                  ) : null}
                </Card>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: 16, gap: 12 },
  card: { gap: 8 },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  badgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  title: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  desc: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  meta: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 2 },
});
