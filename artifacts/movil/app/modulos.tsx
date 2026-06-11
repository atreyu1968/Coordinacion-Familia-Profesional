import React, { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";

import {
  getListModulesQueryKey,
  useEnrollInModule,
  useLeaveModule,
  useListModules,
  type Module,
} from "@workspace/api-client-react";

import { AppHeader } from "@/components/AppHeader";
import { Card, EmptyState, ErrorState, Loading } from "@/components/ui";
import { useColors } from "@/hooks/useColors";

export default function ModulosScreen() {
  const colors = useColors();
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch, isRefetching } = useListModules({});
  const enrollMut = useEnrollInModule();
  const leaveMut = useLeaveModule();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: getListModulesQueryKey() });

  const onEnroll = async (m: Module) => {
    setError(null);
    setBusyId(m.id);
    try {
      await enrollMut.mutateAsync({ moduleId: m.id });
      await invalidate();
    } catch {
      setError("No se pudo completar la operación. Inténtalo de nuevo.");
    } finally {
      setBusyId(null);
    }
  };

  const onLeave = async (m: Module) => {
    setError(null);
    setBusyId(m.id);
    try {
      await leaveMut.mutateAsync({ moduleId: m.id });
      await invalidate();
    } catch {
      setError("No se pudo completar la operación. Inténtalo de nuevo.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader
        title="Mis módulos"
        subtitle="Inscríbete en los módulos que impartes"
        showBack
      />
      {isLoading ? (
        <Loading />
      ) : isError ? (
        <ErrorState onRetry={refetch} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(item: Module) => String(item.id)}
          contentContainerStyle={[styles.list, { flexGrow: 1 }]}
          onRefresh={refetch}
          refreshing={isRefetching}
          scrollEnabled={!!data && data.length > 0}
          ListHeaderComponent={
            error ? (
              <Text style={[styles.error, { color: colors.destructive }]}>
                {error}
              </Text>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="book-open"
              title="Sin módulos"
              message="No hay módulos disponibles ahora mismo."
            />
          }
          renderItem={({ item }) => {
            const busy = busyId === item.id;
            const isCoordinator = item.myRole === "coordinator";
            return (
              <Card style={styles.card}>
                <View style={styles.cardHead}>
                  <View style={styles.titleWrap}>
                    <Text
                      style={[styles.title, { color: colors.foreground }]}
                      numberOfLines={2}
                    >
                      {item.name}
                    </Text>
                    {item.cycleName ? (
                      <Text
                        style={[styles.cycle, { color: colors.mutedForeground }]}
                        numberOfLines={1}
                      >
                        {item.cycleName}
                      </Text>
                    ) : null}
                  </View>
                  {isCoordinator ? (
                    <View
                      style={[styles.badge, { backgroundColor: colors.accent }]}
                    >
                      <Text
                        style={[
                          styles.badgeText,
                          { color: colors.accentForeground },
                        ]}
                      >
                        Coordino
                      </Text>
                    </View>
                  ) : null}
                </View>

                {item.enrolled ? (
                  <Pressable
                    onPress={() => onLeave(item)}
                    disabled={busy || isCoordinator}
                    style={({ pressed }) => [
                      styles.btn,
                      {
                        borderColor: colors.border,
                        borderWidth: StyleSheet.hairlineWidth,
                        borderRadius: colors.radius,
                        opacity: pressed || busy || isCoordinator ? 0.5 : 1,
                      },
                    ]}
                  >
                    <Feather
                      name="check"
                      size={16}
                      color={colors.mutedForeground}
                    />
                    <Text
                      style={[styles.btnText, { color: colors.mutedForeground }]}
                    >
                      {isCoordinator
                        ? "Inscrito"
                        : busy
                          ? "Saliendo…"
                          : "Inscrito · Salir"}
                    </Text>
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={() => onEnroll(item)}
                    disabled={busy}
                    style={({ pressed }) => [
                      styles.btn,
                      {
                        backgroundColor: colors.primary,
                        borderRadius: colors.radius,
                        opacity: pressed || busy ? 0.7 : 1,
                      },
                    ]}
                  >
                    <Feather
                      name="plus"
                      size={16}
                      color={colors.primaryForeground}
                    />
                    <Text
                      style={[styles.btnText, { color: colors.primaryForeground }]}
                    >
                      {busy ? "Inscribiendo…" : "Inscribirme"}
                    </Text>
                  </Pressable>
                )}
              </Card>
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
  error: { fontSize: 13, fontFamily: "Inter_500Medium", marginBottom: 8 },
  card: { gap: 12 },
  cardHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  titleWrap: { flex: 1, gap: 3 },
  title: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  cycle: { fontSize: 13, fontFamily: "Inter_400Regular" },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 11,
  },
  btnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
