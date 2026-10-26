import React, { createElement, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Pressable, Text, View } from "react-native";

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
  const [expanded, setExpanded] = useState(true);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [expanded]);
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  useEffect(() => {
    const onReturn = (event: MessageEvent) => {
      if (domain && event.origin === `https://${domain}` &&
        event.source === frame.current?.contentWindow &&
        event.data?.type === "coordina-scorm-return") setExpanded(false);
    };
    window.addEventListener("message", onReturn);
    return () => window.removeEventListener("message", onReturn);
  }, [domain]);
  if (!domain || !token) return <Text accessibilityRole="alert">No se pudo iniciar la actividad SCORM.</Text>;
  const source = `https://${domain}/scorm-player?token=${encodeURIComponent(token)}`;
  return <>
    {!expanded && <Pressable accessibilityRole="button" onPress={() => setExpanded(true)} style={{ padding: 16 }}>
      <Text style={{ color: "#124996", fontWeight: "600" }}>Ver SCORM a pantalla completa</Text>
    </Pressable>}
    {typeof document !== "undefined" && createPortal(<div role="region" aria-label="Reproductor SCORM" data-fullscreen={expanded ? "true" : "false"} style={{
      // RN Web scroll containers can establish a fixed-position containing
      // block. A body portal avoids clipping or offsets. Keep it mounted when
      // hidden so returning to the course never reloads the active package.
      display: expanded ? "flex" : "none", flexDirection: "column", position: "fixed",
      inset: 0, height: "100dvh", width: "100%", zIndex: 10000, backgroundColor: "#fff",
    }}>
    <Pressable accessibilityRole="button" accessibilityLabel="Volver al curso"
      onPress={() => setExpanded(false)} style={{ padding: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderColor: "#d7dee8" }}>
      <Text style={{ color: "#124996", fontWeight: "600" }}>Volver al curso</Text>
    </Pressable>
    {createElement("iframe", {
      ref: frame,
      title,
      src: source,
      allow: "fullscreen",
      allowFullScreen: true,
      referrerPolicy: "strict-origin",
      style: { width: "100%", flex: 1, minHeight: 0, border: 0 },
    })}
    </div>, document.body)}
  </>;
}
