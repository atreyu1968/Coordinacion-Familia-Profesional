import React, { useCallback, useEffect, useState } from "react";
import {
  Image,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";

import { Button } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useBrandingAssets } from "@/lib/branding";

export default function LoginScreen() {
  const colors = useColors();
  const scheme = useColorScheme();
  const { logoUri } = useBrandingAssets();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    signIn,
    loginWithBiometric,
    hasLockedSession,
    biometricEnabled,
    biometricAvailable,
  } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [bioLoading, setBioLoading] = useState(false);

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const showBiometric = hasLockedSession && biometricEnabled && biometricAvailable;

  const onBiometric = useCallback(async () => {
    setError(null);
    setBioLoading(true);
    try {
      const ok = await loginWithBiometric();
      if (!ok) {
        setError("No se pudo verificar. Inténtalo de nuevo o usa tu contraseña.");
        if (Platform.OS !== "web") {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        }
      }
    } finally {
      setBioLoading(false);
    }
  }, [loginWithBiometric]);

  // Prompt for biometrics automatically when a saved session is locked.
  useEffect(() => {
    if (showBiometric) {
      void onBiometric();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBiometric]);

  const onSubmit = async () => {
    if (!email.trim() || !password) {
      setError("Introduce tu correo y contraseña.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await signIn(email.trim().toLowerCase(), password);
      if (Platform.OS !== "web") {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch {
      setError("Credenciales incorrectas. Inténtalo de nuevo.");
      if (Platform.OS !== "web") {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAwareScrollView
        contentContainerStyle={[styles.content, { paddingTop: topInset + 60 }]}
        keyboardShouldPersistTaps="handled"
        bottomOffset={20}
      >
        <Image
          source={
            logoUri
              ? { uri: logoUri }
              : scheme === "dark"
                ? require("@/assets/images/logo-white.png")
                : require("@/assets/images/logo.png")
          }
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Coordinación de Administración y Gestión · Canarias
        </Text>

        <View style={styles.form}>
          {showBiometric ? (
            <View style={styles.bioBlock}>
              <Button
                label="Entrar con huella / Face ID"
                icon="unlock"
                onPress={onBiometric}
                loading={bioLoading}
              />
              <Text style={[styles.bioHint, { color: colors.mutedForeground }]}>
                o inicia sesión con tu contraseña
              </Text>
            </View>
          ) : null}

          <Text style={[styles.label, { color: colors.foreground }]}>Correo electrónico</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="nombre@coordinaadg.es"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            style={[
              styles.input,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                color: colors.foreground,
                borderRadius: colors.radius,
              },
            ]}
          />

          <Text style={[styles.label, { color: colors.foreground, marginTop: 16 }]}>
            Contraseña
          </Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            placeholderTextColor={colors.mutedForeground}
            secureTextEntry
            autoComplete="password"
            onSubmitEditing={onSubmit}
            style={[
              styles.input,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                color: colors.foreground,
                borderRadius: colors.radius,
              },
            ]}
          />

          {error ? (
            <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text>
          ) : null}

          <Button
            label="Iniciar sesión"
            onPress={onSubmit}
            loading={loading}
            style={{ marginTop: 24 }}
          />
          <Button
            label="¿Has olvidado tu contraseña?"
            variant="ghost"
            onPress={() => router.push("/recuperar")}
            style={{ marginTop: 8 }}
          />
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    paddingHorizontal: 24,
    paddingBottom: 40,
    alignItems: "center",
  },
  logo: {
    width: 240,
    height: 56,
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginTop: 4,
    lineHeight: 20,
  },
  form: {
    width: "100%",
    maxWidth: 420,
    marginTop: 40,
  },
  label: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    marginBottom: 8,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
  },
  error: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    marginTop: 14,
  },
  bioBlock: {
    marginBottom: 28,
    gap: 12,
    alignItems: "center",
  },
  bioHint: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
});
