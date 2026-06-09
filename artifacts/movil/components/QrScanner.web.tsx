import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import jsQR from "jsqr";

import { Button } from "@/components/ui";
import { useColors } from "@/hooks/useColors";

export interface QrScannerProps {
  /** Called once with the decoded QR string. */
  onScan: (data: string) => void;
  /** When false, scanning is paused (e.g. while a result is being processed). */
  enabled?: boolean;
}

/**
 * Web / PWA QR scanner. Uses the browser camera (getUserMedia) and decodes
 * frames with jsQR, so it works across Android (Chrome) and iOS (Safari)
 * without relying on the BarcodeDetector API. Native builds resolve
 * `QrScanner.tsx` (expo-camera) instead.
 */
export function QrScanner({ onScan, enabled = true }: QrScannerProps) {
  const colors = useColors();
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const [attempt, setAttempt] = useState(0);

  const lockRef = useRef(false);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  // Create the <video>/<canvas> once so the container ref can mount the video
  // synchronously (refs run before effects).
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  if (typeof document !== "undefined" && !videoRef.current) {
    const v = document.createElement("video");
    v.muted = true;
    v.setAttribute("playsinline", "true");
    v.setAttribute("autoplay", "true");
    v.style.width = "100%";
    v.style.height = "100%";
    v.style.objectFit = "cover";
    videoRef.current = v;
    canvasRef.current = document.createElement("canvas");
  }

  useEffect(() => {
    if (enabled) lockRef.current = false;
  }, [enabled]);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    let cancelled = false;
    let raf: number | null = null;
    let stream: MediaStream | null = null;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!enabledRef.current || lockRef.current) return;
      if (video.readyState !== video.HAVE_ENOUGH_DATA) return;
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) return;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(video, 0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h);
      const code = jsQR(img.data, w, h, { inversionAttempts: "dontInvert" });
      if (code && code.data) {
        lockRef.current = true;
        onScanRef.current(code.data);
      }
    };

    const start = async () => {
      setError(null);
      setStarting(true);
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Este navegador no permite el acceso a la cámara.");
        setStarting(false);
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        video.srcObject = stream;
        await video.play().catch(() => undefined);
        setStarting(false);
        raf = requestAnimationFrame(tick);
      } catch {
        setError(
          "No se pudo acceder a la cámara. Concede el permiso en el navegador e inténtalo de nuevo.",
        );
        setStarting(false);
      }
    };

    void start();

    return () => {
      cancelled = true;
      if (raf != null) cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    };
  }, [attempt]);

  return (
    <View style={styles.cameraWrap}>
      <View
        style={StyleSheet.absoluteFill}
        ref={(node) => {
          const el = node as unknown as HTMLElement | null;
          const v = videoRef.current;
          if (el && v && !el.contains(v)) el.appendChild(v);
        }}
      />

      {error ? (
        <View style={[styles.center, styles.fillCenter]}>
          <Feather name="camera-off" size={48} color={colors.mutedForeground} />
          <Text style={[styles.permText, { color: colors.foreground }]}>
            {error}
          </Text>
          <Button
            label="Reintentar"
            icon="refresh-cw"
            onPress={() => setAttempt((a) => a + 1)}
          />
        </View>
      ) : (
        <>
          <View style={styles.overlay} pointerEvents="none">
            <View style={[styles.frame, { borderColor: colors.secondary }]} />
            <Text style={styles.hint}>
              {starting
                ? "Iniciando cámara…"
                : "Apunta al código QR de la acreditación"}
            </Text>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  cameraWrap: { flex: 1, overflow: "hidden", backgroundColor: "#000000" },
  fillCenter: { ...StyleSheet.absoluteFillObject },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 16,
  },
  permText: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 22,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 24,
  },
  frame: { width: 240, height: 240, borderWidth: 3, borderRadius: 24 },
  hint: {
    color: "#ffffff",
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
    paddingHorizontal: 32,
  },
});
