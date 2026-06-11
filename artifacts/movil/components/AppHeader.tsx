import React from "react";
import {
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";

import { useColors } from "@/hooks/useColors";

interface AppHeaderProps {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  right?: React.ReactNode;
  /** Show the brand logo above the title (used on the main/home screen). */
  logo?: boolean;
}

export function AppHeader({ title, subtitle, showBack, right, logo }: AppHeaderProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  // On web the safe-area inset is 0 inside a normal browser tab but reports the
  // real notch on an installed PWA; clamp to a small minimum so the header never
  // sits flush against the top, but never leave the large dead gap the old fixed
  // 67px value produced (which made the header look like it floated too low).
  const topInset =
    Platform.OS === "web" ? Math.max(insets.top, 12) : insets.top;

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: topInset + 10,
          backgroundColor: colors.background,
          borderBottomColor: colors.border,
        },
      ]}
    >
      {logo ? (
        <Image
          source={
            scheme === "dark"
              ? require("@/assets/images/logo-white.png")
              : require("@/assets/images/logo.png")
          }
          style={styles.logo}
          resizeMode="contain"
        />
      ) : null}
      <View style={styles.row}>
        {showBack ? (
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.5 : 1 }]}
          >
            <Feather name="chevron-left" size={26} color={colors.foreground} />
          </Pressable>
        ) : null}
        <View style={styles.titleWrap}>
          <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text
              style={[styles.subtitle, { color: colors.mutedForeground }]}
              numberOfLines={1}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
        {right ? <View style={styles.right}>{right}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingBottom: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  logo: {
    height: 30,
    width: 150,
    marginBottom: 12,
    marginLeft: -2,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  backBtn: {
    marginRight: 4,
    marginLeft: -8,
  },
  titleWrap: {
    flex: 1,
  },
  title: {
    fontSize: 27,
    lineHeight: 32,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 13.5,
    lineHeight: 18,
    fontFamily: "Inter_400Regular",
    marginTop: 3,
  },
  right: {
    marginLeft: 12,
  },
});
