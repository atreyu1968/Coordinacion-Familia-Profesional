import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";

import {
  getGetMyYearConfirmationQueryKey,
  useGetMyYearConfirmation,
} from "@workspace/api-client-react";

import { useAuth } from "@/contexts/AuthContext";

// Amber palette mirroring the web banner (amber-50/300/600/800/900).
const AMBER_BG = "#fffbeb";
const AMBER_BORDER = "#fcd34d";
const AMBER_ICON = "#d97706";
const AMBER_TITLE = "#78350f";
const AMBER_BODY = "#92400e";

/**
 * Shows a tappable prompt when the logged-in teacher has a pending annual
 * confirmation for the active course. Tapping it opens the confirmation flow.
 * Renders nothing for non-teachers or when there is no pending window.
 */
export function TeacherConfirmationBanner() {
  const { user } = useAuth();
  const isTeacher = user?.role === "teacher";

  const { data: confirmation } = useGetMyYearConfirmation({
    query: {
      queryKey: getGetMyYearConfirmationQueryKey(),
      enabled: isTeacher,
    },
  });

  if (!isTeacher) return null;
  if (!confirmation || confirmation.status !== "pending") return null;

  const deadlineLabel = confirmation.deadline
    ? new Date(confirmation.deadline).toLocaleDateString("es-ES", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <Pressable
      onPress={() => router.push("/confirmar-curso")}
      style={({ pressed }) => [styles.banner, { opacity: pressed ? 0.85 : 1 }]}
    >
      <View style={styles.row}>
        <Feather name="alert-triangle" size={20} color={AMBER_ICON} />
        <View style={styles.textWrap}>
          <Text style={styles.title}>
            Confirma tu continuidad para el curso
            {confirmation.year ? ` ${confirmation.year}` : ""}
          </Text>
          <Text style={styles.body}>
            Es obligatorio confirmar tu centro y los módulos que impartes.
            {deadlineLabel
              ? ` Tienes hasta el ${deadlineLabel}; si no confirmas, tu cuenta se desactivará automáticamente.`
              : ""}
          </Text>
          <View style={styles.cta}>
            <Feather name="calendar" size={15} color={AMBER_ICON} />
            <Text style={styles.ctaText}>Confirmar ahora</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderWidth: 1,
    borderColor: AMBER_BORDER,
    backgroundColor: AMBER_BG,
    borderRadius: 12,
    padding: 14,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  textWrap: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: AMBER_TITLE,
  },
  body: {
    fontSize: 13.5,
    lineHeight: 19,
    fontFamily: "Inter_400Regular",
    color: AMBER_BODY,
  },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  ctaText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: AMBER_ICON,
  },
});
