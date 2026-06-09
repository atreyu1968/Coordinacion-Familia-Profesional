import React, { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";

import { useCheckInAccreditation } from "@workspace/api-client-react";

import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui";
import { useColors } from "@/hooks/useColors";

type Result =
  | { kind: "success"; alreadyCheckedIn: boolean; name?: string }
  | { kind: "error"; message: string };

export default function ScanScreen() {
  const colors = useColors();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const checkIn = useCheckInAccreditation();

  const handleScan = (qrToken: string) => {
    if (scanned) return;
    setScanned(true);
    if (Platform.OS !== "web") {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    checkIn.mutate(
      { data: { qrToken } },
      {
        onSuccess: (res) => {
          setResult({
            kind: "success",
            alreadyCheckedIn: res.alreadyCheckedIn,
            name: res.accreditation?.holderName ?? undefined,
          });
          if (Platform.OS !== "web") {
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
        },
        onError: () => {
          setResult({ kind: "error", message: "Acreditación no válida o no encontrada." });
          if (Platform.OS !== "web") {
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          }
        },
      },
    );
  };

  const reset = () => {
    setScanned(false);
    setResult(null);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader title="Escanear QR" subtitle="Control de acceso a eventos" showBack />
      <View style={styles.body}>
        {Platform.OS === "web" ? (
          <Info
            colors={colors}
            icon="smartphone"
            text="El escaneo de QR requiere la cámara de un dispositivo móvil. Abre la app en Expo Go para usarlo."
          />
        ) : !permission ? (
          <Info colors={colors} icon="camera" text="Comprobando permisos de cámara…" />
        ) : !permission.granted ? (
          <View style={styles.center}>
            <Feather name="camera-off" size={48} color={colors.mutedForeground} />
            <Text style={[styles.permText, { color: colors.foreground }]}>
              Necesitamos acceso a la cámara para escanear acreditaciones.
            </Text>
            <Button label="Permitir cámara" icon="camera" onPress={requestPermission} />
          </View>
        ) : result ? (
          <ResultView colors={colors} result={result} onReset={reset} />
        ) : (
          <View style={styles.cameraWrap}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={
                scanned ? undefined : ({ data }) => handleScan(data)
              }
            />
            <View style={styles.overlay}>
              <View style={[styles.frame, { borderColor: colors.secondary }]} />
              <Text style={styles.hint}>Apunta al código QR de la acreditación</Text>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

function Info({
  colors,
  icon,
  text,
}: {
  colors: ReturnType<typeof useColors>;
  icon: React.ComponentProps<typeof Feather>["name"];
  text: string;
}) {
  return (
    <View style={styles.center}>
      <Feather name={icon} size={48} color={colors.mutedForeground} />
      <Text style={[styles.permText, { color: colors.mutedForeground }]}>{text}</Text>
    </View>
  );
}

function ResultView({
  colors,
  result,
  onReset,
}: {
  colors: ReturnType<typeof useColors>;
  result: Result;
  onReset: () => void;
}) {
  const ok = result.kind === "success";
  const color = ok ? colors.success : colors.destructive;
  return (
    <View style={styles.center}>
      <View style={[styles.resultIcon, { backgroundColor: color }]}>
        <Feather name={ok ? "check" : "x"} size={48} color="#ffffff" />
      </View>
      {ok ? (
        <>
          <Text style={[styles.resultTitle, { color: colors.foreground }]}>
            {result.alreadyCheckedIn ? "Ya tenía acceso" : "Acceso registrado"}
          </Text>
          {result.name ? (
            <Text style={[styles.resultName, { color: colors.mutedForeground }]}>
              {result.name}
            </Text>
          ) : null}
        </>
      ) : (
        <Text style={[styles.resultTitle, { color: colors.foreground }]}>
          {result.message}
        </Text>
      )}
      <Button label="Escanear otra" icon="maximize" onPress={onReset} style={{ marginTop: 20 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { flex: 1 },
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
  frame: {
    width: 240,
    height: 240,
    borderWidth: 3,
    borderRadius: 24,
  },
  hint: {
    color: "#ffffff",
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
    paddingHorizontal: 32,
  },
  resultIcon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  resultTitle: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  resultName: { fontSize: 16, fontFamily: "Inter_400Regular" },
});
