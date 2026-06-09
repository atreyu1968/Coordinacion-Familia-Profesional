import React from "react";
import { FlatList, StyleSheet, Text, View, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";

import { useListDocumentForms, type DocumentFormSummary } from "@workspace/api-client-react";

import { AppHeader } from "@/components/AppHeader";
import { Card, EmptyState, ErrorState, Loading } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { formatDate } from "@/lib/format";

const STATUS_LABEL: Record<string, string> = {
  draft: "Borrador",
  open: "Abierto",
  closed: "Cerrado",
};

export default function FormulariosScreen() {
  const colors = useColors();
  const { data, isLoading, isError, refetch, isRefetching } = useListDocumentForms();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader title="Formularios" subtitle="Entrega de documentos" showBack />
      {isLoading ? (
        <Loading />
      ) : isError ? (
        <ErrorState onRetry={refetch} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(item: DocumentFormSummary) => String(item.id)}
          contentContainerStyle={[styles.list, { flexGrow: 1 }]}
          onRefresh={refetch}
          refreshing={isRefetching}
          scrollEnabled={!!data && data.length > 0}
          ListEmptyComponent={
            <EmptyState
              icon="file-text"
              title="Sin formularios"
              message="No hay formularios de entrega disponibles ahora mismo."
            />
          }
          renderItem={({ item }) => {
            const isOpen = item.status === "open";
            return (
              <Pressable
                onPress={() =>
                  router.push({ pathname: "/form/[id]", params: { id: String(item.id) } })
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
                        {STATUS_LABEL[item.status] ?? item.status}
                      </Text>
                    </View>
                    {item.hasSubmitted ? (
                      <View style={styles.submitted}>
                        <Feather name="check-circle" size={16} color={colors.primary} />
                        <Text style={[styles.submittedText, { color: colors.primary }]}>
                          Entregado
                        </Text>
                      </View>
                    ) : (
                      <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
                    )}
                  </View>
                  <Text style={[styles.title, { color: colors.foreground }]}>{item.title}</Text>
                  {item.description ? (
                    <Text style={[styles.desc, { color: colors.mutedForeground }]} numberOfLines={2}>
                      {item.description}
                    </Text>
                  ) : null}
                  {item.closesAt ? (
                    <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                      Cierra el {formatDate(String(item.closesAt))}
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
  submitted: { flexDirection: "row", alignItems: "center", gap: 4 },
  submittedText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  title: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  desc: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  meta: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 2 },
});
