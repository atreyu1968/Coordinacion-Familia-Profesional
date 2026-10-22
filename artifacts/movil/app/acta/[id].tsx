import React from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";

import {
  getGetEventMinutesQueryKey,
  getGetEventQueryKey,
  useGetEvent,
  useGetEventMinutes,
} from "@workspace/api-client-react";
import { AppHeader } from "@/components/AppHeader";
import { ErrorState } from "@/components/ui";
import { useColors } from "@/hooks/useColors";

// Read-only view of a published coordination-meeting acta. Text is rendered as
// plain Text nodes (light markdown cues only), never as HTML.
export default function ActaScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const eventId = Number(id);
  const valid = Number.isInteger(eventId) && eventId > 0;
  const event = useGetEvent(eventId, {
    query: { queryKey: getGetEventQueryKey(eventId), enabled: valid, retry: false },
  });
  const minutes = useGetEventMinutes(eventId, {
    query: {
      queryKey: getGetEventMinutesQueryKey(eventId),
      enabled: valid && event.data?.type === "coordination_meeting",
      retry: false,
    },
  });
  const notMeeting = !!event.data && event.data.type !== "coordination_meeting";

  const m = minutes.data;
  const published = m && m.enabled && m.publishedText ? m.publishedText : null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader title="Acta" subtitle={event.data?.name ?? "Reunión de coordinación"} showBack />
      {!valid ? (
        <View style={styles.center}>
          <Text style={{ color: colors.destructive }}>Enlace de acta no válido.</Text>
        </View>
      ) : event.error ? (
        <ErrorState onRetry={event.refetch} />
      ) : notMeeting ? (
        <View style={styles.center}>
          <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
            Este evento no es una reunión de coordinación y no tiene acta.
          </Text>
        </View>
      ) : event.isLoading || minutes.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : minutes.error ? (
        <ErrorState onRetry={minutes.refetch} />
      ) : !published ? (
        <View style={styles.center}>
          <Feather name="file-text" size={28} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No hay acta publicada</Text>
          <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
            Aparecerá aquí cuando la coordinación publique el acta final.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.bar, { backgroundColor: colors.primary }]} />
            <Text style={[styles.kicker, { color: colors.primary }]}>ACTA FINAL</Text>
            {m?.publishedAt ? (
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                Publicada el{" "}
                {new Date(m.publishedAt).toLocaleString("es-ES", { dateStyle: "long", timeStyle: "short" })}
              </Text>
            ) : null}
            <View style={styles.body}>
              {published.replace(/\r\n/g, "\n").split("\n").map((raw, i) => {
                const line = raw.trimEnd();
                const h = line.match(/^(#{1,3})\s+(.*)$/);
                const b = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/);
                if (!line.trim()) return <View key={i} style={{ height: 8 }} />;
                if (h)
                  return (
                    <Text key={i} accessibilityRole="header" style={[h[1].length === 1 ? styles.h1 : styles.h2, { color: colors.foreground }]}>
                      {h[2]}
                    </Text>
                  );
                if (b)
                  return (
                    <Text key={i} style={[styles.p, { color: colors.foreground }]}>
                      {"\u2022  "}
                      {b[1].replace(/\*\*/g, "")}
                    </Text>
                  );
                return (
                  <Text key={i} style={[styles.p, { color: colors.foreground }]}>
                    {line.replace(/\*\*/g, "")}
                  </Text>
                );
              })}
            </View>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 8 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", marginTop: 6 },
  emptyBody: { fontSize: 14, textAlign: "center", fontFamily: "Inter_400Regular" },
  scroll: { padding: 16, paddingBottom: 48 },
  sheet: { borderWidth: 1, borderRadius: 14, padding: 18, overflow: "hidden" },
  bar: { position: "absolute", top: 0, left: 0, right: 0, height: 4 },
  kicker: { fontSize: 11, letterSpacing: 2, fontFamily: "Inter_600SemiBold", marginTop: 4 },
  meta: { fontSize: 12, marginTop: 4, fontFamily: "Inter_400Regular" },
  body: { marginTop: 14 },
  h1: { fontSize: 20, lineHeight: 26, fontFamily: "Inter_700Bold", marginTop: 10, marginBottom: 4 },
  h2: { fontSize: 16, lineHeight: 22, fontFamily: "Inter_600SemiBold", marginTop: 8, marginBottom: 2 },
  p: { fontSize: 15, lineHeight: 22, fontFamily: "Inter_400Regular" },
});
