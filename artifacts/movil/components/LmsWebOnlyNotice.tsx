import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { AppHeader } from "./AppHeader";
import { useColors } from "../hooks/useColors";

/** Mobile/PWA courses are informational only; learning remains on desktop web. */
export default function LmsWebOnlyNotice() {
  const colors = useColors();
  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]} testID="lms-web-only">
      <AppHeader title="Cursos autodirigidos" showBack />
      <View style={[styles.notice, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Disponible en la aplicación web</Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>
          Para realizar los cursos, accede a la aplicación web desde un ordenador.
          Los cursos no se pueden realizar desde la app móvil ni desde la PWA.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  notice: { margin: 20, padding: 20, borderWidth: 1, borderRadius: 16, gap: 12 },
  title: { fontSize: 20, fontFamily: "Inter_600SemiBold" },
  body: { fontSize: 16, lineHeight: 24, fontFamily: "Inter_400Regular" },
});
