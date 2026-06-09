import React from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";

import { AppHeader } from "@/components/AppHeader";
import { InstallAppButton } from "@/components/InstallAppButton";
import { Avatar, Card } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { initials, roleLabel } from "@/lib/format";

export default function MoreScreen() {
  const colors = useColors();
  const { user, signOut } = useAuth();

  const items: {
    icon: React.ComponentProps<typeof Feather>["name"];
    label: string;
    onPress: () => void;
  }[] = [
    { icon: "maximize", label: "Escanear acreditación (QR)", onPress: () => router.push("/scan") },
    { icon: "bar-chart-2", label: "Encuestas y votaciones", onPress: () => router.push("/surveys") },
    { icon: "file-text", label: "Formularios", onPress: () => router.push("/formularios") },
    { icon: "briefcase", label: "Alertas de empresa (FCT)", onPress: () => router.push("/alerts") },
  ];

  const bottomPad = Platform.OS === "web" ? 100 : 90;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader title="Más" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]}>
        <Card style={styles.profile}>
          <Avatar text={initials(user?.name)} size={56} />
          <View style={styles.profileBody}>
            <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
              {user?.name ?? "Usuario"}
            </Text>
            <Text style={[styles.role, { color: colors.mutedForeground }]} numberOfLines={1}>
              {roleLabel(user?.role)}
            </Text>
          </View>
        </Card>

        <View style={styles.section}>
          {items.map((item, idx) => (
            <Pressable
              key={item.label}
              onPress={item.onPress}
              style={({ pressed }) => [
                styles.item,
                {
                  borderBottomColor: colors.border,
                  borderBottomWidth: idx === items.length - 1 ? 0 : StyleSheet.hairlineWidth,
                  backgroundColor: colors.card,
                  opacity: pressed ? 0.6 : 1,
                },
              ]}
            >
              <View style={[styles.iconWrap, { backgroundColor: colors.accent }]}>
                <Feather name={item.icon} size={18} color={colors.accentForeground} />
              </View>
              <Text style={[styles.itemLabel, { color: colors.foreground }]}>{item.label}</Text>
              <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
            </Pressable>
          ))}
        </View>

        <InstallAppButton />

        <Pressable
          onPress={signOut}
          style={({ pressed }) => [
            styles.logout,
            { borderColor: colors.border, borderRadius: colors.radius, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Feather name="log-out" size={18} color={colors.destructive} />
          <Text style={[styles.logoutText, { color: colors.destructive }]}>Cerrar sesión</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 20 },
  profile: { flexDirection: "row", alignItems: "center", gap: 14 },
  profileBody: { flex: 1, gap: 4 },
  name: { fontSize: 18, fontFamily: "Inter_700Bold" },
  role: { fontSize: 14, fontFamily: "Inter_400Regular" },
  section: {
    borderRadius: 12,
    overflow: "hidden",
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 14,
    gap: 14,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  itemLabel: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium" },
  logout: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  logoutText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
});
