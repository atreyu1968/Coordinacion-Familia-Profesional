import React, { useEffect, useState } from "react";
import {
  Image,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

/**
 * Full-screen lock overlay shown when the app is resumed while signed in with
 * biometric unlock enabled. Asks for biometrics first, with a clear password
 * fallback. The saved session stays intact behind the overlay.
 */
export function AppLock() {
  const colors = useColors();
  const scheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const { unlock, unlockWithPassword, biometricAvailable, user } = useAuth();

  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tryBiometric = async () => {
    setError(null);
    setBusy(true);
    try {
      const ok = await unlock();
      if (!ok) setError("No se pudo verificar. Inténtalo de nuevo o usa tu contraseña.");
    } finally {
      setBusy(false);
    }
  };

  // Prompt for biometrics automatically when the overlay appears.
  useEffect(() => {
    if (biometricAvailable) {
      void tryBiometric();
    } else {
      setUsePassword(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSubmitPassword = async () => {
    if (!password) {
      setError("Introduce tu contraseña.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const ok = await unlockWithPassword(password);
      if (!ok) setError("Contraseña incorrecta.");
      else setPassword("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View
      style={[
        styles.overlay,
        { backgroundColor: colors.background, paddingTop: insets.top + 80 },
      ]}
    >
      <Image
        source={
          scheme === "dark"
            ? require("@/assets/images/logo-white.png")
            : require("@/assets/images/logo.png")
        }
        style={styles.logo}
        resizeMode="contain"
      />
      <Text style={[styles.title, { color: colors.foreground }]}>App bloqueada</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        {user?.name
          ? `Hola, ${user.name.split(" ")[0]}. Verifica tu identidad para continuar.`
          : "Verifica tu identidad para continuar."}
      </Text>

      <View style={styles.actions}>
        {biometricAvailable && (
          <Button
            label="Desbloquear con huella / Face ID"
            icon="unlock"
            onPress={tryBiometric}
            loading={busy && !usePassword}
          />
        )}

        {usePassword ? (
          <View style={styles.passwordBlock}>
            <Text style={[styles.label, { color: colors.foreground }]}>Contraseña</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor={colors.mutedForeground}
              secureTextEntry
              autoComplete="password"
              onSubmitEditing={onSubmitPassword}
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
            <Button
              label="Entrar"
              onPress={onSubmitPassword}
              loading={busy}
              style={{ marginTop: 14 }}
            />
          </View>
        ) : (
          <Button
            label="Usar contraseña"
            variant="ghost"
            onPress={() => {
              setError(null);
              setUsePassword(true);
            }}
          />
        )}

        {error ? (
          <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
    alignItems: "center",
    paddingHorizontal: 24,
  },
  logo: { width: 220, height: 52, marginBottom: 28 },
  title: { fontSize: 22, fontFamily: "Inter_700Bold" },
  subtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginTop: 8,
    lineHeight: 20,
  },
  actions: { width: "100%", maxWidth: 420, marginTop: 36, gap: 12 },
  passwordBlock: { width: "100%" },
  label: { fontSize: 14, fontFamily: "Inter_500Medium", marginBottom: 8 },
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
    textAlign: "center",
    marginTop: 6,
  },
});
