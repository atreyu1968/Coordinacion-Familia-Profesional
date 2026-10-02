import React, { useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";

import {
  getGetMyTeachingProfileQueryKey,
  getListCentersQueryKey,
  useGetMyTeachingProfile,
  useListCenters,
  useUpdateMyTeachingProfile,
  useUpdateProfile,
  type User,
} from "@workspace/api-client-react";

import { AppHeader } from "@/components/AppHeader";
import { Button, Card } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

export default function PerfilScreen() {
  const colors = useColors();
  const router = useRouter();
  const { user, updateUser, signOut } = useAuth();
  const updateMut = useUpdateProfile();
  const queryClient = useQueryClient();
  const teachingProfileMut = useUpdateMyTeachingProfile();
  const isTeacher = user?.role === "teacher";

  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [teachingCenterId, setTeachingCenterId] = useState<number | null>(
    user?.centerId ?? null,
  );
  const [teachingModuleIds, setTeachingModuleIds] = useState<number[] | null>(
    null,
  );
  const [teachingError, setTeachingError] = useState<string | null>(null);
  const [teachingSuccess, setTeachingSuccess] = useState<string | null>(null);
  const [showCenterPicker, setShowCenterPicker] = useState(false);
  const [centerSearch, setCenterSearch] = useState("");
  const centersQuery = useListCenters(
    {},
    {
      query: {
        queryKey: getListCentersQueryKey({}),
        enabled: isTeacher,
      },
    },
  );
  const teachingProfileQuery = useGetMyTeachingProfile(
    { targetCenterId: teachingCenterId ?? undefined },
    {
      query: {
        queryKey: getGetMyTeachingProfileQueryKey({
          targetCenterId: teachingCenterId ?? undefined,
        }),
        enabled: isTeacher,
      },
    },
  );
  const profileMatchesSelection =
    teachingProfileQuery.data?.targetCenterId === teachingCenterId;
  const availableModules = profileMatchesSelection
    ? teachingProfileQuery.data?.modules ?? []
    : [];
  const selectedModuleIds =
    teachingModuleIds ??
    (profileMatchesSelection && teachingCenterId === user?.centerId
      ? teachingProfileQuery.data?.moduleIds ?? []
      : []);
  const modulesByCycle = availableModules.reduce<
    Record<string, typeof availableModules>
  >((groups, module) => {
    const cycle = module.cycleName?.trim() || "Otros módulos";
    (groups[cycle] ??= []).push(module);
    return groups;
  }, {});
  const selectedCenter =
    centersQuery.data?.find((center) => center.id === teachingCenterId) ?? null;
  const filteredCenters = (centersQuery.data ?? []).filter((center) =>
    center.name.toLocaleLowerCase().includes(centerSearch.trim().toLocaleLowerCase()),
  );

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
      if (wantsPasswordChange) {
        await signOut();
        router.replace({
          pathname: "/login",
          params: { message: "Contraseña actualizada. Inicia sesión de nuevo." },
        });
        return;
      }
      await updateUser(updated);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess("Perfil actualizado.");
    } catch {
      setError("No se pudo guardar. Revisa el correo o la contraseña actual.");
    }
  };

  const onTeachingCenterSelect = (centerId: number) => {
    setTeachingCenterId(centerId);
    setTeachingModuleIds(centerId === user?.centerId ? null : []);
    setShowCenterPicker(false);
    setCenterSearch("");
    setTeachingError(null);
    setTeachingSuccess(null);
  };

  const toggleTeachingModule = (moduleId: number) => {
    setTeachingModuleIds((current) => {
      const selected = current ?? selectedModuleIds;
      return selected.includes(moduleId)
        ? selected.filter((id) => id !== moduleId)
        : [...selected, moduleId];
    });
    setTeachingSuccess(null);
  };

  const onSaveTeachingProfile = async () => {
    setTeachingError(null);
    setTeachingSuccess(null);
    if (teachingCenterId == null) {
      setTeachingError("Selecciona tu centro.");
      return;
    }
    if (!teachingProfileQuery.data || teachingProfileQuery.isError) {
      setTeachingError("No se han podido cargar los datos de docencia.");
      return;
    }
    const moduleIds =
      teachingProfileQuery.data.activeYear == null ? [] : selectedModuleIds;

    try {
      const updated = await teachingProfileMut.mutateAsync({
        data: { centerId: teachingCenterId, moduleIds },
      });
      await updateUser(updated.user as User);
      setTeachingCenterId(updated.user.centerId ?? null);
      setTeachingModuleIds(updated.moduleIds);
      setTeachingSuccess("Centro y módulos actualizados.");
      await queryClient.invalidateQueries();
    } catch {
      setTeachingError("No se pudo guardar el centro y los módulos.");
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

        {isTeacher ? (
          <Card style={styles.formCard}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>
              Centro y docencia
            </Text>
            <Text style={[styles.hint, { color: colors.mutedForeground }]}>
              El cambio de centro se aplica de inmediato. La provincia se
              obtiene automáticamente del centro seleccionado.
              {teachingProfileQuery.data?.activeYear
                ? ` Puedes actualizar tus módulos del curso ${teachingProfileQuery.data.activeYear} en cualquier momento.`
                : ""}
            </Text>

            <Text style={[styles.label, { color: colors.foreground }]}>
              Centro
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Seleccionar centro"
              onPress={() => setShowCenterPicker((open) => !open)}
              style={({ pressed }) => [
                styles.centerSelector,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  borderRadius: colors.radius,
                  opacity: pressed ? 0.75 : 1,
                },
              ]}
            >
              <Text
                numberOfLines={2}
                style={[
                  styles.centerSelectorText,
                  { color: selectedCenter ? colors.foreground : colors.mutedForeground },
                ]}
              >
                {selectedCenter?.name ?? "Selecciona tu centro"}
              </Text>
              <Feather
                name={showCenterPicker ? "chevron-up" : "chevron-down"}
                size={18}
                color={colors.mutedForeground}
              />
            </Pressable>

            {showCenterPicker ? (
              <View
                style={[
                  styles.centerPicker,
                  { borderColor: colors.border, borderRadius: colors.radius },
                ]}
              >
                <TextInput
                  value={centerSearch}
                  onChangeText={setCenterSearch}
                  placeholder="Buscar centro"
                  placeholderTextColor={colors.mutedForeground}
                  style={[
                    inputStyle,
                    { margin: 8, paddingVertical: 9, fontSize: 14 },
                  ]}
                  accessibilityLabel="Buscar centro"
                />
                {centersQuery.isLoading ? (
                  <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                    Cargando centros…
                  </Text>
                ) : filteredCenters.length === 0 ? (
                  <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                    No se encontraron centros.
                  </Text>
                ) : (
                  <ScrollView
                    style={styles.centerList}
                    nestedScrollEnabled
                    keyboardShouldPersistTaps="handled"
                  >
                    {filteredCenters.map((center) => (
                      <Pressable
                        key={center.id}
                        accessibilityRole="button"
                        onPress={() => onTeachingCenterSelect(center.id)}
                        style={({ pressed }) => [
                          styles.centerOption,
                          {
                            backgroundColor:
                              center.id === teachingCenterId
                                ? colors.accent
                                : colors.card,
                            opacity: pressed ? 0.72 : 1,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.optionText,
                            { color: colors.foreground },
                          ]}
                        >
                          {center.name}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                )}
              </View>
            ) : null}

            <Text style={[styles.hint, { color: colors.mutedForeground }]}>
              Provincia:{" "}
              {profileMatchesSelection
                ? teachingProfileQuery.data?.targetProvinceName ??
                  "No consta para este centro"
                : "Se asigna automáticamente según el centro."}
            </Text>

            {teachingProfileQuery.data?.activeYear ? (
              <>
                <Text style={[styles.label, { color: colors.foreground }]}>
                  Módulos que impartes · {teachingProfileQuery.data.activeYear}
                </Text>
                {teachingProfileQuery.isLoading ? (
                  <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                    Cargando módulos…
                  </Text>
                ) : Object.entries(modulesByCycle).length === 0 ? (
                  <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                    No hay módulos disponibles para este centro.
                  </Text>
                ) : (
                  <View style={styles.moduleList}>
                    {Object.entries(modulesByCycle).map(([cycle, modules]) => (
                      <View key={cycle} style={styles.cycleGroup}>
                        <Text
                          style={[
                            styles.cycleTitle,
                            { color: colors.mutedForeground },
                          ]}
                        >
                          {cycle}
                        </Text>
                        {modules.map((module) => {
                          const active = selectedModuleIds.includes(module.id);
                          return (
                            <Pressable
                              key={module.id}
                              accessibilityRole="checkbox"
                              accessibilityState={{ checked: active }}
                              onPress={() => toggleTeachingModule(module.id)}
                              style={({ pressed }) => [
                                styles.moduleOption,
                                {
                                  borderColor: active
                                    ? colors.primary
                                    : colors.border,
                                  backgroundColor: active
                                    ? colors.accent
                                    : colors.card,
                                  borderRadius: colors.radius,
                                  opacity: pressed ? 0.72 : 1,
                                },
                              ]}
                            >
                              <Feather
                                name={active ? "check-square" : "square"}
                                size={18}
                                color={
                                  active
                                    ? colors.primary
                                    : colors.mutedForeground
                                }
                              />
                              <Text
                                style={[
                                  styles.optionText,
                                  { color: colors.foreground, flex: 1 },
                                ]}
                              >
                                {module.code ? `${module.code} · ` : ""}
                                {module.name}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    ))}
                  </View>
                )}
              </>
            ) : teachingProfileQuery.data ? (
              <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                No hay un curso académico activo. Puedes actualizar el centro;
                los módulos estarán disponibles cuando se active un curso.
              </Text>
            ) : null}

            {teachingError ? (
              <Text style={[styles.error, { color: colors.destructive }]}>
                {teachingError}
              </Text>
            ) : null}
            {teachingSuccess ? (
              <Text style={[styles.success, { color: colors.primary }]}>
                {teachingSuccess}
              </Text>
            ) : null}
            <Button
              label="Guardar datos docentes"
              onPress={onSaveTeachingProfile}
              loading={teachingProfileMut.isPending}
              disabled={teachingProfileQuery.isLoading || teachingProfileQuery.isError}
              style={{ marginTop: 4 }}
            />
          </Card>
        ) : null}

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
  centerSelector: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  centerSelectorText: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  centerPicker: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    maxHeight: 280,
  },
  centerList: {
    maxHeight: 210,
  },
  centerOption: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  optionText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  moduleList: { gap: 14 },
  cycleGroup: { gap: 6 },
  cycleTitle: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    marginTop: 3,
  },
  moduleOption: {
    minHeight: 42,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  error: { fontSize: 14, fontFamily: "Inter_400Regular" },
  success: { fontSize: 14, fontFamily: "Inter_500Medium" },
});
