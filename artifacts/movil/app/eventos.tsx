import React from "react";
import { FlatList, Platform, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { useListEvents, useListCalendarEvents } from "@workspace/api-client-react";
import { useNoticeId, useNoticeItems } from "@/lib/notification-selection";
import { AppHeader } from "@/components/AppHeader";
import { AutoLinkText } from "@/components/AutoLinkText";
import { Card, EmptyState, ErrorState, Loading } from "@/components/ui";
import { useColors } from "@/hooks/useColors";

export default function EventsScreen() {
  const colors = useColors();
  const { data, isLoading, isError, refetch, isRefetching } = useListEvents();
  const items = useNoticeItems(data ?? []);
  const calendarId = useNoticeId("calendario");
  const calendar = useListCalendarEvents(undefined, { query: { enabled: calendarId != null } });
  useFocusEffect(React.useCallback(() => { void refetch(); }, [refetch]));
  if (calendarId != null) return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <AppHeader title="Entrada del calendario" showBack />
      {calendar.isLoading ? <Loading /> : calendar.isError ? <ErrorState onRetry={calendar.refetch} /> :
        <FlatList data={(calendar.data ?? []).filter((entry) => entry.id === calendarId)}
          keyExtractor={(entry) => String(entry.id)}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          ListEmptyComponent={<EmptyState icon="calendar" title="Entrada no disponible" message="Se ha eliminado o ya no tienes acceso." />}
          renderItem={({ item }) => <Card style={styles.card}>
            <Text style={[styles.title, { color: colors.foreground }]}>{item.title}</Text>
            <Text style={{ color: colors.foreground }}>{new Date(item.date).toLocaleString("es-ES")}</Text>
            {item.description ? <Text style={{ color: colors.foreground }}><AutoLinkText text={item.description} /></Text> : null}
          </Card>} />}
    </View>
  );
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <AppHeader title="Eventos" subtitle="Actividades y reuniones de la red" showBack />
      {isLoading ? <Loading /> : isError ? <ErrorState onRetry={refetch} /> : (
        <FlatList
          data={items}
          keyExtractor={(event) => String(event.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: Platform.OS === "web" ? 100 : 40, gap: 12, flexGrow: 1 }}
          onRefresh={refetch}
          refreshing={isRefetching}
          ListEmptyComponent={<EmptyState icon="calendar" title="Sin eventos" message="No hay eventos disponibles en tu ámbito." />}
          renderItem={({ item }) => (
            <Card style={styles.card}>
              <Text style={[styles.title, { color: colors.foreground }]}>{item.name}</Text>
              <Text style={{ color: colors.mutedForeground }}>
                {item.type === "coordination_meeting" ? "Reunión de coordinación" : item.type === "jornada" ? "Jornada" : item.type === "canarias_skills" ? "Canarias Skills" : "Evento"}
                {item.status ? ` · ${item.status === "cancelled" ? "Cancelado" : item.status === "completed" ? "Finalizado" : "Programado"}` : ""}
              </Text>
              {item.startAt ? <Text style={{ color: colors.foreground }}>{new Date(item.startAt).toLocaleString("es-ES")}</Text> : null}
              {item.location ? <Text style={{ color: colors.mutedForeground }}>{item.location}</Text> : null}
              {item.description ? <Text style={{ color: colors.foreground }}><AutoLinkText text={item.description} /></Text> : null}
            </Card>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, gap: 8 },
  title: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
});
