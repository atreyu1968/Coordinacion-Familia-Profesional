import React, { useState } from "react";
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
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import {
  useForgotPassword,
  useResetPassword,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui";
import { useColors } from "@/hooks/useColors";

type Step = "email" | "code" | "done";

export default function RecuperarScreen() {
  const colors = useColors();
  const scheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const forgot = useForgotPassword();
  const reset = useResetPassword();

  const topInset = Platform.OS === "web" ? 67 : insets.top;

  const inputStyle = [
    styles.input,
    {
      backgroundColor: colors.card,
      borderColor: colors.border,
      color: colors.foreground,
      borderRadius: colors.radius,
    },
  ];

  const onRequest = async () => {
    if (!email.trim()) {
      setError("Introduce tu correo electrónico.");
      return;
    }
    setError(null);
    try {
      await forgot.mutateAsync({
        data: { email: email.trim().toLowerCase() },
      });
      setStep("code");
      if (Platform.OS !== "web") {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch {
      setError("No se pudo enviar el código. Inténtalo de nuevo.");
    }
  };

  const onReset = async () => {
    if (code.trim().length !== 6) {
      setError("Introduce el código de 6 dígitos.");
      return;
    }
    if (newPassword.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    setError(null);
    try {
      await reset.mutateAsync({
        data: {
          email: email.trim().toLowerCase(),
          code: code.trim(),
          newPassword,
        },
      });
      setStep("done");
      if (Platform.OS !== "web") {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch {
      setError(
        "Código no válido o caducado. Revisa tu correo o solicita uno nuevo.",
      );
      if (Platform.OS !== "web") {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
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
            scheme === "dark"
              ? require("@/assets/images/logo-white.png")
              : require("@/assets/images/logo.png")
          }
          style={styles.logo}
          resizeMode="contain"
        />

        {step === "email" && (
          <View style={styles.form}>
            <Text style={[styles.title, { color: colors.foreground }]}>
              Recuperar contraseña
            </Text>
            <Text style={[styles.hint, { color: colors.mutedForeground }]}>
              Introduce tu correo y te enviaremos un código de verificación.
            </Text>

            <Text
              style={[
                styles.label,
                { color: colors.foreground, marginTop: 24 },
              ]}
            >
              Correo electrónico
            </Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="nombre@coordinaadg.es"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              onSubmitEditing={onRequest}
              style={inputStyle}
            />

            {error ? (
              <Text style={[styles.error, { color: colors.destructive }]}>
                {error}
              </Text>
            ) : null}

            <Button
              label="Enviar código"
              onPress={onRequest}
              loading={forgot.isPending}
              style={{ marginTop: 24 }}
            />
          </View>
        )}

        {step === "code" && (
          <View style={styles.form}>
            <Text style={[styles.title, { color: colors.foreground }]}>
              Introduce el código
            </Text>
            <Text style={[styles.hint, { color: colors.mutedForeground }]}>
              Hemos enviado un código de 6 dígitos a {email}. Caduca en 15
              minutos.
            </Text>

            <Text
              style={[
                styles.label,
                { color: colors.foreground, marginTop: 24 },
              ]}
            >
              Código de verificación
            </Text>
            <TextInput
              value={code}
              onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              maxLength={6}
              style={[inputStyle, styles.codeInput]}
            />

            <Text
              style={[
                styles.label,
                { color: colors.foreground, marginTop: 16 },
              ]}
            >
              Nueva contraseña
            </Text>
            <TextInput
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="Mínimo 8 caracteres"
              placeholderTextColor={colors.mutedForeground}
              secureTextEntry
              autoComplete="new-password"
              onSubmitEditing={onReset}
              style={inputStyle}
            />

            {error ? (
              <Text style={[styles.error, { color: colors.destructive }]}>
                {error}
              </Text>
            ) : null}

            <Button
              label="Cambiar contraseña"
              onPress={onReset}
              loading={reset.isPending}
              style={{ marginTop: 24 }}
            />
            <Button
              label="Usar otro correo"
              variant="ghost"
              onPress={() => {
                setStep("email");
                setError(null);
                setCode("");
              }}
              style={{ marginTop: 8 }}
            />
          </View>
        )}

        {step === "done" && (
          <View style={styles.form}>
            <View style={styles.doneIcon}>
              <Feather name="check-circle" size={56} color={colors.primary} />
            </View>
            <Text
              style={[
                styles.title,
                { color: colors.foreground, textAlign: "center" },
              ]}
            >
              Contraseña actualizada
            </Text>
            <Text
              style={[
                styles.hint,
                { color: colors.mutedForeground, textAlign: "center" },
              ]}
            >
              Ya puedes iniciar sesión con tu nueva contraseña.
            </Text>
            <Button
              label="Ir a iniciar sesión"
              onPress={() => router.replace("/login")}
              style={{ marginTop: 24 }}
            />
          </View>
        )}

        {step !== "done" && (
          <View style={styles.backWrap}>
            <Button
              label="Volver a iniciar sesión"
              variant="ghost"
              onPress={() => router.replace("/login")}
            />
          </View>
        )}
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
    marginBottom: 24,
  },
  form: {
    width: "100%",
    maxWidth: 420,
  },
  title: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    marginBottom: 8,
  },
  hint: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
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
  codeInput: {
    textAlign: "center",
    fontSize: 24,
    letterSpacing: 8,
  },
  error: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    marginTop: 14,
  },
  doneIcon: {
    alignItems: "center",
    marginBottom: 16,
  },
  backWrap: {
    width: "100%",
    maxWidth: 420,
    marginTop: 16,
  },
});
