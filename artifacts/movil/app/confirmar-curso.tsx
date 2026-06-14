import React, { useEffect, useMemo, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";

import {
  getGetMyYearConfirmationQueryKey,
  getListCentersQueryKey,
  getListModulesQueryKey,
  useConfirmYear,
  useGetMyYearConfirmation,
  useListCenters,
  useListModules,
} from "@workspace/api-client-react";

import { AppHeader } from "@/components/AppHeader";
import { Button, Card, EmptyState, Loading } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

export default function ConfirmYearScreen() {
  const colors = useColors();
  const qc = useQueryClient();
  const { user } = useAuth();
  const isTeacher = user?.role === "teacher";

  const { data: confirmation, isLoading: loadingConfirmation } =
    useGetMyYearConfirmation({
      query: {
        queryKey: getGetMyYearConfirmationQueryKey(),
        enabled: isTeacher,
      },
    });

  const { data: centers = [], isLoading: loadingCenters } = useListCenters(
    {},
    { query: { queryKey: getListCentersQueryKey({}), enabled: isTeacher } },
  );
  const { data: modules = [], isLoading: loadingModules } = useListModules(
    {},
    { query: { queryKey: getListModulesQueryKey({}), enabled: isTeacher } },
  );

  const confirmMut = useConfirmYear();

  const [centerId, setCenterId] = useState<number | null>(null);
  const [moduleIds, setModuleIds] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (initialized) return;
    if (loadingConfirmation) return;
    setCenterId(confirmation?.centerId ?? user?.centerId ?? null);
    setModuleIds(confirmation?.moduleIds ?? []);
    setInitialized(true);
  }, [initialized, loadingConfirmation, confirmation, user]);

  const deadlineLabel = useMemo(() => {
    if (!confirmation?.deadline) return null;
    return new Date(confirmation.deadline).toLocaleDateString("es-ES", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }, [confirmation]);

  const toggleModule = (id: number) => {
    setModuleIds((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id],
    );
  };

  const onConfirm = async () => {
    setError(null);
    if (centerId == null) {
      setError("Selecciona tu centro.");
      return;
    }
    if (moduleIds.length === 0) {
      setError("Selecciona al menos un módulo que impartes.");
      return;
    }
    try {
      await confirmMut.mutateAsync({ data: { centerId, moduleIds } });
      await qc.invalidateQueries({
        queryKey: getGetMyYearConfirmationQueryKey(),
      });
      router.back();
    } catch {
      setError("No se pudo registrar la confirmación. Inténtalo de nuevo.");
    }
  };

  const bottomPad = Platform.OS === "web" ? 100 : 40;
  const loading = loadingConfirmation || loadingCenters || loadingModules;

  // Non-teacher or no pending window: nothing to confirm.
  const notPending =
    !isTeacher || !confirmation || confirmation.status !== "pending";

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader title="Confirmar curso" subtitle="Centro y módulos" showBack />
      {loading ? (
        <Loading />
      ) : notPending ? (
        <EmptyState
          icon="check-circle"
          title="Nada que confirmar"
          message={
            confirmation?.status === "confirmed"
              ? "Ya has confirmado tu centro y módulos para el curso."
              : "No tienes ninguna confirmación pendiente en este momento."
          }
        />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[styles.intro, { color: colors.mutedForeground }]}>
            Indica tu centro y los módulos que vas a impartir
            {confirmation?.year ? ` en el curso ${confirmation.year}` : ""}.
            {deadlineLabel
              ? ` Tienes hasta el ${deadlineLabel}.`
              : ""}
          </Text>

          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            Centro
          </Text>
          <Card style={styles.listCard}>
            {centers.length === 0 ? (
              <Text style={[styles.muted, { color: colors.mutedForeground }]}>
                No hay centros disponibles.
              </Text>
            ) : (
              centers.map((c) => {
                const active = centerId === c.id;
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => setCenterId(c.id)}
                    style={({ pressed }) => [
                      styles.option,
                      {
                        borderColor: active ? colors.primary : colors.border,
                        backgroundColor: active
                          ? colors.accent
                          : colors.background,
                        borderRadius: colors.radius,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <Feather
                      name={active ? "check-circle" : "circle"}
                      size={20}
                      color={active ? colors.primary : colors.mutedForeground}
                    />
                    <Text
                      style={[
                        styles.optionText,
                        {
                          color: active
                            ? colors.foreground
                            : colors.mutedForeground,
                        },
                      ]}
                    >
                      {c.name}
                    </Text>
                  </Pressable>
                );
              })
            )}
          </Card>

          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            Módulos que impartes
          </Text>
          <Card style={styles.listCard}>
            {modules.length === 0 ? (
              <Text style={[styles.muted, { color: colors.mutedForeground }]}>
                No hay módulos disponibles.
              </Text>
            ) : (
              modules.map((m) => {
                const active = moduleIds.includes(m.id);
                return (
                  <Pressable
                    key={m.id}
                    onPress={() => toggleModule(m.id)}
                    style={({ pressed }) => [
                      styles.option,
                      {
                        borderColor: active ? colors.primary : colors.border,
                        backgroundColor: active
                          ? colors.accent
                          : colors.background,
                        borderRadius: colors.radius,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <Feather
                      name={active ? "check-square" : "square"}
                      size={20}
                      color={active ? colors.primary : colors.mutedForeground}
                    />
                    <Text
                      style={[
                        styles.optionText,
                        {
                          color: active
                            ? colors.foreground
                            : colors.mutedForeground,
                        },
                      ]}
                    >
                      {m.code ? `${m.code} · ` : ""}
                      {m.name}
                    </Text>
                  </Pressable>
                );
              })
            )}
          </Card>

          {error ? (
            <Text style={[styles.error, { color: colors.destructive }]}>
              {error}
            </Text>
          ) : null}

          <Button
            label="Confirmar"
            icon="check"
            onPress={onConfirm}
            loading={confirmMut.isPending}
            style={{ marginTop: 4 }}
          />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 12 },
  intro: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  sectionTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    marginTop: 6,
  },
  listCard: { gap: 8 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  optionText: { fontSize: 15, fontFamily: "Inter_500Medium", flex: 1 },
  muted: { fontSize: 14, fontFamily: "Inter_400Regular" },
  error: { fontSize: 14, fontFamily: "Inter_400Regular" },
});
