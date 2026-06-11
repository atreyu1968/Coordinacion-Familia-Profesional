import { BlurView } from "expo-blur";
import { Tabs } from "expo-router";
import { Feather } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, View, useColorScheme } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useBadges } from "@/contexts/BadgesContext";
import { useColors } from "@/hooks/useColors";

export default function TabLayout() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const isDark = colorScheme === "dark";
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";
  const { unreadChats, unreadNotifications } = useBadges();

  const badge = (count: number) =>
    count > 0 ? (count > 99 ? "99+" : count) : undefined;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        headerShown: false,
        tabBarLabelStyle: { fontFamily: "Inter_500Medium", fontSize: 11 },
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : colors.background,
          borderTopWidth: isWeb ? 1 : StyleSheet.hairlineWidth,
          borderTopColor: colors.border,
          elevation: 0,
          // On web give the icon + label enough vertical room so the labels
          // (Tablón, Mensajes…) are never clipped, and add the bottom safe-area
          // inset so an installed PWA's home-indicator / system nav bar doesn't
          // overlap the buttons (the "white bar" at the bottom).
          ...(isWeb
            ? {
                height: 76 + insets.bottom,
                paddingTop: 8,
                paddingBottom: 14 + insets.bottom,
              }
            : {}),
        },
        tabBarIconStyle: isWeb ? { marginTop: 2 } : undefined,
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={100}
              tint={isDark ? "dark" : "light"}
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} />
          ) : null,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Tablón",
          tabBarIcon: ({ color }) => <Feather name="layout" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: "Mensajes",
          tabBarBadge: badge(unreadChats),
          tabBarBadgeStyle: { backgroundColor: colors.primary, color: "#fff" },
          tabBarIcon: ({ color }) => (
            <Feather name="message-circle" size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: "Avisos",
          tabBarBadge: badge(unreadNotifications),
          tabBarBadgeStyle: { backgroundColor: colors.primary, color: "#fff" },
          tabBarIcon: ({ color }) => <Feather name="bell" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="formularios"
        options={{
          title: "Formularios",
          tabBarIcon: ({ color }) => (
            <Feather name="file-text" size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: "Más",
          tabBarIcon: ({ color }) => <Feather name="grid" size={22} color={color} />,
        }}
      />
    </Tabs>
  );
}
