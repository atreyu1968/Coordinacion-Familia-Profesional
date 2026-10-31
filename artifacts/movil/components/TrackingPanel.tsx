import React, { useCallback, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import {
  useGetForumCollaborationTracking,
  getGetForumCollaborationTrackingQueryKey,
  type ForumTrackingModule,
} from "@workspace/api-client-react";

import { Card, EmptyState, ErrorState, Loading } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { openBrowserLink } from "@/lib/browser-link";
import { webAppUrl } from "@/lib/web-links";

const STATUS: Record<string, string> = {
  abierto: "Abierto", sintesis: "En síntesis", propuesta: "Propuesta", consulta: "En consulta",
  consensuado: "Consensuado", sin_consenso: "Sin consenso", revision_normativa: "Revisión normativa", archivado: "Archivado",
};
const isMissing = (s: string) => s === "sin_sintesis";
type Filter = "all" | "enabled" | "disabled" | "review";
const FILTERS: [Filter, string][] = [["all", "Todos"], ["enabled", "Activos"], ["disabled", "Desactivados"], ["review", "A revisar"]];

function fmt(iso: string | null) {
  if (!iso) return "Sin actividad";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("es-ES");
}

export function TrackingPanel() {
  const colors = useColors();
  const router = useRouter();
  const { user } = useAuth();
  const q = useGetForumCollaborationTracking({
    query: {
      queryKey: getGetForumCollaborationTrackingQueryKey(),
      enabled: !!user,
      staleTime: 15_000,
      refetchInterval: 60_000,
      refetchOnMount: "always",
      refetchOnWindowFocus: true,
    },
  });
  const refetch = q.refetch;
  useFocusEffect(useCallback(() => { void refetch(); }, [refetch]));
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<number | null>(null);

  const mods = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data?.modules ?? [])
      .filter((m) => !s || m.name.toLowerCase().includes(s) || (m.code ?? "").toLowerCase().includes(s) || (m.cycleName ?? "").toLowerCase().includes(s))
      .filter((m) => filter === "all" || (filter === "enabled" ? m.enabled : filter === "disabled" ? !m.enabled : m.reviewNeeded || m.resourcesNeedingReview > 0))
      .sort((a, b) => (a.cycleName ?? "").localeCompare(b.cycleName ?? "", "es") || a.name.localeCompare(b.name, "es"));
  }, [q.data, search, filter]);

  if (q.isLoading) return <Loading />;
  if (q.isError || !q.data) return <ErrorState onRetry={() => void q.refetch()} />;
  const d = q.data;
  const t = d.totals;
  const muted = { color: colors.mutedForeground };
  const fg = { color: colors.foreground };

  const Row = ({ label, v, of }: { label: string; v: number; of?: number }) => (
    <View style={s.row}><Text style={[s.small, muted]}>{label}</Text><Text style={[s.num, fg]}>{v}{of != null ? ` / ${of}` : ""}</Text></View>
  );

  const detail = (m: ForumTrackingModule) => (
    <View style={{ gap: 6, marginTop: 10 }}>
      <Row label="RA con criterios" v={m.outcomesWithCriteria} of={m.outcomes} />
      <Row label="RA con recursos visibles" v={m.outcomesWithResources} of={m.outcomes} />
      <Row label="Recursos vigentes" v={m.resources} />
      <Row label="Recursos a revisar (huella o versión curricular)" v={m.resourcesNeedingReview} />
      <Row label="Temas creados / previstos" v={m.createdThreads} of={m.plannedThreads} />
      <Row label="Páginas publicadas conservadas" v={m.publishedVersions} />
      <Row label="Participantes / elegibles (censo vivo)" v={m.participants} of={m.eligibleParticipants} />
      <Row label="Centros con postura / elegibles" v={m.centers} of={m.eligibleCenters} />
      <Text style={[s.small, muted]}>Revisión curricular {m.verificationCurrent ? "vigente" : "no vigente"} · Última actividad: {fmt(m.lastActivityAt)}</Text>
      {m.diagnostics.map((x, i) => <Text key={i} style={[s.small, { color: colors.destructive }]}>{x}</Text>)}
      <Pressable onPress={() => router.push({ pathname: "/foros/modulo/[id]", params: { id: String(m.id), name: m.name, cycle: m.cycleName ?? "" } })}>
        <Text style={[s.link, { color: colors.primary }]}>Abrir foro del módulo</Text>
      </Pressable>
      {m.threads.length === 0 ? <Text style={[s.small, muted]}>Sin temas creados.</Text> : m.threads.map((th) => (
        <View key={th.id} style={[s.thread, { borderColor: colors.border }]}>
          <Pressable onPress={() => router.push({ pathname: "/foros/tema/[id]", params: { id: String(th.id), title: th.title, module: m.name } })}>
            <Text style={[s.link, { color: colors.primary }]}>{th.title}</Text>
          </Pressable>
          <Text style={[s.small, muted]}>
            {isMissing(th.status) ? "Sin síntesis" : STATUS[th.status] ?? th.status}{th.version != null ? ` · v${th.version}` : ""}
          </Text>
          {th.publishedPageId != null && (
            <Pressable onPress={() => { const u = webAppUrl(`/documentacion?page=${th.publishedPageId}`); if (!u) { Alert.alert("Enlace no disponible", "No está configurada la dirección de la aplicación web; abre Documentación desde el navegador."); return; } void openBrowserLink(u).catch(() => Alert.alert("No se pudo abrir", "No se pudo abrir el documento en el navegador.")); }}>
              <Text style={[s.link, { color: colors.primary }]}>Ver documento publicado</Text>
            </Pressable>
          )}
        </View>
      ))}
    </View>
  );

  return (
    <View style={{ gap: 12 }}>
      <View style={s.row}>
        <Text style={[s.small, muted]}>Datos de {fmt(d.generatedAt)}</Text>
        <Pressable onPress={() => void q.refetch()} disabled={q.isFetching} style={s.rowGap}>
          <Feather name="refresh-cw" size={14} color={colors.primary} />
          <Text style={[s.link, { color: colors.primary }]}>{q.isFetching ? "Actualizando" : "Actualizar"}</Text>
        </Pressable>
      </View>
      <Card style={{ gap: 6 }}>
        <Text style={[s.title, fg]}>{d.family}{d.academicYear ? ` · ${d.academicYear}` : ""}</Text>
        <Row label="Módulos con piloto" v={t.modules} />
        <Row label="Pilotos activos" v={t.enabled} />
        <Row label="Requieren revisión" v={t.reviewNeeded} />
        <Row label="Participantes distintos" v={t.participants} />
        <Row label="Centros con postura distintos" v={t.centers} />
        <Row label="Recursos" v={t.resources} />
        <Row label="Versiones publicadas" v={t.publishedVersions} />
        <Row label="Consultas abiertas" v={t.openConsultations} />
        <Text style={[s.small, muted]}>Totales de todos los pilotos visibles; no cambian con los filtros.</Text>
      </Card>
      <Text style={[s.small, muted]}>{d.legend} Nada se aprueba automáticamente ni se presume unanimidad. Elegibles es el censo vivo actual, no el censo congelado de un acuerdo.</Text>
      <Text style={[s.small, muted]}>Sincronización con proveedores no comprobada: no hay diagnóstico, no equivale a cero fallos.</Text>
      <TextInput value={search} onChangeText={setSearch} placeholder="Nombre, código o ciclo" placeholderTextColor={colors.mutedForeground}
        style={[s.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card }]} />
      <View style={[s.rowGap, { flexWrap: "wrap" }]}>
        {FILTERS.map(([v, l]) => (
          <Pressable key={v} onPress={() => setFilter(v)} style={[s.chip, { borderColor: colors.border, backgroundColor: filter === v ? colors.primary : colors.card }]}>
            <Text style={[s.small, { color: filter === v ? colors.primaryForeground : colors.foreground }]}>{l}</Text>
          </Pressable>
        ))}
      </View>
      {d.modules.length === 0 ? <EmptyState icon="activity" title="Sin pilotos" message="No hay módulos con piloto en tu ámbito." />
        : mods.length === 0 ? <Text style={[s.small, muted]}>Ningún módulo coincide con los filtros.</Text>
        : mods.map((m) => (
          <Card key={m.id}>
            <Pressable onPress={() => setOpen(open === m.id ? null : m.id)}>
              <Text style={[s.small, muted]}>{(m.cycleName ?? "Sin ciclo").toUpperCase()}{m.code ? ` · ${m.code}` : ""}</Text>
              <Text style={[s.title, fg]}>{m.name}</Text>
              <Text style={[s.small, muted]}>
                {m.enabled ? "Piloto activo" : "Piloto desactivado"} · {m.createdThreads}/{m.plannedThreads} temas · {m.participants}/{m.eligibleParticipants} participantes
                {m.reviewNeeded ? " · Requiere revisión" : ""}
              </Text>
            </Pressable>
            {open === m.id && detail(m)}
          </Card>
        ))}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  rowGap: { flexDirection: "row", alignItems: "center", gap: 6 },
  small: { fontSize: 12, fontFamily: "Inter_400Regular", flexShrink: 1 },
  num: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  title: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  link: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  thread: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 6, gap: 2 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14 },
  chip: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 },
});
