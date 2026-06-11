import React from "react";
import { FlatList, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";

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

export default function NotificationsScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch, isRefetching } =
    useListNotifications();

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
    }, [refetch]),
  );

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
