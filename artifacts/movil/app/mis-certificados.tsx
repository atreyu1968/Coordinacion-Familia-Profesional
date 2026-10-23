import React, { useEffect, useRef, useState } from "react";
import { Alert, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";

import {
  downloadMyAttendanceCertificate,
  getListMyAttendanceCertificatesQueryKey,
  useListMyAttendanceCertificates,
  useSendAttendanceEmailCode,
  useVerifyAttendanceEmail,
  useIssueMyAttendanceCertificate,
  type OwnAttendancePendingEvent,
  type MyAttendanceCertificate,
} from "@workspace/api-client-react";

import { AppHeader } from "@/components/AppHeader";
import { Button, Card, EmptyState, ErrorState, Loading } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { PdfPreviewButton } from "@/components/PdfPreviewButton";


function errMsg(err: unknown, fallback: string): string {
  const m = (err as { data?: { message?: unknown } } | null)?.data?.message;
  return typeof m === "string" && m.trim() ? m : fallback;
}

function fmtDate(v?: string | null) {
  return v ? new Date(v).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" }) : "—";
}

async function savePdf(filename: string, base64: string) {
  if (Platform.OS === "web") {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  const FileSystem = await import("expo-file-system/legacy");
  const Sharing = await import("expo-sharing");
  const safeName = filename.replace(/[^A-Za-z0-9._-]/g, "_");
  const uri = `${FileSystem.cacheDirectory ?? ""}${safeName}`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: "Guardar certificado" });
  } else {
    Alert.alert("Certificado guardado", "El PDF se ha guardado en el almacenamiento de la app.");
  }
}

async function previewPdf(filename: string, base64: string) {
  const safeName = filename.replace(/[^A-Za-z0-9._-]/g, "_");
  let uri: string;
  if (Platform.OS === "web") {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    uri = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  } else {
    const FileSystem = await import("expo-file-system/legacy");
    const directory = FileSystem.cacheDirectory;
    if (!directory) throw new Error("No hay una carpeta temporal disponible.");
    uri = `${directory}preview-${Date.now()}-${safeName}`;
    await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  }
  router.push({ pathname: "/pdf-viewer", params: { uri, title: filename } });
}

function Verify({ email }: { email: string }) {
  const colors = useColors();
  const qc = useQueryClient();
  const sendMut = useSendAttendanceEmailCode();
  const verifyMut = useVerifyAttendanceEmail();
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onSend = () => {
    setError(null);
    sendMut.mutate(undefined, {
      onSuccess: () => setSent(true),
      onError: (e) => setError(errMsg(e, "No se pudo enviar el código.")),
    });
  };
  const autoSent = useRef(false);
  useEffect(() => {
    if (autoSent.current) return;
    autoSent.current = true;
    onSend();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onVerify = () => {
    setError(null);
    if (!/^\d{6}$/.test(code)) {
      setError("Introduce los 6 dígitos.");
      return;
    }
    verifyMut.mutate(
      { data: { code } },
      {
        onSuccess: () => void qc.invalidateQueries({ queryKey: getListMyAttendanceCertificatesQueryKey() }),
        onError: (e) => setError(errMsg(e, "Código incorrecto o caducado.")),
      },
    );
  };

  return (
    <Card style={{ gap: 12 }}>
      <Feather name="mail" size={26} color={colors.primary} />
      <Text style={[styles.title, { color: colors.foreground }]}>Verifica tu correo</Text>
      <Text style={[styles.body, { color: colors.mutedForeground }]}>
        Por privacidad hemos enviado un código de 6 dígitos a {email}, el correo de tu cuenta, antes de mostrar tus certificados.
      </Text>
      {sent ? (
        <>
          <TextInput
            value={code}
            onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
            keyboardType="number-pad"
            maxLength={6}
            placeholder="000000"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.otp, { borderColor: colors.border, color: colors.foreground, borderRadius: colors.radius, backgroundColor: colors.card }]}
            accessibilityLabel="Código de verificación"
            testID="input-otp"
          />
          <Button label="Verificar" onPress={onVerify} loading={verifyMut.isPending} />
          <Button label="Reenviar código" variant="ghost" onPress={onSend} loading={sendMut.isPending} />
        </>
      ) : sendMut.isPending ? (
        <Text style={[styles.body, { color: colors.mutedForeground }]}>Enviando el código a tu correo…</Text>
      ) : (
        <Button label="Volver a enviar el código" icon="send" onPress={onSend} />
      )}
      {error ? <Text style={[styles.body, { color: colors.destructive }]}>{error}</Text> : null}
    </Card>
  );
}

