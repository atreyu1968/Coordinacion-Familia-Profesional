import React from "react";
import { Text, View } from "react-native";
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
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain || !token) return <Text accessibilityRole="alert">No se pudo iniciar la actividad SCORM.</Text>;
  const source = `https://${domain}/scorm-player?token=${encodeURIComponent(token)}`;
  return <View style={{ height: 620, width: "100%", overflow: "hidden", borderRadius: 12, borderWidth: 1, borderColor: "#d7dee8", backgroundColor: "#fff" }}>
    <WebView source={{ uri: source }} javaScriptEnabled domStorageEnabled allowsFullscreenVideo
      allowsInlineMediaPlayback originWhitelist={["https://*"]} setSupportMultipleWindows={false}
      accessibilityLabel={title} />
  </View>;
}
