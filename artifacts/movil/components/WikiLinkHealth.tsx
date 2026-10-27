import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import {
  useListWikiLinkReviews, getListWikiLinkReviewsQueryKey, type WikiExternalLink,
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
  return <View style={{ gap: 3, marginTop: 5 }}>
    <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{labels[link.checkStatus]}{link.httpStatus ? ` · HTTP ${link.httpStatus}` : ""}</Text>
    <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>Última comprobación: {link.checkedAt ? new Date(link.checkedAt).toLocaleString("es-ES") : "Todavía no comprobado"}</Text>
    <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>Próxima comprobación: {new Date(link.nextCheckAt).toLocaleString("es-ES")}</Text>
    {link.redirectUrl && <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>Destino observado: {link.redirectUrl}</Text>}
  </View>;
}

function Reviews() {
  const colors = useColors();
  const query = useListWikiLinkReviews({
    query: { queryKey: getListWikiLinkReviewsQueryKey(), staleTime: 30_000, refetchInterval: 60_000 },
  });
  return <View style={{ paddingHorizontal: 20, paddingBottom: 12, gap: 6 }}>
    <Text accessibilityRole="header" style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold" }}>Enlaces de Normativa para revisar{query.data ? ` (${query.data.length})` : ""}</Text>
    <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>
      Revisión semanal; ante fallos, reintentos a las 6 y 24 horas. No se cambian enlaces ni contenidos. Un bloqueo no confirma desaparición. Accesibilidad no significa vigencia jurídica.
    </Text>
    {query.isPending && <Text style={{ color: colors.mutedForeground }}>Cargando comprobaciones…</Text>}
    {query.isError && <Pressable accessibilityRole="button" onPress={() => void query.refetch()}><Text style={{ color: colors.primary }}>No se pudieron cargar los avisos. Reintentar</Text></Pressable>}
    {query.data?.length === 0 && <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>No hay incidencias detectadas. Puede haber enlaces pendientes de comprobación.</Text>}
    <ScrollView style={{ maxHeight: 240 }} nestedScrollEnabled>
      {query.data?.map((link) => <Pressable key={link.id} accessibilityRole="button"
        accessibilityLabel={`Revisar ${link.title}`}
        onPress={() => router.push({ pathname: "/wiki/[id]", params: { id: String(link.pageId) } })}
        style={{ paddingVertical: 10, borderBottomWidth: 1, borderColor: colors.border }}>
        <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>{link.pageTitle} · {link.title}</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>{link.url}</Text>
        <WikiLinkHealth link={link} />
      </Pressable>)}
    </ScrollView>
  </View>;
}

export function WikiLinkReviews() {
  const { user } = useAuth();
  return user?.role === "superadmin" || user?.role === "coordinator" ? <Reviews /> : null;
}
