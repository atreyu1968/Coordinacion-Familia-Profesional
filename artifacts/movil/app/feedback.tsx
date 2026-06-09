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
import { useQueryClient } from "@tanstack/react-query";

import {
  useListFeedback,
  useCreateFeedback,
  useUpdateFeedback,
  getListFeedbackQueryKey,
  type Feedback,
  type CreateFeedbackInputType,
  type UpdateFeedbackInputStatus,
} from "@workspace/api-client-react";

import { AppHeader } from "@/components/AppHeader";
import { Button, Card } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { formatDate } from "@/lib/format";

const TYPE_LABELS: Record<CreateFeedbackInputType, string> = {
  suggestion: "Sugerencia",
  incident: "Incidencia",
};

const STATUS_LABELS: Record<UpdateFeedbackInputStatus, string> = {
  open: "Abierta",
  reviewed: "En revisión",
  resolved: "Resuelta",
};

const STATUS_ORDER: UpdateFeedbackInputStatus[] = [
  "open",
  "reviewed",
  "resolved",
];

export default function FeedbackScreen() {
  const colors = useColors();
  const qc = useQueryClient();
  const { user } = useAuth();
  const canManage = user?.role === "superadmin";
  const createMut = useCreateFeedback();
  const updateMut = useUpdateFeedback();
  const { data: items = [] } = useListFeedback();

  const onSetStatus = async (id: number, status: UpdateFeedbackInputStatus) => {
    try {
      await updateMut.mutateAsync({ id, data: { status } });
      await qc.invalidateQueries({ queryKey: getListFeedbackQueryKey() });
    } catch {
      setError("No se pudo actualizar el estado.");
    }
  };

  const [type, setType] = useState<CreateFeedbackInputType>("suggestion");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  const bottomPad = Platform.OS === "web" ? 100 : 40;

  const onSubmit = async () => {
    if (!subject.trim() || !message.trim()) {
      setError("El asunto y el mensaje son obligatorios.");
      return;
    }
    setError(null);
    try {
      await createMut.mutateAsync({
        data: { type, subject: subject.trim(), message: message.trim() },
      });
      await qc.invalidateQueries({ queryKey: getListFeedbackQueryKey() });
      setSubject("");
      setMessage("");
      setType("suggestion");
    } catch {
      setError("No se pudo enviar. Inténtalo de nuevo.");
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
      <AppHeader title="Sugerencias" subtitle="Mejoras e incidencias" showBack />
      <KeyboardAwareScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]}
        keyboardShouldPersistTaps="handled"
        bottomOffset={20}
      >
        <Card style={styles.formCard}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>
            Enviar
          </Text>

          <View style={styles.typeRow}>
            {(Object.keys(TYPE_LABELS) as CreateFeedbackInputType[]).map((t) => {
              const active = type === t;
              return (
                <Pressable
                  key={t}
                  onPress={() => setType(t)}
                  style={[
                    styles.typeChip,
                    {
                      backgroundColor: active ? colors.primary : colors.card,
                      borderColor: active ? colors.primary : colors.border,
                      borderRadius: colors.radius,
                    },
                  ]}
                >
                  <Feather
                    name={t === "incident" ? "alert-triangle" : "zap"}
                    size={14}
                    color={active ? colors.primaryForeground : colors.mutedForeground}
                  />
                  <Text
                    style={[
                      styles.typeChipText,
                      {
                        color: active
                          ? colors.primaryForeground
                          : colors.mutedForeground,
                      },
                    ]}
                  >
                    {TYPE_LABELS[t]}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={[styles.label, { color: colors.foreground }]}>Asunto</Text>
          <TextInput
            value={subject}
            onChangeText={setSubject}
            placeholder="Resumen breve"
            placeholderTextColor={colors.mutedForeground}
            maxLength={140}
            style={inputStyle}
          />

          <Text style={[styles.label, { color: colors.foreground, marginTop: 14 }]}>
            Mensaje
          </Text>
          <TextInput
            value={message}
            onChangeText={setMessage}
            placeholder={
              type === "incident"
                ? "Describe el problema."
                : "Describe tu propuesta."
            }
            placeholderTextColor={colors.mutedForeground}
            multiline
            numberOfLines={4}
            style={[inputStyle, styles.textarea]}
          />

          {error ? (
            <Text style={[styles.error, { color: colors.destructive }]}>
              {error}
            </Text>
          ) : null}

          <Button
            label="Enviar"
            onPress={onSubmit}
            loading={createMut.isPending}
            style={{ marginTop: 18 }}
          />
        </Card>

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          {canManage ? "Todas las entradas" : "Mis envíos"} ({items.length})
        </Text>

        {items.length === 0 ? (
          <Text style={[styles.empty, { color: colors.mutedForeground }]}>
            {canManage
              ? "No hay sugerencias ni incidencias."
              : "Aún no has enviado ninguna sugerencia o incidencia."}
          </Text>
        ) : (
          items.map((item: Feedback) => (
            <Card key={item.id} style={styles.itemCard}>
              <View style={styles.itemHead}>
                <View
                  style={[styles.badge, { backgroundColor: colors.accent }]}
                >
                  <Text
                    style={[styles.badgeText, { color: colors.accentForeground }]}
                  >
                    {TYPE_LABELS[item.type as CreateFeedbackInputType]}
                  </Text>
                </View>
                {!canManage ? (
                  <Text
                    style={[styles.status, { color: colors.mutedForeground }]}
                  >
                    {STATUS_LABELS[item.status as UpdateFeedbackInputStatus] ??
                      item.status}
                  </Text>
                ) : null}
              </View>
              {canManage && item.userName ? (
                <Text style={[styles.author, { color: colors.mutedForeground }]}>
                  {item.userName}
                </Text>
              ) : null}
              <Text style={[styles.itemSubject, { color: colors.foreground }]}>
                {item.subject}
              </Text>
              <Text
                style={[styles.itemMessage, { color: colors.mutedForeground }]}
              >
                {item.message}
              </Text>
              <Text style={[styles.itemDate, { color: colors.mutedForeground }]}>
                {formatDate(String(item.createdAt))}
              </Text>
              {canManage ? (
                <View style={styles.statusRow}>
                  {STATUS_ORDER.map((s) => {
                    const active = item.status === s;
                    return (
                      <Pressable
                        key={s}
                        onPress={() => onSetStatus(item.id, s)}
                        disabled={updateMut.isPending}
                        style={[
                          styles.statusChip,
                          {
                            backgroundColor: active ? colors.primary : colors.card,
                            borderColor: active ? colors.primary : colors.border,
                            borderRadius: colors.radius,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusChipText,
                            {
                              color: active
                                ? colors.primaryForeground
                                : colors.mutedForeground,
                            },
                          ]}
                        >
                          {STATUS_LABELS[s]}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
            </Card>
          ))
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
  typeRow: { flexDirection: "row", gap: 10, marginBottom: 8 },
  typeChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  typeChipText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  label: { fontSize: 14, fontFamily: "Inter_500Medium", marginBottom: 8 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
  },
  textarea: { minHeight: 110, textAlignVertical: "top" },
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
    alignItems: "center",
    justifyContent: "space-between",
  },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  status: { fontSize: 12, fontFamily: "Inter_500Medium" },
  author: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: -2 },
  statusRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  statusChip: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  statusChipText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  itemSubject: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  itemMessage: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  itemDate: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 2 },
});
