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
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import {
  setAuthTokenGetter,
  setBaseUrl,
} from "@workspace/api-client-react";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Loading } from "@/components/ui";
import { AuthProvider, getAuthToken, useAuth } from "@/contexts/AuthContext";
import { BadgesProvider } from "@/contexts/BadgesContext";
import {
  registerForPushNotifications,
  useNotificationDeepLinks,
} from "@/lib/push";

// Expo bundles run outside the web proxy and need absolute URLs to reach
// the API server, plus a bearer-token getter for authenticated calls.
setBaseUrl(`https://${process.env.EXPO_PUBLIC_DOMAIN}`);
setAuthTokenGetter(() => getAuthToken());

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootLayoutNav() {
  const { token, isLoading } = useAuth();
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
    }
  }, [token]);

  useNotificationDeepLinks(!!token && !isLoading);

  if (isLoading) {
    return <Loading />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="chat/[id]" />
      <Stack.Screen name="new-chat" options={{ presentation: "modal" }} />
      <Stack.Screen name="scan" options={{ presentation: "modal" }} />
      <Stack.Screen name="surveys" />
      <Stack.Screen name="survey/[id]" />
      <Stack.Screen name="alerts" />
    </Stack>
  );
}

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
          <GestureHandlerRootView>
            <KeyboardProvider>
              <AuthProvider>
                <BadgesProvider>
                  <RootLayoutNav />
                </BadgesProvider>
              </AuthProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
