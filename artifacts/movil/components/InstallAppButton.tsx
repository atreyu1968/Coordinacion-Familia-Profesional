import React, { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { useColors } from "@/hooks/useColors";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS Safari
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/**
 * "Instalar app" affordance — WEB ONLY. Renders nothing on native (the native
 * apps are installed from the stores) and nothing once the PWA is already
 * installed. On Android/Chrome it triggers the native install prompt; on iOS it
 * shows Add-to-Home-Screen instructions (no programmatic prompt exists there).
 */
export function InstallAppButton() {
  const colors = useColors();
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [installed, setInstalled] = useState(false);
  const [showIosHelp, setShowIosHelp] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    setInstalled(isStandalone());

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (Platform.OS !== "web" || installed) return null;

  const ios = isIos();
  // Without a deferred prompt and not on iOS, the browser can't install (or it
  // is already installed) — hide to avoid a dead button.
  if (!deferred && !ios) return null;

  const onPress = async () => {
    if (deferred) {
      await deferred.prompt();
      await deferred.userChoice.catch(() => undefined);
      setDeferred(null);
      return;
    }
    if (ios) setShowIosHelp((v) => !v);
  };

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.button,
          {
            backgroundColor: colors.primary,
            borderRadius: colors.radius,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <Feather name="download" size={18} color={colors.primaryForeground} />
        <Text style={[styles.label, { color: colors.primaryForeground }]}>
          Instalar app
        </Text>
      </Pressable>

      {showIosHelp && ios && (
        <View
          style={[
            styles.help,
            { backgroundColor: colors.accent, borderRadius: colors.radius },
          ]}
        >
          <Text style={[styles.helpText, { color: colors.accentForeground }]}>
            En iPhone/iPad: pulsa el botón{" "}
            <Text style={styles.bold}>Compartir</Text> y luego{" "}
            <Text style={styles.bold}>Añadir a pantalla de inicio</Text> para
            instalar la app.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 14,
  },
  label: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  help: { padding: 12 },
  helpText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  bold: { fontFamily: "Inter_600SemiBold" },
});
