import React, { useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";

import {
  useListMeetings,
  useCreateMeeting,
  useDeleteMeeting,
  getListMeetingsQueryKey,
  type Meeting,
} from "@workspace/api-client-react";

import { AppHeader } from "@/components/AppHeader";
import { Button, Card } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { formatDate } from "@/lib/format";
import { startCall } from "@/lib/call";

export default function VideoconferenciasScreen() {
  const colors = useColors();
  const qc = useQueryClient();
  const router = useRouter();
  const { user } = useAuth();
  const canCreate =
    user?.role === "superadmin" || user?.role === "coordinator";

  const createMut = useCreateMeeting();
  const deleteMut = useDeleteMeeting();
  const { data: items = [] } = useListMeetings();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const bottomPad = Platform.OS === "web" ? 100 : 40;

  const onJoin = (meeting: Meeting, audioOnly: boolean) => {
    startCall(router, {
      room: meeting.roomName,
      title: meeting.title,
      audioOnly,
    });
  };

  const onCreate = async () => {
    if (!title.trim()) {
      setError("El título es obligatorio.");
      return;
    }
    setError(null);
    try {
      await createMut.mutateAsync({
        data: {
          title: title.trim(),
          description: description.trim() || null,
          scheduledAt: null,
        },
      });
      await qc.invalidateQueries({ queryKey: getListMeetingsQueryKey() });
      setTitle("");
      setDescription("");
    } catch {
      setError("No se pudo crear la sala. Inténtalo de nuevo.");
    }
  };

  const onDelete = async (id: number) => {
    try {
      await deleteMut.mutateAsync({ id });
      await qc.invalidateQueries({ queryKey: getListMeetingsQueryKey() });
    } catch {
      setError("No se pudo eliminar la sala.");
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
      <AppHeader
        title="Videoconferencias"
        subtitle="Salas de reunión"
        showBack
      />
      <KeyboardAwareScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]}
        keyboardShouldPersistTaps="handled"
        bottomOffset={20}
      >
        {canCreate ? (
          <Card style={styles.formCard}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>
              Nueva sala
            </Text>

            <Text style={[styles.label, { color: colors.foreground }]}>
              Título
            </Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Ej. Reunión de coordinación"
              placeholderTextColor={colors.mutedForeground}
              maxLength={140}
              style={inputStyle}
            />

            <Text
              style={[styles.label, { color: colors.foreground, marginTop: 14 }]}
            >
              Descripción
            </Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Tema o detalles (opcional)"
              placeholderTextColor={colors.mutedForeground}
              multiline
              numberOfLines={3}
              style={[inputStyle, styles.textarea]}
            />

            {error ? (
              <Text style={[styles.error, { color: colors.destructive }]}>
                {error}
              </Text>
            ) : null}

            <Button
              label="Crear sala"
              onPress={onCreate}
              loading={createMut.isPending}
              style={{ marginTop: 18 }}
            />
          </Card>
        ) : null}

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          Salas disponibles ({items.length})
        </Text>

        {items.length === 0 ? (
          <Text style={[styles.empty, { color: colors.mutedForeground }]}>
            No hay salas disponibles por ahora.
          </Text>
        ) : (
          items.map((item: Meeting) => {
            const canDelete =
              user?.role === "superadmin" || item.hostId === user?.id;
            return (
              <Card key={item.id} style={styles.itemCard}>
                <View style={styles.itemHead}>
                  <Text
                    style={[styles.itemTitle, { color: colors.foreground }]}
                    numberOfLines={2}
                  >
                    {item.title}
                  </Text>
                  {canDelete ? (
                    <Pressable
                      onPress={() => onDelete(item.id)}
                      disabled={deleteMut.isPending}
                      hitSlop={8}
                    >
                      <Feather
                        name="trash-2"
                        size={18}
                        color={colors.destructive}
                      />
                    </Pressable>
                  ) : null}
                </View>

                {item.description ? (
                  <Text
                    style={[
                      styles.itemDesc,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    {item.description}
                  </Text>
                ) : null}

                <View style={styles.metaRow}>
                  {item.hostName ? (
                    <Text
                      style={[styles.meta, { color: colors.mutedForeground }]}
                    >
                      {item.hostName}
                    </Text>
                  ) : null}
                  {item.scheduledAt ? (
                    <Text
                      style={[styles.meta, { color: colors.mutedForeground }]}
                    >
                      {formatDate(String(item.scheduledAt))}
                    </Text>
                  ) : null}
                </View>

                <View style={styles.actions}>
                  <Button
                    label="Vídeo"
                    icon="video"
                    onPress={() => onJoin(item, false)}
                    style={styles.actionBtn}
                  />
                  <Button
                    label="Audio"
                    icon="phone"
                    variant="secondary"
                    onPress={() => onJoin(item, true)}
                    style={styles.actionBtn}
                  />
                </View>
              </Card>
            );
          })
        )}
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 16 },
  formCard: { gap: 6 },
  cardTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", marginBottom: 6 },
  label: { fontSize: 14, fontFamily: "Inter_500Medium", marginBottom: 8 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
  },
  textarea: { minHeight: 90, textAlignVertical: "top" },
  error: { fontSize: 14, fontFamily: "Inter_400Regular", marginTop: 12 },
  sectionTitle: { fontSize: 16, fontFamily: "Inter_700Bold", marginTop: 4 },
  empty: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    paddingVertical: 20,
  },
  itemCard: { gap: 6 },
  itemHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  itemTitle: { flex: 1, fontSize: 16, fontFamily: "Inter_600SemiBold" },
  itemDesc: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 2 },
  meta: { fontSize: 12, fontFamily: "Inter_500Medium" },
  actions: { flexDirection: "row", gap: 10, marginTop: 12 },
  actionBtn: { flex: 1 },
});
