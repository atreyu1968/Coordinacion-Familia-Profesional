import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { useColors } from "@/hooks/useColors";
import type { NextcloudViewerProps } from "./NextcloudViewer.types";

/** Native implementation. Metro resolves .web.tsx for browsers/PWA. */
export function NextcloudViewer({ url, nextcloudUrl, onError }: NextcloudViewerProps) {
  const colors = useColors();
  const allowedOrigins = new Set([new URL(url).origin, new URL(nextcloudUrl).origin]);
  return (
    <WebView
      source={{ uri: url }}
      originWhitelist={["https://*"]}
      javaScriptEnabled
      domStorageEnabled
      sharedCookiesEnabled
      thirdPartyCookiesEnabled
      cacheEnabled={false}
      setSupportMultipleWindows={false}
      onShouldStartLoadWithRequest={(request) => {
        try {
          const target = new URL(request.url);
          return target.protocol === "https:" && allowedOrigins.has(target.origin);
        } catch {
          return false;
        }
      }}
      renderLoading={() => (
        <View style={[styles.loading, { backgroundColor: colors.background }]}>
          <ActivityIndicator color={colors.primary} />
          <Text style={{ color: colors.mutedForeground }}>Conectando con Nextcloud…</Text>
        </View>
      )}
      startInLoadingState
      onError={() => onError("No se pudo conectar con Nextcloud. Cierra y vuelve a abrir el espacio.")}
      onHttpError={({ nativeEvent }) => {
        if ([401, 403].includes(nativeEvent.statusCode)) {
          onError("Nextcloud ya no autoriza este acceso. La vista se ha cerrado; vuelve a abrir el espacio si tus permisos siguen vigentes.");
        }
      }}
      style={styles.viewer}
    />
  );
}

const styles = StyleSheet.create({
  loading: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", gap: 10 },
  viewer: { flex: 1, backgroundColor: "transparent" },
});
