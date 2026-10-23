import React from "react";
import { Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";

export function isPdfDocument(fileName?: string | null, contentType?: string | null) {
  return contentType?.split(";")[0]?.trim().toLowerCase() === "application/pdf"
    || /\.pdf$/i.test(fileName ?? "");
}

export function PdfPreviewButton({
  uri,
  title,
  color,
  compact = false,
  onPress,
}: {
  uri?: string;
  title: string;
  color?: string;
  compact?: boolean;
  onPress?: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Ver PDF: ${title}`}
      hitSlop={10}
      onPress={onPress ?? (() => {
        if (uri) router.push({ pathname: "/pdf-viewer", params: { uri, title } });
      })}
      style={({ pressed }) => ({ minWidth: compact ? 36 : 44, minHeight: compact ? 36 : 44, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
    >
      <Feather name="eye" size={18} color={color ?? colors.primary} />
    </Pressable>
  );
}
