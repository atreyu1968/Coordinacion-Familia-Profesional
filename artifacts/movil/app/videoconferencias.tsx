import React, { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";

import {
  useGetMeetingToken,
  useListMeetings,
  type Meeting,
} from "@workspace/api-client-react";

import { AppHeader } from "@/components/AppHeader";
import { Card, EmptyState, ErrorState, Loading } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { formatDateTime } from "@/lib/format";

export default function VideoconferenciasScreen() {
  const colors = useColors();
  const { data, isLoading, isError, refetch, isRefetching } = useListMeetings();
  const tokenMut = useGetMeetingToken();
  const [joiningId, setJoiningId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onJoin = async (meeting: Meeting) => {
    setError(null);
    setJoiningId(meeting.id);
    try {
      const access = await tokenMut.mutateAsync({
        data: { room: meeting.roomName, audioOnly: false },
      });
      await WebBrowser.openBrowserAsync(access.url);
    } catch {
      setError("No se pudo abrir la sala. Inténtalo de nuevo.");
    } finally {
      setJoiningId(null);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader
        title="Videoconferencias"
        subtitle="Salas de reunión disponibles"
        showBack
      />
      {isLoading ? (
        <Loading />
      ) : isError ? (
        <ErrorState onRetry={refetch} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(item: Meeting) => String(item.id)}
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
              icon="video"
              title="Sin videoconferencias"
              message="No hay salas de reunión disponibles ahora mismo."
            />
          }
          renderItem={({ item }) => {
            const busy = joiningId === item.id;
            return (
              <Card style={styles.card}>
                <Text style={[styles.title, { color: colors.foreground }]}>
                  {item.title}
                </Text>
                {item.description ? (
                  <Text
                    style={[styles.desc, { color: colors.mutedForeground }]}
                    numberOfLines={2}
                  >
                    {item.description}
                  </Text>
                ) : null}
                <View style={styles.metaRow}>
                  {item.moduleName ? (
                    <View style={styles.meta}>
                      <Feather
                        name="book-open"
                        size={13}
                        color={colors.mutedForeground}
                      />
                      <Text
                        style={[styles.metaText, { color: colors.mutedForeground }]}
                      >
                        {item.moduleName}
                      </Text>
                    </View>
                  ) : null}
                  {item.hostName ? (
                    <View style={styles.meta}>
                      <Feather
                        name="user"
                        size={13}
                        color={colors.mutedForeground}
                      />
                      <Text
                        style={[styles.metaText, { color: colors.mutedForeground }]}
                      >
                        {item.hostName}
                      </Text>
                    </View>
                  ) : null}
                  {item.scheduledAt ? (
                    <View style={styles.meta}>
                      <Feather
                        name="clock"
                        size={13}
                        color={colors.mutedForeground}
                      />
                      <Text
                        style={[styles.metaText, { color: colors.mutedForeground }]}
                      >
                        {formatDateTime(item.scheduledAt)}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Pressable
                  onPress={() => onJoin(item)}
                  disabled={busy}
                  style={({ pressed }) => [
                    styles.joinBtn,
                    {
                      backgroundColor: colors.primary,
                      borderRadius: colors.radius,
                      opacity: pressed || busy ? 0.7 : 1,
                    },
                  ]}
                >
                  <Feather name="video" size={16} color={colors.primaryForeground} />
                  <Text
                    style={[styles.joinText, { color: colors.primaryForeground }]}
                  >
                    {busy ? "Abriendo…" : "Unirse"}
                  </Text>
                </Pressable>
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
  card: { gap: 8 },
  title: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  desc: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  meta: { flexDirection: "row", alignItems: "center", gap: 5 },
  metaText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  joinBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 11,
    marginTop: 4,
  },
  joinText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
