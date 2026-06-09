import React, { useState } from "react";
import { Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { useUpdateProfile, type User } from "@workspace/api-client-react";

import { AppHeader } from "@/components/AppHeader";
import { Button, Card } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

export default function PerfilScreen() {
  const colors = useColors();
  const { user, updateUser } = useAuth();
  const updateMut = useUpdateProfile();

  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const bottomPad = Platform.OS === "web" ? 100 : 40;

  const onSubmit = async () => {
    setError(null);
    setSuccess(null);

    if (!name.trim()) {
      setError("El nombre es obligatorio.");
      return;
    }
    if (!email.trim()) {
      setError("El correo es obligatorio.");
      return;
    }

    const wantsPasswordChange =
      currentPassword.length > 0 ||
      newPassword.length > 0 ||
      confirmPassword.length > 0;

    if (wantsPasswordChange) {
      if (newPassword.length < 8) {
        setError("La nueva contraseña debe tener al menos 8 caracteres.");
        return;
      }
      if (newPassword !== confirmPassword) {
        setError("Las contraseñas no coinciden.");
        return;
      }
      if (!currentPassword) {
        setError("Introduce tu contraseña actual.");
        return;
      }
    }

    try {
      const updated = (await updateMut.mutateAsync({
        data: {
          name: name.trim(),
          email: email.trim(),
          ...(wantsPasswordChange ? { currentPassword, newPassword } : {}),
        },
      })) as User;
      await updateUser(updated);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess("Perfil actualizado.");
    } catch {
      setError("No se pudo guardar. Revisa el correo o la contraseña actual.");
    }
  };

  const inputStyle = [
    styles.input,
    {
      backgroundColor: colors.card,
      borderColor: colors.border,
      color: colors.foreground,
      borderRadius: colors.radius,
    },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader title="Editar perfil" subtitle="Tus datos de cuenta" showBack />
      <KeyboardAwareScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]}
        keyboardShouldPersistTaps="handled"
        bottomOffset={20}
      >
        <Card style={styles.formCard}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>
            Datos personales
          </Text>

          <Text style={[styles.label, { color: colors.foreground }]}>
            Nombre completo
          </Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Tu nombre y apellidos"
            placeholderTextColor={colors.mutedForeground}
            style={inputStyle}
          />

          <Text style={[styles.label, { color: colors.foreground, marginTop: 14 }]}>
            Correo electrónico
          </Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="tu@centro.es"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            keyboardType="email-address"
            style={inputStyle}
          />
        </Card>

        <Card style={styles.formCard}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>
            Cambiar contraseña
          </Text>
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>
            Déjalo en blanco si no quieres cambiarla.
          </Text>

          <Text style={[styles.label, { color: colors.foreground }]}>
            Contraseña actual
          </Text>
          <TextInput
            value={currentPassword}
            onChangeText={setCurrentPassword}
            placeholder="••••••••"
            placeholderTextColor={colors.mutedForeground}
            secureTextEntry
            autoCapitalize="none"
            style={inputStyle}
          />

          <Text style={[styles.label, { color: colors.foreground, marginTop: 14 }]}>
            Nueva contraseña
          </Text>
          <TextInput
            value={newPassword}
            onChangeText={setNewPassword}
            placeholder="Mínimo 8 caracteres"
            placeholderTextColor={colors.mutedForeground}
            secureTextEntry
            autoCapitalize="none"
            style={inputStyle}
          />

          <Text style={[styles.label, { color: colors.foreground, marginTop: 14 }]}>
            Repite la nueva contraseña
          </Text>
          <TextInput
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="••••••••"
            placeholderTextColor={colors.mutedForeground}
            secureTextEntry
            autoCapitalize="none"
            style={inputStyle}
          />
        </Card>

        {error ? (
          <Text style={[styles.error, { color: colors.destructive }]}>
            {error}
          </Text>
        ) : null}
        {success ? (
          <Text style={[styles.success, { color: colors.primary }]}>
            {success}
          </Text>
        ) : null}

        <Button
          label="Guardar cambios"
          onPress={onSubmit}
          loading={updateMut.isPending}
          style={{ marginTop: 4 }}
        />
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 16 },
  formCard: { gap: 6 },
  cardTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", marginBottom: 6 },
  hint: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 6 },
  label: { fontSize: 14, fontFamily: "Inter_500Medium", marginBottom: 8 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
  },
  error: { fontSize: 14, fontFamily: "Inter_400Regular" },
  success: { fontSize: 14, fontFamily: "Inter_500Medium" },
});
