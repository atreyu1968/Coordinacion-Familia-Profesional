import {
  Pressable,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import type { ReactNode } from "react";

export type HiddenChatMessage = {
  id: number;
  content: string;
  deleted?: boolean;
  attachmentName?: string | null;
  createdAt: string | Date;
};

export function ChatMessageVisibilityActions({
  onHide,
  onDelete,
  itemStyle,
  textStyle,
  destructiveColor,
  hideIcon,
  deleteIcon,
}: {
  onHide: () => void;
  onDelete: () => void;
  itemStyle: StyleProp<ViewStyle>;
  textStyle: StyleProp<TextStyle>;
  destructiveColor: string;
  hideIcon?: ReactNode;
  deleteIcon?: ReactNode;
}) {
  return (
    <>
      <Pressable
        style={itemStyle}
        onPress={onHide}
        accessibilityRole="button"
        accessibilityLabel="Ocultar solo para mí"
      >
        {hideIcon}
        <Text style={textStyle}>Ocultar solo para mí</Text>
      </Pressable>
      <Pressable
        style={itemStyle}
        onPress={onDelete}
        accessibilityRole="button"
        accessibilityLabel="Eliminar para todos"
      >
        {deleteIcon}
        <Text style={[textStyle, { color: destructiveColor }]}>Eliminar para todos</Text>
      </Pressable>
    </>
  );
}

export function HiddenChatMessageRow({
  message,
  subtitle,
  foregroundColor,
  mutedColor,
  primaryColor,
  borderColor,
  disabled = false,
  onRestore,
}: {
  message: HiddenChatMessage;
  subtitle: string;
  foregroundColor: string;
  mutedColor: string;
  primaryColor: string;
  borderColor: string;
  disabled?: boolean;
  onRestore: () => void;
}) {
  return (
    <View
      accessibilityLabel={`Mensaje oculto ${message.id}`}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 0.5,
        borderBottomColor: borderColor,
      }}
    >
      <View style={{ flex: 1, gap: 4 }}>
      <Text style={{ color: message.deleted ? mutedColor : foregroundColor, fontStyle: message.deleted ? "italic" : "normal" }}>
        {message.deleted
          ? "Mensaje eliminado para todos"
          : message.content || message.attachmentName || "Archivo adjunto"}
      </Text>
      <Text style={{ color: mutedColor, fontSize: 12 }}>{subtitle}</Text>
      </View>
      {!message.deleted ? (
        <Pressable
          onPress={onRestore}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel="Restaurar mensaje"
        >
          <Text style={{ color: primaryColor, fontFamily: "Inter_600SemiBold" }}>
            Restaurar
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
