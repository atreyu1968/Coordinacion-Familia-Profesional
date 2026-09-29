import React from "react";
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { useFocusEffect, useRouter } from "expo-router";

import {
  getListNotificationsQueryKey,
  useListNotifications,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  type Notification,
} from "@workspace/api-client-react";

import { AppHeader } from "@/components/AppHeader";
import { EmptyState, ErrorState, Loading } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { formatRelative } from "@/lib/format";
import {
  registerForPushNotifications,
  type PushRegistrationResult,
} from "@/lib/push";
import { registerWebPush } from "@/lib/pwa";

type PushScreenStatus = PushRegistrationResult | "checking";

export default function NotificationsScreen() {
  const colors = useColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pushStatus, setPushStatus] =
    React.useState<PushScreenStatus>("checking");
  const [pushBusy, setPushBusy] = React.useState(false);
  const { data, isLoading, isError, refetch, isRefetching } =
    useListNotifications();

  const registerThisDevice = React.useCallback(
    (requestPermission = false) =>
      Platform.OS === "web"
        ? registerWebPush(requestPermission)
        : registerForPushNotifications(requestPermission),
    [],
  );

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() });

  const markOne = useMarkNotificationRead({
    mutation: { onSuccess: invalidate },
  });
  const markAll = useMarkAllNotificationsRead({
    mutation: { onSuccess: invalidate },
  });

  useFocusEffect(
    React.useCallback(() => {
      void refetch();
      let active = true;
      void registerThisDevice().then((status) => {
        if (active) setPushStatus(status);
      });
      return () => {
        active = false;
      };
    }, [refetch, registerThisDevice]),
  );

  const enablePush = async () => {
    if (pushStatus === "permission-blocked") {
      if (Platform.OS !== "web") {
        try {
          await Linking.openSettings();
        } catch {
          // The status text still explains how to enable notifications.
        }
      }
      return;
    }
    setPushBusy(true);
    try {
      setPushStatus(await registerThisDevice(true));
    } finally {
      setPushBusy(false);
    }
  };

  const pushMessage = {
    checking: "Comprobando el registro de este dispositivo…",
    registered: "Este dispositivo está preparado para recibir avisos.",
    "permission-required":
      "Activa los avisos para recibir mensajes, comunicados, encuestas y reuniones aunque la app esté cerrada.",
    "permission-blocked":
      Platform.OS === "web"
        ? "Permite las notificaciones para este sitio desde los ajustes del navegador y vuelve a intentarlo."
        : "El permiso está desactivado. Actívalo en los ajustes de la aplicación.",
    unsupported:
      "Las notificaciones push no están disponibles en este dispositivo o navegador.",
    failed:
      "No se pudo registrar este dispositivo. Comprueba la conexión y vuelve a intentarlo.",
  }[pushStatus];

  const pushActionLabel =
    pushStatus === "permission-blocked" && Platform.OS !== "web"
      ? "Abrir ajustes"
      : pushStatus === "permission-required"
        ? "Activar notificaciones"
        : "Reintentar";
  const showPushAction =
    pushStatus !== "checking" &&
    pushStatus !== "registered" &&
    pushStatus !== "unsupported" &&
    !(pushStatus === "permission-blocked" && Platform.OS === "web");

  const bottomPad = Platform.OS === "web" ? 100 : 90;
  const unread = (data ?? []).filter((n) => !n.readAt).length;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader
        title="Avisos"
        subtitle={unread > 0 ? `${unread} sin leer` : "Al día"}
        right={
          unread > 0 ? (
            <Pressable
              onPress={() => markAll.mutate()}
              hitSlop={12}
              style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
            >
              <Feather name="check-circle" size={22} color="#ffffff" />
            </Pressable>
          ) : null
        }
      />
      {isLoading ? (
        <Loading />
      ) : isError ? (
        <ErrorState onRetry={refetch} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(item: Notification) => String(item.id)}
          contentContainerStyle={{ paddingBottom: bottomPad, flexGrow: 1 }}
          onRefresh={refetch}
          refreshing={isRefetching}
          scrollEnabled={!!data && data.length > 0}
          ListHeaderComponent={
            <View
              style={[
                styles.pushCard,
                {
                  borderColor: colors.border,
                  backgroundColor: colors.accent,
                },
              ]}
            >
              <Feather
                name="bell"
                size={20}
                color={
                  pushStatus === "registered"
                    ? colors.primary
                    : colors.mutedForeground
                }
                style={styles.pushIcon}
              />
              <View style={styles.pushContent}>
                <Text style={[styles.pushTitle, { color: colors.foreground }]}>
                  Avisos en este dispositivo
                </Text>
                <Text style={[styles.pushText, { color: colors.mutedForeground }]}>
                  {pushMessage}
                </Text>
                {showPushAction ? (
                  <Pressable
                    onPress={() => void enablePush()}
                    disabled={pushBusy}
                    style={({ pressed }) => [
                      styles.pushAction,
                      { opacity: pressed || pushBusy ? 0.55 : 1 },
                    ]}
                  >
                    {pushBusy ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : (
                      <Feather
                        name={
                          pushStatus === "permission-blocked"
                            ? "settings"
                            : "bell"
                        }
                        size={15}
                        color={colors.primary}
                      />
                    )}
                    <Text style={[styles.pushActionText, { color: colors.primary }]}>
                      {pushBusy ? "Activando…" : pushActionLabel}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              icon="bell"
              title="Sin avisos"
              message="Aquí verás notificaciones de mensajes, alertas de empresa y comunicados."
            />
          }
          renderItem={({ item }) => {
            const isUnread = !item.readAt;
            return (
              <Pressable
                onPress={() => {
                  if (isUnread) markOne.mutate({ id: item.id });
                  switch (item.type) {
                    case "message":
                      router.push("/(tabs)/chat");
                      break;
                    case "survey":
                      router.push("/surveys");
                      break;
                    case "document_form":
                      router.push("/forms");
                      break;
                    case "meeting":
                      router.push("/videoconferencias");
                      break;
                    case "company_alert":
                      router.push("/alerts");
                      break;
                    case "forum_thread":
                    case "forum_reply":
                      router.push("/foros");
                      break;
                    case "year_confirmation":
                      router.push("/confirmar-curso");
                      break;
                    case "event":
                    case "calendar":
                      router.push("/(tabs)");
                      break;
                  }
                }}
                style={({ pressed }) => [
                  styles.row,
                  {
                    borderBottomColor: colors.border,
                    backgroundColor: isUnread ? colors.accent : "transparent",
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <View
                  style={[
                    styles.dot,
                    { backgroundColor: isUnread ? colors.primary : "transparent" },
                  ]}
                />
                <View style={styles.body}>
                  <Text style={[styles.title, { color: colors.foreground }]}>
                    {item.title}
                  </Text>
                  {item.body ? (
                    <Text style={[styles.text, { color: colors.mutedForeground }]}>
                      {item.body}
                    </Text>
                  ) : null}
                  <Text style={[styles.time, { color: colors.mutedForeground }]}>
                    {formatRelative(item.createdAt)}
                  </Text>
                </View>
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
  pushCard: {
    flexDirection: "row",
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 8,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    gap: 12,
  },
  pushIcon: { marginTop: 2 },
  pushContent: { flex: 1, gap: 6 },
  pushTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  pushText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  pushAction: {
    alignSelf: "flex-start",
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingVertical: 6,
    paddingRight: 8,
  },
  pushActionText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  row: {
    flexDirection: "row",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  body: { flex: 1, gap: 4 },
  title: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  text: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  time: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
});
