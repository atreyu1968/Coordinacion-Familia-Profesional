import React, { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import {
  useListWikiLinkReviews, getListWikiLinkReviewsQueryKey, type WikiExternalLink,
  useResolveWikiLinkReview,
} from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/contexts/AuthContext";

const labels = {
  unchecked: "Pendiente de comprobación", healthy: "Accesible",
  temporary: "Fallo temporal o pendiente de confirmar", blocked: "Acceso bloqueado",
  redirected: "Redirección: revisar destino", missing: "Desaparición confirmada (3 respuestas 404/410)",
};

export function WikiLinkHealth({ link }: { link: WikiExternalLink }) {
  const colors = useColors();
  const [history, setHistory] = useState(false);
  return <View style={{ gap: 3, marginTop: 5 }}>
    <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{labels[link.checkStatus]}{link.httpStatus ? ` · HTTP ${link.httpStatus}` : ""}</Text>
    <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>Última comprobación: {link.checkedAt ? new Date(link.checkedAt).toLocaleString("es-ES") : "Todavía no comprobado"}</Text>
    <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>Próxima comprobación: {new Date(link.nextCheckAt).toLocaleString("es-ES")}</Text>
    {link.redirectUrl && <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>Destino observado: {link.redirectUrl}</Text>}
    {link.resolvedAt && <Text style={{ color: colors.foreground, fontSize: 12 }}>Revisado manualmente: {new Date(link.resolvedAt).toLocaleString("es-ES")}. El diagnóstico automático no cambia.</Text>}
    {link.reviewHistory.length > 0 && <Pressable accessibilityRole="button" onPress={() => setHistory(!history)}>
      <Text style={{ color: colors.primary }}>Historial de revisiones ({link.reviewHistory.length}) {history ? "−" : "+"}</Text>
    </Pressable>}
    {history && link.reviewHistory.map((review, index) => <View key={index} style={{ borderLeftWidth: 1, borderColor: colors.border, paddingLeft: 8, marginTop: 5 }}>
      <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>{new Date(review.reviewedAt).toLocaleString("es-ES")} · Responsable #{review.reviewedBy} · {review.checkStatus}{review.httpStatus ? ` · HTTP ${review.httpStatus}` : ""}</Text>
      {review.redirectUrl && <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>{review.redirectUrl}</Text>}
      <Text style={{ color: colors.foreground, fontSize: 12 }}>{review.note}</Text>
    </View>)}
  </View>;
}

function ResolutionForm({ link }: { link: WikiExternalLink }) {
  const colors = useColors();
  const [note, setNote] = useState("");
  const client = useQueryClient();
  const mutation = useResolveWikiLinkReview({
    mutation: { onSuccess: () => {
      setNote("");
      void client.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).startsWith("/api/wiki/") });
    } },
  });
  return <View style={{ gap: 8, marginTop: 8 }}>
    <TextInput accessibilityLabel={`Nota de revisión de ${link.title}`} placeholder="Explica qué has revisado y tu decisión"
      placeholderTextColor={colors.mutedForeground} multiline maxLength={2000} value={note} onChangeText={setNote}
      editable={!mutation.isPending} style={{ color: colors.foreground, borderColor: colors.border, borderWidth: 1, borderRadius: 6, padding: 10, minHeight: 70 }} />
    <Pressable accessibilityRole="button" disabled={!note.trim() || mutation.isPending}
      onPress={() => mutation.mutate({ externalLinkId: link.id, data: { note: note.trim(), incidentVersion: link.incidentVersion } })}
      style={{ padding: 10, opacity: !note.trim() || mutation.isPending ? 0.5 : 1 }}>
      <Text style={{ color: colors.primary }}>{mutation.isPending ? "Guardando…" : "Registrar revisión"}</Text>
    </Pressable>
    {mutation.isError && <Text accessibilityRole="alert" style={{ color: colors.foreground, fontSize: 12 }}>No se pudo registrar. Si la incidencia ha cambiado o ya está revisada, actualiza la lista; tu nota se conserva.</Text>}
  </View>;
}

function Reviews() {
  const colors = useColors();
  const [showReviewed, setShowReviewed] = useState(false);
  const query = useListWikiLinkReviews({
    query: { queryKey: getListWikiLinkReviewsQueryKey(), staleTime: 30_000, refetchInterval: 60_000 },
  });
  const pending = (link: WikiExternalLink) => !link.resolvedAt && !["healthy", "unchecked"].includes(link.checkStatus);
  const visible = query.data?.filter((link) => showReviewed ? !pending(link) : pending(link));
  return <View style={{ paddingHorizontal: 20, paddingBottom: 12, gap: 6 }}>
    <Text accessibilityRole="header" style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold" }}>Enlaces de Normativa para revisar{query.data ? ` (${query.data.filter(pending).length})` : ""}</Text>
    <Pressable accessibilityRole="button" onPress={() => setShowReviewed(!showReviewed)} style={{ paddingVertical: 8 }}>
      <Text style={{ color: colors.primary }}>{showReviewed ? "Ver pendientes" : "Ver revisados e historial"}</Text>
    </Pressable>
    <Pressable accessibilityRole="button" onPress={() => void query.refetch()} style={{ paddingVertical: 8 }}>
      <Text style={{ color: colors.primary }}>Actualizar lista</Text>
    </Pressable>
    <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>
      Revisión semanal; ante fallos, reintentos a las 6 y 24 horas. No se cambian enlaces ni contenidos. Un bloqueo no confirma desaparición. Accesibilidad no significa vigencia jurídica.
      Un problema distinto o una recaída tras recuperarse reabre el aviso sin perder las notas.
    </Text>
    {query.isPending && <Text style={{ color: colors.mutedForeground }}>Cargando comprobaciones…</Text>}
    {query.isError && <Pressable accessibilityRole="button" onPress={() => void query.refetch()}><Text style={{ color: colors.primary }}>No se pudieron cargar los avisos. Reintentar</Text></Pressable>}
    {visible?.length === 0 && <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{showReviewed ? "No hay revisiones registradas." : "No hay incidencias pendientes de revisión."}</Text>}
    <ScrollView style={{ maxHeight: 360 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
      {visible?.map((link) => <View key={link.id} style={{ paddingVertical: 10, borderBottomWidth: 1, borderColor: colors.border }}>
        <Pressable accessibilityRole="button"
        accessibilityLabel={`Revisar ${link.title}`}
        onPress={() => router.push({ pathname: "/wiki/[id]", params: { id: String(link.pageId) } })}
        style={{ paddingVertical: 10, borderBottomWidth: 1, borderColor: colors.border }}>
        <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>{link.pageTitle} · {link.title}</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>{link.url}</Text>
        </Pressable>
        <WikiLinkHealth link={link} />
        {pending(link) && <ResolutionForm link={link} />}
      </View>)}
    </ScrollView>
  </View>;
}

export function WikiLinkReviews() {
  const { user } = useAuth();
  return user?.role === "superadmin" || user?.role === "coordinator" ? <Reviews /> : null;
}
