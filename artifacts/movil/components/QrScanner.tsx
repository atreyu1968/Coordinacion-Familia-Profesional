import React, { useEffect, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";

import { Button } from "@/components/ui";
import { useColors } from "@/hooks/useColors";

export interface QrScannerProps {
  /** Called once with the decoded QR string. */
  onScan: (data: string) => void;
  /** When false, scanning is paused (e.g. while a result is being processed). */
  enabled?: boolean;
}

/**
 * Native QR scanner (iOS/Android) backed by expo-camera. The web build resolves
 * `QrScanner.web.tsx` instead, which uses the browser camera + jsQR.
 */
export function QrScanner({ onScan, enabled = true }: QrScannerProps) {
  const colors = useColors();
  const [permission, requestPermission] = useCameraPermissions();
  const lockRef = useRef(false);

  useEffect(() => {
    if (enabled) lockRef.current = false;
  }, [enabled]);

  if (!permission) {
    return (
      <View style={styles.center}>
        <Feather name="camera" size={48} color={colors.mutedForeground} />
        <Text style={[styles.permText, { color: colors.mutedForeground }]}>
          Comprobando permisos de cámara…
        </Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Feather name="camera-off" size={48} color={colors.mutedForeground} />
        <Text style={[styles.permText, { color: colors.foreground }]}>
          Necesitamos acceso a la cámara para escanear acreditaciones.
        </Text>
        <Button label="Permitir cámara" icon="camera" onPress={requestPermission} />
      </View>
    );
  }

  return (
    <View style={styles.cameraWrap}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={
          !enabled || lockRef.current
            ? undefined
            : ({ data }) => {
                lockRef.current = true;
                onScan(data);
              }
        }
      />
      <View style={styles.overlay} pointerEvents="none">
        <View style={[styles.frame, { borderColor: colors.secondary }]} />
        <Text style={styles.hint}>Apunta al código QR de la acreditación</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
  cameraWrap: { flex: 1, overflow: "hidden" },
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
