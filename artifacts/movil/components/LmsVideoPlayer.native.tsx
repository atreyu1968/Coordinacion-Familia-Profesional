import React, { useEffect, useRef, useState } from "react";
import { Alert, Modal, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { VideoView, useVideoPlayer } from "expo-video";
import { WebView } from "react-native-webview";

function getEmbedUrl(source: string) {
  try {
    const url = new URL(source);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?playsinline=1&rel=0` : null;
    }
    if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
      const id = url.pathname.startsWith("/embed/")
        ? url.pathname.split("/")[2]
        : url.searchParams.get("v");
      return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?playsinline=1&rel=0` : null;
    }
    if (host === "vimeo.com" || host === "player.vimeo.com") {
      const id = url.pathname.split("/").filter(Boolean).find((part) => /^\d+$/.test(part));
      return id ? `https://player.vimeo.com/video/${id}` : null;
    }
  } catch {
    return null;
  }
  return null;
}

export function LmsVideoPlayer({ source, title }: { source: string; title: string }) {
  const embedUrl = getEmbedUrl(source);
  if (embedUrl) {
    return <View style={{ aspectRatio: 16 / 9, width: "100%", overflow: "hidden", borderRadius: 12, backgroundColor: "#000" }}>
      <WebView source={{ uri: embedUrl }} javaScriptEnabled domStorageEnabled allowsFullscreenVideo
        allowsInlineMediaPlayback mediaPlaybackRequiresUserAction originWhitelist={["https://*"]}
        accessibilityLabel={title} />
    </View>;
  }
  return <DirectVideo source={source} title={title} />;
}

function DirectVideo({ source, title }: { source: string; title: string }) {
  const player = useVideoPlayer(source, (instance) => {
    instance.loop = false;
  });
  return <VideoView player={player} nativeControls allowsFullscreen style={{ aspectRatio: 16 / 9, width: "100%", backgroundColor: "#000", borderRadius: 12 }} accessibilityLabel={title} />;
}

export function LmsScormPlayer({ token, title }: { token: string; title: string }) {
  const [expanded, setExpanded] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const player = useRef<WebView>(null);
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearSaveTimeout = () => {
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = null;
  };
  useEffect(() => () => clearSaveTimeout(), []);
  const requestClose = () => {
    if (loadFailed) { setExpanded(false); return; }
    if (saving) return;
    setSaving(true);
    setError("");
    player.current?.injectJavaScript('window.dispatchEvent(new Event("coordina-scorm-save-request")); true;');
    saveTimeout.current = setTimeout(() => {
      setSaving(false);
      setError("No se pudo confirmar el guardado. Comprueba la conexión y vuelve a pulsar «Volver al curso».");
    }, 12_000);
  };
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain || !token) return <Text accessibilityRole="alert">No se pudo iniciar la actividad SCORM.</Text>;
  const source = `https://${domain}/scorm-player?token=${encodeURIComponent(token)}`;
  return <>
    <Pressable accessibilityRole="button" onPress={() => { setError(""); setLoadFailed(false); setExpanded(true); }} style={{ padding: 16 }}>
      <Text style={{ color: "#124996" }}>Ver SCORM a pantalla completa</Text>
    </Pressable>
    <Modal visible={expanded} presentationStyle="fullScreen" animationType="slide" onRequestClose={requestClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
        <Pressable accessibilityRole="button" disabled={saving} onPress={requestClose} style={{ padding: 12 }}>
          <Text style={{ color: "#124996", fontWeight: "600" }}>{saving ? "Guardando progreso…" : "Volver al curso"}</Text>
        </Pressable>
        {error ? <View style={{ padding: 12, gap: 8 }}>
          <Text accessibilityRole="alert" style={{ color: "#b42318" }}>{error}</Text>
          <Pressable accessibilityRole="button" onPress={() => Alert.alert(
            "Salir sin guardar",
            "Se pueden perder los cambios desde el último guardado. ¿Quieres salir de la actividad?",
            [{ text: "Cancelar", style: "cancel" }, { text: "Salir", style: "destructive", onPress: () => {
              clearSaveTimeout(); setSaving(false); setExpanded(false);
            } }],
          )}><Text style={{ color: "#b42318" }}>Salir sin guardar</Text></Pressable>
        </View> : null}
        <WebView ref={player} source={{ uri: source }} javaScriptEnabled domStorageEnabled allowsFullscreenVideo
          style={{ flex: 1 }} allowsInlineMediaPlayback originWhitelist={["https://*"]} setSupportMultipleWindows={false}
          onMessage={(event) => {
            try {
              const result = JSON.parse(event.nativeEvent.data);
              if (result.type !== "scorm-save") return;
              clearSaveTimeout();
              setSaving(false);
              if (result.ok === true) setExpanded(false);
              else setError("No se pudo guardar el progreso. Reintenta antes de salir.");
            } catch { /* Ignore unrelated messages from the package. */ }
          }}
          onError={() => { clearSaveTimeout(); setLoadFailed(true); setSaving(false); setError("No se pudo cargar el contenido SCORM. Comprueba la conexión."); }}
          accessibilityLabel={title} />
      </SafeAreaView>
    </Modal>
  </>;
}