function CertCard({ c }: { c: MyAttendanceCertificate }) {
  const colors = useColors();
  const [busy, setBusy] = useState(false);
  const revoked = Boolean(c.revokedAt);
  const onDownload = async () => {
    setBusy(true);
    try {
      const pdf = await downloadMyAttendanceCertificate(c.id);
      await savePdf(pdf.filename, pdf.contentBase64);
    } catch (e) {
      Alert.alert("No se pudo descargar", errMsg(e, "Inténtalo de nuevo."));
    } finally {
      setBusy(false);
    }
  };
  const onPreview = async () => {
    setBusy(true);
    try {
      const pdf = await downloadMyAttendanceCertificate(c.id);
      await previewPdf(pdf.filename, pdf.contentBase64);
    } catch (e) {
      Alert.alert("No se pudo abrir el PDF", errMsg(e, "Inténtalo de nuevo."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card style={{ gap: 6, borderLeftWidth: 4, borderLeftColor: revoked ? colors.destructive : colors.primary }}>
      <Text style={[styles.title, { color: colors.foreground, fontSize: 16 }]}>{c.eventName}</Text>
      <Text style={[styles.body, { color: colors.mutedForeground }]}>
        A nombre de {c.attendeeName} · {fmtDate(c.issuedAt)}
      </Text>
      {revoked ? (
        <Text style={[styles.body, { color: colors.destructive, fontFamily: "Inter_600SemiBold" }]}>
          Revocado el {fmtDate(c.revokedAt)}. Ya no es válido.
        </Text>
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Button label="Guardar o compartir PDF" icon="download" variant="secondary" onPress={() => void onDownload()} loading={busy} />
          <PdfPreviewButton
            title={c.eventName}
            color={colors.primary}
            onPress={() => void onPreview()}
          />
        </View>
      )}
    </Card>
  );
}

function PendingCard({ p }: { p: OwnAttendancePendingEvent }) {
  const colors = useColors();
  const qc = useQueryClient();
  const issueMut = useIssueMyAttendanceCertificate();
  const [busy, setBusy] = useState(false);
  const onIssue = async () => {
    setBusy(true);
    try {
      const pdf = await issueMut.mutateAsync({ data: { eventId: p.eventId } });
      await qc.invalidateQueries({ queryKey: getListMyAttendanceCertificatesQueryKey() });
      await savePdf(pdf.filename, pdf.contentBase64);
    } catch (e) {
      Alert.alert(
        "No se pudo emitir el certificado",
        errMsg(e, "Solo puede emitirse cuando el evento ha terminado y tu asistencia está validada."),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card style={{ gap: 8, borderLeftWidth: 4, borderLeftColor: colors.primary }}>
      <Text style={[styles.title, { color: colors.foreground, fontSize: 16 }]}>{p.eventName}</Text>
      <Text style={[styles.body, { color: colors.mutedForeground }]}>Asistencia validada. Puedes emitir tu certificado.</Text>
      <Button label="Emitir y guardar PDF" icon="award" onPress={() => void onIssue()} loading={busy} />
    </Card>
  );
}

export default function MisCertificadosScreen() {
  const colors = useColors();
  const { user } = useAuth();
  const q = useListMyAttendanceCertificates({
    query: {
      queryKey: [...getListMyAttendanceCertificatesQueryKey(), user?.id, user?.email],
      enabled: !!user,
      retry: false,
    },
  });
  const pending = q.data?.pendingEvents ?? [];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader title="Mis certificados" subtitle="Asistencia a eventos" showBack />
      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: Platform.OS === "web" ? 100 : 40 }]} keyboardShouldPersistTaps="handled">
          {!q.data?.emailVerified ? (
            <Verify email={user?.email ?? "tu correo"} />
          ) : (
            <>
              {pending.map((p) => <PendingCard key={p.eventId} p={p} />)}
              {q.data.items.length === 0 && pending.length === 0 ? (
                <EmptyState icon="award" title="Aún no tienes certificados" message="Escanea el QR de asistencia en un evento. Cuando la organización valide tu asistencia aparecerá aquí." />
              ) : (
                q.data.items.map((c) => <CertCard key={c.id} c={c} />)
              )}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 12 },
  title: { fontSize: 18, fontFamily: "Inter_700Bold" },
  body: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  otp: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
    fontSize: 26,
    letterSpacing: 10,
    textAlign: "center",
    fontFamily: "Inter_600SemiBold",
  },
});
