import React, { createElement } from "react";
import { Text, View } from "react-native";

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
      {createElement("iframe", {
        title,
        src: embedUrl,
        allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
        allowFullScreen: true,
        referrerPolicy: "strict-origin-when-cross-origin",
        style: { width: "100%", height: "100%", border: 0 },
      })}
    </View>;
  }
  return <View style={{ aspectRatio: 16 / 9, width: "100%", overflow: "hidden", borderRadius: 12, backgroundColor: "#000" }}>
    {createElement("video", {
      src: source,
      controls: true,
      playsInline: true,
      preload: "metadata",
      title,
      style: { width: "100%", height: "100%", objectFit: "contain" },
    })}
  </View>;
}

export function LmsScormPlayer({ token, title }: { token: string; title: string }) {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain || !token) return <Text accessibilityRole="alert">No se pudo iniciar la actividad SCORM.</Text>;
  const source = `https://${domain}/scorm-player?token=${encodeURIComponent(token)}`;
  return <View style={{ height: 620, width: "100%", overflow: "hidden", borderRadius: 12, borderWidth: 1, borderColor: "#d7dee8", backgroundColor: "#fff" }}>
    {createElement("iframe", {
      title,
      src: source,
      allow: "fullscreen",
      allowFullScreen: true,
      referrerPolicy: "strict-origin",
      style: { width: "100%", height: "100%", border: 0 },
    })}
  </View>;
}
