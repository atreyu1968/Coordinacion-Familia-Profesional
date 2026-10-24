import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";

/** Generative cover derived only from course id and title (no invented imagery). */
const palettes = [
  ["#0b3d91", "#e8eef9", "#f2b134"],
  ["#123a5c", "#eaf2f0", "#2fa58a"],
  ["#3b2a6b", "#f1edf8", "#e66b4f"],
  ["#0f4c5c", "#e9f3f4", "#f08a24"],
  ["#5a1f2e", "#f8ecee", "#3e8ed0"],
  ["#1f3b2d", "#edf4ee", "#d9a441"],
];

export const lessonKindLabels: Record<string, string> = {
  text: "Lectura", file: "Archivo", video: "Vídeo", quiz: "Cuestionario", scorm12: "SCORM 1.2", scorm2004: "SCORM 2004",
};
export const lessonKindIcons: Record<string, React.ComponentProps<typeof Feather>["name"]> = {
  text: "file-text", file: "download", video: "play-circle", quiz: "check-square", scorm12: "package", scorm2004: "package",
};

export function LmsCourseCover({ id, title, height = 150, radius = 16 }: { id: number; title: string; height?: number; radius?: number }) {
  const [deep, light, accent] = palettes[id % palettes.length]!;
  const initials = title.split(/\s+/).filter((w) => w.length > 2).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || title.slice(0, 2).toUpperCase();
  const variant = id % 3;
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={[styles.cover, { height, borderRadius: radius, backgroundColor: deep }]}>
      {variant === 0 ? <>
        <View style={[styles.abs, { right: -height * 0.2, top: -height * 0.35, width: height * 1.05, height: height * 1.05, borderRadius: height, backgroundColor: accent }]} />
        <View style={[styles.abs, { left: 30, bottom: -height * 0.5, width: height * 0.9, height: height * 0.9, borderRadius: height, borderWidth: 12, borderColor: light, opacity: 0.18 }]} />
      </> : variant === 1 ? <>
        <View style={[styles.abs, { right: 0, top: 0, bottom: 0, width: "38%", backgroundColor: accent }]} />
        <View style={[styles.abs, { right: "8%", bottom: "14%", width: "20%", height: "30%", borderRadius: 3, backgroundColor: light, opacity: 0.85 }]} />
      </> : <>
        <View style={[styles.abs, { right: -10, bottom: -height * 0.2, width: height * 0.8, height: height * 0.85, borderTopLeftRadius: height, borderTopRightRadius: height, backgroundColor: accent }]} />
      </>}
      <Text style={[styles.initials, { color: light, fontSize: height * 0.32 }]}>{initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: { overflow: "hidden", width: "100%" },
  abs: { position: "absolute" },
  initials: { position: "absolute", left: 16, bottom: 10, fontFamily: "Inter_700Bold", letterSpacing: -2 },
});
