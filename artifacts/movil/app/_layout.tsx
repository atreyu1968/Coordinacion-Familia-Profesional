import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { Platform, StyleSheet, View, useWindowDimensions } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

import {
  setAuthTokenGetter,
  setBaseUrl,
} from "@workspace/api-client-react";

import { AppLock } from "@/components/AppLock";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Loading } from "@/components/ui";
import { AuthProvider, getAuthToken, useAuth } from "@/contexts/AuthContext";
import { BadgesProvider } from "@/contexts/BadgesContext";
import {
  registerForPushNotifications,
  useNotificationDeepLinks,
} from "@/lib/push";
import { registerWebPush, setupPwa } from "@/lib/pwa";

// Expo bundles run outside the web proxy and need absolute URLs to reach
// the API server, plus a bearer-token getter for authenticated calls.
setBaseUrl(`https://${process.env.EXPO_PUBLIC_DOMAIN}`);
setAuthTokenGetter(() => getAuthToken());

// Register the PWA manifest + service worker on web (no-op on native).
setupPwa();

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootLayoutNav() {
  const { token, isLoading, locked } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    const inAuthGroup = segments[0] === "login";
    if (!token && !inAuthGroup) {
      router.replace("/login");
    } else if (token && inAuthGroup) {
      router.replace("/(tabs)");
    }
  }, [token, isLoading, segments, router]);

  useEffect(() => {
    if (token) {
      void registerForPushNotifications();
      void registerWebPush();
    }
  }, [token]);

  useNotificationDeepLinks(!!token && !isLoading);

  if (isLoading) {
    return <Loading />;
  }

  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="login" />
        <Stack.Screen name="recuperar" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="chat/[id]" />
        <Stack.Screen name="new-chat" options={{ presentation: "modal" }} />
        <Stack.Screen name="scan" options={{ presentation: "modal" }} />
        <Stack.Screen name="surveys" />
        <Stack.Screen name="survey/[id]" />
        <Stack.Screen name="form/[id]" />
        <Stack.Screen name="alerts" />
        <Stack.Screen name="foros" />
        <Stack.Screen name="foros/modulo/[id]" />
        <Stack.Screen name="foros/tema/[id]" />
        <Stack.Screen name="feedback" />
        <Stack.Screen name="perfil" />
      </Stack>
      {token && locked ? <AppLock /> : null}
    </>
  );
}

/**
 * On web, the Expo app is rendered inside a desktop browser where a single
 * column would otherwise stretch edge-to-edge and look like a desktop site.
 * This wraps the whole app in a centered, phone-width frame on wide screens.
 * On native (iOS/Android) it is a no-op.
 */
function WebMobileFrame({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  const { width } = useWindowDimensions();
  if (Platform.OS !== "web") {
    return <>{children}</>;
  }
  // On real phones / installed PWA (narrow viewport) render edge-to-edge so the
  // blue header and tab bar reach the screen sides. Otherwise the muted backdrop
  // around the centered phone-width frame shows as light strips beside the
  // header. Keep the centered frame only on wide desktop browsers.
  if (width < 600) {
    return <>{children}</>;
  }
  return (
    <View style={[styles.webBackdrop, { backgroundColor: colors.muted }]}>
      <View
        style={[
          styles.webFrame,
          { backgroundColor: colors.background, borderColor: colors.border },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  webBackdrop: {
    flex: 1,
    alignItems: "center",
  },
  webFrame: {
    flex: 1,
    width: "100%",
    maxWidth: 440,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <WebMobileFrame>
              <KeyboardProvider>
                <AuthProvider>
                  <BadgesProvider>
                    <RootLayoutNav />
                  </BadgesProvider>
                </AuthProvider>
              </KeyboardProvider>
            </WebMobileFrame>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
