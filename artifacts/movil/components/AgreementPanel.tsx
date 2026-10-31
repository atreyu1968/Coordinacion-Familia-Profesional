import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetForumAgreement,
  getGetForumAgreementQueryKey,
  useRecordAgreementPosition,
} from "@workspace/api-client-react";

import { Button } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { openBrowserLink } from "@/lib/browser-link";
import { webAppUrl } from "@/lib/web-links";
import {
  MOBILE_POSITION_LABELS,
  MOBILE_STATUS_LABELS,
  mobileNotificationWarning,
  mobilePositionPayload,
  mobilePositionsForVersion,
  type MobilePosition,
} from "@/lib/agreement";

const OPTIONS: MobilePosition[] = ["a_favor", "con_reservas", "en_contra"];

function errorText(err: unknown): string {
  const e = err as { status?: number; data?: { message?: string; error?: string } | null };
  if (e?.status === 409) return "El acuerdo ha cambiado. Hemos recargado; revisa y vuelve a enviar.";
  if (e?.status === 403) return "No tienes permiso para esta acción.";
  return e?.data?.message ?? e?.data?.error ?? "No se pudo registrar tu posición.";
}

export function AgreementPanel({ threadId, moduleId }: { threadId: number; moduleId: number }) {
  const colors = useColors();
  const qc = useQueryClient();
  const { user } = useAuth();
  const q = useGetForumAgreement(threadId, {
    query: {
      queryKey: getGetForumAgreementQueryKey(threadId),
      enabled: threadId > 0,
      retry: false,
      staleTime: 15_000,
      refetchInterval: 60_000,
    },
  });
  const mut = useRecordAgreementPosition();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MobilePosition | null>(null);
  const [reason, setReason] = useState("");
  const [centerId, setCenterId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  const ws = q.data;
  const a = ws?.agreement ?? null;
  const me = ws && user ? ws.participants.find((p) => p.id === user.id) : undefined;
  const current = ws ? mobilePositionsForVersion(ws) : [];
  const mine = current.find((p) => p.userId === user?.id);
  const counts = { a_favor: 0, con_reservas: 0, en_contra: 0 };
  current.forEach((p) => (counts[p.position] += 1));
  const objections = current.filter((p) => p.position !== "a_favor");
  const effectiveCenter = centerId ?? mine?.centerId ?? (me?.centers.length === 1 ? me.centers[0].id : null);

  const openWeb = (path: string) => {
    const url = webAppUrl(path);
    setLinkError(null);
    if (!url) return setLinkError("No se pudo construir el enlace web.");
    void openBrowserLink(url).catch(() => setLinkError("No se pudo abrir el enlace."));
  };

  const submit = async () => {
    if (!ws) return;
    setError(null);
    setNotice(null);
    const check = mobilePositionPayload(ws, user?.id, { position: position ?? mine?.position ?? null, reason, centerId: effectiveCenter });
    if (!check.ok) return setError(check.error);
    try {
      const res = await mut.mutateAsync({ threadId, data: check.payload });
      const warn = mobileNotificationWarning(res);
      setNotice(warn ? `Posición registrada, pero: ${warn}` : "Posición registrada.");
      setReason("");
      setPosition(null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      await qc.invalidateQueries({ queryKey: getGetForumAgreementQueryKey(threadId) });
    }
  };

  const text = (s: object) => [s, { color: colors.foreground }];
  const muted = (s: object) => [s, { color: colors.mutedForeground }];

  return (
    <View style={[styles.box, { borderBottomColor: colors.border, backgroundColor: colors.card }]} testID="panel-agreement">
      <Pressable style={styles.head} onPress={() => setOpen((v) => !v)} accessibilityRole="button" testID="toggle-agreement">
        <Feather name="clipboard" size={14} color={colors.primary} />
        <Text style={text(styles.title)} numberOfLines={1}>
          Acuerdo intercentros
          {a ? ` · v${a.version} · ${MOBILE_STATUS_LABELS[a.status] ?? a.status}` : q.isLoading ? "" : " · sin síntesis"}
        </Text>
        <Feather name={open ? "chevron-up" : "chevron-down"} size={16} color={colors.mutedForeground} />
      </Pressable>
      {open ? (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
          {q.isLoading ? (
            <Text style={muted(styles.meta)}>Cargando acuerdo...</Text>
          ) : q.isError || !ws ? (
            <Pressable onPress={() => void q.refetch()} testID="button-retry-agreement">
              <Text style={[styles.meta, { color: colors.destructive }]}>No se pudo cargar. Toca para reintentar.</Text>
            </Pressable>
          ) : (
            <>
              <Text style={muted(styles.meta)}>
                Referencia no oficial · {ws.participation.teachers} docentes · {ws.participation.centers} centros · censo al abrir consulta {ws.participation.eligible}
              </Text>
              {ws.participation.limited ? (
                <Text style={[styles.meta, { color: colors.destructive }]}>{ws.participation.warning || "Participación limitada."}</Text>
              ) : null}
              {!a ? (
                <Text style={muted(styles.meta)}>Aún no hay síntesis. Sigue el debate en el hilo.</Text>
              ) : (
                <>
                  {a.summary ? <Text style={text(styles.summary)}>{a.summary}</Text> : null}
                  {a.proposedText.trim() ? (
                    <Text style={text(styles.proposal)} numberOfLines={8}>{a.proposedText}</Text>
                  ) : null}
                  {a.closureReason ? <Text style={muted(styles.meta)}>Motivo de cierre: {a.closureReason}</Text> : null}
                  <Text style={text(styles.meta)}>
                    {OPTIONS.map((o) => `${MOBILE_POSITION_LABELS[o]}: ${counts[o]}`).join(" · ")} (sin mayoría automática)
                  </Text>
                  {objections.map((p) => (
                    <Text key={p.id} style={muted(styles.meta)} testID={`row-objection-${p.id}`}>
                      {p.userName ?? "Docente"} · {p.centerName} · {MOBILE_POSITION_LABELS[p.position]}
                      {p.reason ? `: ${p.reason}` : ""}
                    </Text>
                  ))}
                  {a.status === "consulta" && !ws.canPosition ? (
                    <Text style={muted(styles.meta)}>No figuras en el censo fijado al abrir la consulta. Puedes debatir en el hilo.</Text>
                  ) : null}
                  {a.documentUrl ? (
                    <Pressable onPress={() => { setLinkError(null); void openBrowserLink(a.documentUrl!).catch(() => setLinkError("No se pudo abrir el documento.")); }} accessibilityRole="link" testID="link-agreement-document">
                      <Text style={[styles.link, { color: colors.primary }]}>Documento colaborativo (Nextcloud)</Text>
                    </Pressable>
                  ) : null}
                  {a.publishedPageId != null ? (
                    <Pressable onPress={() => openWeb(`/documentacion?page=${a.publishedPageId}`)} accessibilityRole="link" testID="link-agreement-published">
                      <Text style={[styles.link, { color: colors.primary }]}>Ver versión publicada en Documentación (web)</Text>
                    </Pressable>
                  ) : null}

                  {a.status === "consulta" && ws.canPosition && me ? (
                    <View style={[styles.form, { borderColor: colors.border }]} testID="form-agreement-position">
                      <Text style={text(styles.formTitle)}>
                        {mine ? `Tu posición: ${MOBILE_POSITION_LABELS[mine.position]}. Puedes cambiarla.` : "Tu posición"}
                      </Text>
                      <View style={styles.row}>
                        {OPTIONS.map((o) => {
                          const sel = (position ?? mine?.position) === o;
                          return (
                            <Pressable
                              key={o}
                              onPress={() => setPosition(o)}
                              accessibilityRole="radio"
                              accessibilityState={{ checked: sel }}
                              style={[styles.chip, { borderColor: sel ? colors.primary : colors.border, backgroundColor: sel ? colors.primary : "transparent" }]}
                              testID={`radio-position-${o}`}
                            >
                              <Text style={[styles.chipText, { color: sel ? colors.primaryForeground : colors.foreground }]}>{MOBILE_POSITION_LABELS[o]}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                      {me.centers.length > 1 ? (
                        <View style={styles.row}>
                          {me.centers.map((c) => {
                            const sel = effectiveCenter === c.id;
                            return (
                              <Pressable key={c.id} onPress={() => setCenterId(c.id)} style={[styles.chip, { borderColor: sel ? colors.primary : colors.border }]} testID={`radio-center-${c.id}`}>
                                <Text style={[styles.chipText, { color: sel ? colors.primary : colors.foreground }]} numberOfLines={1}>{c.name}</Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      ) : (
                        <Text style={muted(styles.meta)}>Centro: {me.centers[0]?.name ?? "sin centro"}</Text>
                      )}
                      <TextInput
                        value={reason}
                        onChangeText={setReason}
                        multiline
                        placeholder={(position ?? mine?.position) && (position ?? mine?.position) !== "a_favor" ? "Motivo obligatorio" : "Motivo o enmienda (opcional)"}
                        placeholderTextColor={colors.mutedForeground}
                        style={[styles.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.background }]}
                        testID="input-position-reason"
                      />
                      {error ? <Text style={[styles.meta, { color: colors.destructive }]}>{error}</Text> : null}
                      {notice ? <Text style={muted(styles.meta)}>{notice}</Text> : null}
                      <Button label={mine ? "Actualizar posición" : "Registrar posición"} onPress={() => void submit()} loading={mut.isPending} testID="button-submit-position" />
                    </View>
                  ) : null}
                </>
              )}
              {ws.canEdit || ws.canPublish ? (
                <Pressable onPress={() => openWeb(`/foros?module=${moduleId}&thread=${threadId}`)} accessibilityRole="link" testID="link-agreement-manage-web">
                  <Text style={[styles.link, { color: colors.primary }]}>Gestionar síntesis y publicación (web)</Text>
                </Pressable>
              ) : null}
              {linkError ? <Text style={[styles.meta, { color: colors.destructive }]}>{linkError}</Text> : null}
            </>
          )}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, gap: 6 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, fontSize: 13, fontFamily: "Inter_600SemiBold" },
  scroll: { maxHeight: 380 },
  body: { gap: 8, paddingTop: 4 },
  meta: { fontSize: 11, fontFamily: "Inter_400Regular" },
  summary: { fontSize: 13, fontFamily: "Inter_500Medium" },
  proposal: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  link: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  form: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 10, gap: 8 },
  formTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5, maxWidth: "100%" },
  chipText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, padding: 8, minHeight: 60, fontSize: 14, textAlignVertical: "top" },
});
