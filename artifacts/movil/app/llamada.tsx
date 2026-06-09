import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { WebView } from "react-native-webview";
import {
  useCameraPermissions,
  useMicrophonePermissions,
} from "expo-camera";
import * as WebBrowser from "expo-web-browser";

import { jitsiUrl } from "@/lib/call";

export default function CallScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{
    room?: string;
    title?: string;
    audio?: string;
  }>();

  const room = params.room ?? "";
  const audioOnly = params.audio === "1";
  const title =
    params.title ?? (audioOnly ? "Llamada de audio" : "Videollamada");

  const uri = jitsiUrl(room, audioOnly);

  const [, requestCamera] = useCameraPermissions();
  const [, requestMicrophone] = useMicrophonePermissions();
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);

  // Close the screen exactly once, whether the user taps "Salir" or hangs up
  // inside Jitsi (which redirects meet.jit.si away from the room).
  const closedRef = useRef(false);
  const leave = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    router.back();
  }, [router]);

  // True while the WebView URL still points at our room. Once Jitsi navigates
  // away (hang-up → welcome/promo page, or an `intent://`/`market://` deep link
  // to the native Jitsi app), we bail out of the screen instead of letting that
  // page load and crash the WebView. Only the room URL and the blank/initial
  // states are allowed through — every other scheme is treated as "leaving".
  const isRoomUrl = useCallback(
    (url: string) =>
      !url || url === "about:blank" || url.includes(`/${room}`),
    [room],
  );

  // The WebView can't be granted camera/mic on web — fall back to a new tab.
  useEffect(() => {
    if (Platform.OS === "web") {
      void WebBrowser.openBrowserAsync(uri);
      router.back();
    }
  }, [uri, router]);

  // Ask for microphone (and camera, for video calls) before loading the room so
  // the OS dialog appears in our app rather than failing silently inside Jitsi.
  useEffect(() => {
    if (Platform.OS === "web") return;
    let active = true;
    (async () => {
      try {
        await requestMicrophone();
        if (!audioOnly) await requestCamera();
      } catch {
        // Permission request failures are surfaced by Jitsi inside the call.
      }
      if (active) setReady(true);
    })();
    return () => {
      active = false;
    };
  }, [audioOnly, requestCamera, requestMicrophone]);

  if (Platform.OS === "web") return null;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <View style={styles.barTitleWrap}>
          <Feather
            name={audioOnly ? "phone" : "video"}
            size={16}
            color="#fff"
          />
          <Text style={styles.barTitle} numberOfLines={1}>
            {title}
          </Text>
        </View>
        <Pressable
          onPress={leave}
          hitSlop={10}
          style={styles.closeBtn}
          accessibilityLabel="Salir de la llamada"
        >
          <Feather name="x" size={18} color="#fff" />
          <Text style={styles.closeText}>Salir</Text>
        </Pressable>
      </View>

      {ready && room ? (
        <WebView
          source={{ uri }}
          style={styles.web}
          originWhitelist={["*"]}
          javaScriptEnabled
          domStorageEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          mediaCapturePermissionGrantHandler={() => "grant"}
          onLoadEnd={() => setLoading(false)}
          onShouldStartLoadWithRequest={(req) => {
            if (isRoomUrl(req.url)) return true;
            leave();
            return false;
          }}
          onNavigationStateChange={(nav) => {
            if (!isRoomUrl(nav.url)) leave();
          }}
        />
      ) : null}

      {(loading || !ready) && room ? (
        <View style={styles.loading} pointerEvents="none">
          <ActivityIndicator color="#fff" size="large" />
        </View>
      ) : null}

      {!room ? (
        <View style={styles.loading}>
          <Text style={styles.errorText}>Sala no válida.</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  bar: {
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    backgroundColor: "#18181b",
  },
  barTitleWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  barTitle: {
    color: "#fff",
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    flexShrink: 1,
  },
  closeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  closeText: { color: "#fff", fontSize: 14, fontFamily: "Inter_500Medium" },
  web: { flex: 1, backgroundColor: "#000" },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  errorText: { color: "#fff", fontSize: 15, fontFamily: "Inter_400Regular" },
});
