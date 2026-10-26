import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useGlobalSearchParams, usePathname, useRouter, useSegments, type Href } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useRef } from "react";
import { Platform, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

import {
  setAuthTokenGetter,
  setBaseUrl,
  getGetMyTeachingProfileQueryKey,
  useGetMyTeachingProfile,
} from "@workspace/api-client-react";

import { AppLock } from "@/components/AppLock";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Button, Loading } from "@/components/ui";
import { AuthProvider, getAuthToken, useAuth } from "@/contexts/AuthContext";
import { BadgesProvider } from "@/contexts/BadgesContext";
import {
  registerForPushNotifications,
  useNotificationDeepLinks,
} from "@/lib/push";
import { registerWebPush, setupPwa } from "@/lib/pwa";
import { protectedReturnPath } from "@/lib/protected-return-path";

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
  const { token, user, isLoading, locked, signOut } = useAuth();
  const colors = useColors();
  const segments = useSegments();
  const pathname = usePathname();
  const router = useRouter();
  const isTeacher = Boolean(token && ["teacher", "department_head", "coordinator", "superadmin"].includes(user?.role ?? ""));
  const teachingProfileQuery = useGetMyTeachingProfile(
    { targetCenterId: (user?.role === "teacher" ? user.centerId : user?.teachingCenterId ?? user?.centerId) ?? undefined },
    {
      query: {
        queryKey: getGetMyTeachingProfileQueryKey({
          targetCenterId: (user?.role === "teacher" ? user.centerId : user?.teachingCenterId ?? user?.centerId) ?? undefined,
        }),
        enabled: isTeacher && !locked,
        retry: false,
        // Failed queries with no data use retryOnMount, independently of
        // refetchOnMount. Recovery must be explicit for this blocking query.
        retryOnMount: false,
        refetchOnMount: false,
      },
    },
  );
  const profileWasForced = useRef(false);
  const globalParams = useGlobalSearchParams<Record<string, string | string[]>>();
  const routeToken = Array.isArray(globalParams.token)
    ? globalParams.token[0]
    : globalParams.token;
  // Attendance token opened while signed out; restored right after login.
  // Only an opaque token is kept (never a full URL) so the return is safe.
  const pendingAttendanceToken = useRef<string | null>(null);
  const pendingProtectedRoute = useRef<Href | null>(null);
  // A profile error/mandatory profile redirect must not replace the original
  // notice with /perfil when the user signs out to recover an expired session.
  const profileReturnRoute = useRef<Href | null>(null);
  const currentProtectedRoute = protectedReturnPath(pathname, globalParams);

  useEffect(() => {
    if (isLoading) return;
    const isPublicAuthRoute =
      segments[0] === "login" || segments[0] === "recuperar";
    if (!token && !isPublicAuthRoute) {
      if (profileReturnRoute.current || currentProtectedRoute) {
        pendingProtectedRoute.current = profileReturnRoute.current ?? currentProtectedRoute as Href;
      }
      if (
        (segments[0] as string) === "asistencia" &&
        typeof routeToken === "string" &&
        /^[A-Za-z0-9_-]{8,200}$/.test(routeToken)
      ) {
        pendingAttendanceToken.current = routeToken;
      }
      router.replace("/login");
    } else if (token && isPublicAuthRoute) {
      profileWasForced.current = false;
      profileReturnRoute.current = null;
      const pending = pendingAttendanceToken.current;
      pendingAttendanceToken.current = null;
      if (pending) {
        router.replace({ pathname: "/asistencia", params: { token: pending } });
      } else {
        const destination = pendingProtectedRoute.current;
        pendingProtectedRoute.current = null;
        router.replace(destination ?? "/(tabs)");
      }
    }
  }, [token, isLoading, segments, router, routeToken, currentProtectedRoute]);

  useEffect(() => {
    if (
      isLoading ||
      !isTeacher ||
      locked ||
      teachingProfileQuery.isPending
    ) {
      return;
    }

    const profile = teachingProfileQuery.data;
    const incomplete =
      teachingProfileQuery.isError ||
      !profile ||
      (profile.user.role === "teacher" ? profile.user.centerId : profile.user.teachingCenterId ?? profile.user.centerId) == null ||
      profile.targetProvinceId == null ||
      profile.targetCenterId !== (profile.user.role === "teacher" ? profile.user.centerId : profile.user.teachingCenterId ?? profile.user.centerId) ||
      (profile.user.role === "teacher" && profile.user.provinceId !== profile.targetProvinceId) ||
      (Boolean(profile.activeYear) &&
        profile.moduleIds.length === 0 &&
        !profile.doesNotTeach);

    if (incomplete) {
      if (
        pathname !== "/perfil" &&
        segments[0] !== "login" &&
        segments[0] !== "recuperar"
      ) {
        profileWasForced.current = true;
        if (profileReturnRoute.current == null && currentProtectedRoute) {
          profileReturnRoute.current = currentProtectedRoute as Href;
        }
        router.replace("/perfil");
      }
      return;
    }

    if (profileWasForced.current && pathname === "/perfil") {
      profileWasForced.current = false;
      const destination = profileReturnRoute.current;
      profileReturnRoute.current = null;
      router.replace(destination ?? "/(tabs)");
    }
  }, [
    isLoading,
    isTeacher,
    locked,
    teachingProfileQuery.data,
    teachingProfileQuery.isError,
    teachingProfileQuery.isPending,
    pathname,
    currentProtectedRoute,
    segments,
    router,
  ]);

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
  const blockForTeachingProfile =
    isTeacher &&
    !locked &&
    (teachingProfileQuery.isPending || teachingProfileQuery.isError);

  return (
    <View style={styles.navigator}>
      <View
        style={styles.navigator}
        pointerEvents={blockForTeachingProfile ? "none" : "auto"}
        accessibilityElementsHidden={blockForTeachingProfile}
        importantForAccessibility={blockForTeachingProfile ? "no-hide-descendants" : "auto"}
      >
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="login" />
        <Stack.Screen name="recuperar" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="chat/[id]" />
        <Stack.Screen name="new-chat" options={{ presentation: "modal" }} />
        <Stack.Screen name="new-group" options={{ presentation: "modal" }} />
        <Stack.Screen name="scan" options={{ presentation: "modal" }} />
        <Stack.Screen name="surveys" />
        <Stack.Screen name="survey/[id]" />
        <Stack.Screen name="form/[id]" />
        <Stack.Screen name="alerts" />
        <Stack.Screen name="foros" />
        <Stack.Screen name="foros/modulo/[id]" />
        <Stack.Screen name="foros/tema/[id]" />
        <Stack.Screen name="wiki/index" />
        <Stack.Screen name="wiki/[id]" />
        <Stack.Screen name="actas" />
        <Stack.Screen name="acta/[id]" />
        <Stack.Screen name="feedback" />
        <Stack.Screen name="perfil" />
        <Stack.Screen name="mis-certificados" />
        <Stack.Screen name="asistencia" />
        <Stack.Screen name="confirmar-curso" />
        <Stack.Screen name="lms" />
        <Stack.Screen name="lms/[id]" />
      </Stack>
      </View>
      {blockForTeachingProfile ? (
        <View
          style={[
            StyleSheet.absoluteFillObject,
            styles.profileGate,
            { backgroundColor: colors.background },
          ]}
        >
          {teachingProfileQuery.isError ? (
            <>
              <Text
                accessibilityRole="alert"
                style={[styles.profileGateMessage, { color: colors.foreground }]}
              >
                No se pudieron cargar tus datos docentes. Reintenta para poder completar o comprobar tu perfil.
              </Text>
              <Button
                label="Reintentar"
                onPress={() => void teachingProfileQuery.refetch()}
              />
              <Button label="Cerrar sesión" variant="ghost" onPress={() => void signOut()} />
            </>
          ) : <Loading />}
        </View>
      ) : null}
      {token && locked ? <AppLock /> : null}
    </View>
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
  const pathname = usePathname();
  if (Platform.OS !== "web") {
    return <>{children}</>;
  }
  // On real phones / installed PWA (narrow viewport) render edge-to-edge so the
  // blue header and tab bar reach the screen sides. Otherwise the muted backdrop
  // around the centered phone-width frame shows as light strips beside the
  // header. Keep the centered frame only on wide desktop browsers.
  // The LMS classroom has its own wide, two-column layout, so let it use the
  // available desktop/tablet width instead of squeezing that layout into the
  // phone frame.
  if (width < 600 || (pathname.startsWith("/lms/") && width >= 900)) {
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
  navigator: {
    flex: 1,
  },
  profileGate: {
    justifyContent: "center",
    padding: 24,
    gap: 16,
  },
  profileGateMessage: {
    fontFamily: "Inter_500Medium",
    fontSize: 16,
    textAlign: "center",
  },
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
