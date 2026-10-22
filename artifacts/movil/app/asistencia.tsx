import React from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";

import {
  getGetAttendanceRegistrationQueryKey,
  useGetAttendanceRegistration,
  useRegisterEventAttendance,
} from "@workspace/api-client-react";

import { AppHeader } from "@/components/AppHeader";
import { Button, Card, ErrorState, Loading } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

function errMsg(err: unknown, fallback: string): string {
  const m = (err as { data?: { message?: unknown } } | null)?.data?.message;
  return typeof m === "string" && m.trim() ? m : fallback;
}

export default function AsistenciaScreen() {
  const colors = useColors();
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ token?: string }>();
  const token = typeof params.token === "string" ? params.token : "";
  const q = useGetAttendanceRegistration(token, {
    query: { queryKey: getGetAttendanceRegistrationQueryKey(token), enabled: !!token, retry: false },
  });
  const reg = useRegisterEventAttendance();
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);

  const onRegister = () => {
    setMsg(null);
    reg.mutate(
      { token },
      {
        onSuccess: () => {
          setMsg({ ok: true, text: "Asistencia registrada. Queda pendiente de validación por la organización." });
          void qc.invalidateQueries({ queryKey: getGetAttendanceRegistrationQueryKey(token) });
        },
        onError: (e) => setMsg({ ok: false, text: errMsg(e, "No se pudo registrar tu asistencia.") }),
      },
    );
  };

  const ev = q.data;
  const status = ev?.attendanceStatus;
  const when = ev?.startAt
    ? new Date(ev.startAt).toLocaleString("es-ES", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader title="Registro de asistencia" showBack />
      {!token ? (
        <ErrorState />
      ) : q.isLoading ? (
        <Loading />
      ) : q.isError || !ev ? (
        <View style={styles.content}>
          <Card style={{ gap: 10 }}>
            <Text style={[styles.title, { color: colors.foreground }]}>No se pudo abrir el evento</Text>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>{errMsg(q.error, "Enlace no válido o caducado.")}</Text>
            <Button label="Reintentar" onPress={() => void q.refetch()} />
          </Card>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: Platform.OS === "web" ? 100 : 40 }]}>
          <Card style={{ gap: 10 }}>
            <Text style={[styles.title, { color: colors.foreground }]}>{ev.eventName}</Text>
            {when ? (
              <View style={styles.row}><Feather name="calendar" size={16} color={colors.primary} /><Text style={[styles.body, { color: colors.foreground }]}>{when}</Text></View>
            ) : null}
            {ev.location ? (
              <View style={styles.row}><Feather name="map-pin" size={16} color={colors.primary} /><Text style={[styles.body, { color: colors.foreground, flex: 1 }]}>{ev.location}</Text></View>
            ) : null}
          </Card>

          {status === "confirmed" ? (
            <Card style={{ gap: 10 }}>
              <Text style={[styles.body, { color: colors.success }]}>Tu asistencia está validada.</Text>
              <Button label="Ver mis certificados" icon="award" onPress={() => router.replace("/mis-certificados")} />
            </Card>
          ) : status === "pending" ? (
            <Card><Text style={[styles.body, { color: colors.foreground }]}>Registro recibido. La organización debe validar tu asistencia antes de expedir el certificado.</Text></Card>
          ) : status === "rejected" ? (
            <Card><Text style={[styles.body, { color: colors.destructive }]}>La organización no ha validado tu asistencia a este evento.</Text></Card>
          ) : !ev.open ? (
            <Card><Text style={[styles.body, { color: colors.mutedForeground }]}>El registro de asistencia de este evento está cerrado.</Text></Card>
          ) : (
            <Card style={{ gap: 12 }}>
              <Text style={[styles.body, { color: colors.mutedForeground }]}>
                Se registrará a nombre de {user?.name} ({user?.email}), los datos de tu cuenta.
              </Text>
              <Button label="Registrar mi asistencia" icon="check" onPress={onRegister} loading={reg.isPending} />
            </Card>
          )}
          {msg ? <Text style={[styles.body, { color: msg.ok ? colors.success : colors.destructive }]}>{msg.text}</Text> : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 12 },
  title: { fontSize: 20, fontFamily: "Inter_700Bold" },
  body: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
});
