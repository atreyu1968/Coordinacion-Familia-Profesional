import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { AppHeader } from "@/components/AppHeader";
import { useColors } from "@/hooks/useColors";
import { getAuthToken } from "@/contexts/AuthContext";
import { loadPdfBytes } from "@/lib/pdf-source";

const BASE = (process.env.EXPO_PUBLIC_BASE_PATH || "").replace(/\/+$/, "");

export default function PdfViewerScreen({ uri: uriProp, title: titleProp, embedded = false }: {
  uri?: string;
  title?: string;
  embedded?: boolean;
}) {
  const colors = useColors();
  const params = useLocalSearchParams<{ uri?: string; title?: string }>();
  const frame = useRef<HTMLIFrameElement>(null);
  const [data, setData] = useState<ArrayBuffer | null>(null);
  const [ready, setReady] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const uri = uriProp ?? (typeof params.uri === "string" ? params.uri : "");
  const title = titleProp ?? (typeof params.title === "string" ? params.title : "Documento PDF");

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== window.location.origin) return;
      if (event.data?.type === "coordina-pdf-ready") setReady(true);
      if (event.data?.type === "coordina-pdf-rendered") setRendered(true);
      if (event.data?.type === "coordina-pdf-error") {
        setError(typeof event.data.message === "string" ? event.data.message : "No se pudo mostrar el PDF.");
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    setData(null); setError(""); setRendered(false);
    void (async () => {
      const bytes = await loadPdfBytes(uri, window.location.origin,
        process.env.EXPO_PUBLIC_DOMAIN, getAuthToken(), abort.signal);
      if (!abort.signal.aborted) setData(bytes);
    })().catch((reason: unknown) => {
      if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : "No se pudo abrir el PDF.");
    });
    return () => {
      abort.abort();
      if (uri.startsWith("blob:")) URL.revokeObjectURL(uri);
    };
  }, [uri, attempt]);

  useEffect(() => {
    if (!ready || !data) return;
    const bytes = data.slice(0);
    frame.current?.contentWindow?.postMessage(
      { type: "coordina-pdf-open", data: bytes }, window.location.origin, [bytes],
    );
  }, [ready, data]);

  useEffect(() => {
    if (ready || error) return;
    const timer = window.setTimeout(() => setError("No se pudo iniciar el visor. Pulsa Reintentar."), 30_000);
    return () => window.clearTimeout(timer);
  }, [ready, error, attempt]);

  return (
    <View style={[styles.screen, embedded ? styles.embedded : null, { backgroundColor: colors.background }]}>
      {!embedded ? <AppHeader title={title} showBack /> : null}
      {error ? <View style={styles.center}>
        <Text style={{ color: colors.destructive, textAlign: "center" }}>{error}</Text>
        {!uri.startsWith("blob:") && <Pressable accessibilityRole="button" onPress={() => {
          setReady(false); setAttempt((value) => value + 1);
        }} style={{ padding: 16 }}><Text style={{ color: colors.primary }}>Reintentar</Text></Pressable>}
      </View> : null}
      {!error && !rendered ? <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} /><Text style={{ color: colors.mutedForeground }}>Abriendo documento…</Text>
      </View> : null}
      <iframe key={attempt} ref={frame} title={`Visor de PDF: ${title}`}
        src={`${BASE}/pdf-renderer/index.html`} referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-same-origin"
        style={{ flex: 1, width: "100%", minHeight: 0, border: 0, display: error ? "none" : "block" }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  embedded: { height: 700, minHeight: 500, flex: undefined, borderRadius: 12, overflow: "hidden" },
  loading: { alignItems: "center", justifyContent: "center", padding: 12, gap: 8 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
});
