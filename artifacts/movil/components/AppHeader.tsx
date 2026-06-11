import React from "react";
import {
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";

// Corporate header: brand blue bar with the white "AG" mark beside the title,
// mirroring the web app while keeping the work area as tall as possible.
const BRAND = "#0050b3";
const HEADER_FG = "#ffffff";
const HEADER_FG_MUTED = "rgba(255,255,255,0.82)";

interface AppHeaderProps {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  right?: React.ReactNode;
}

export function AppHeader({ title, subtitle, showBack, right }: AppHeaderProps) {
  const insets = useSafeAreaInsets();
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
          paddingLeft: 16 + insets.left,
          paddingRight: 16 + insets.right,
        },
      ]}
    >
      <View style={styles.row}>
        {showBack ? (
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.5 : 1 }]}
          >
            <Feather name="chevron-left" size={26} color={HEADER_FG} />
          </Pressable>
        ) : null}
        <Image
          source={require("@/assets/images/icon-mark.png")}
          style={styles.mark}
          resizeMode="contain"
        />
        <View style={styles.titleWrap}>
          <Text style={[styles.title, { color: HEADER_FG }]} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text
              style={[styles.subtitle, { color: HEADER_FG_MUTED }]}
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
    backgroundColor: BRAND,
    ...Platform.select({
      web: { boxShadow: "0 1px 4px rgba(0, 0, 0, 0.12)" } as object,
      default: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.12,
        shadowRadius: 4,
        elevation: 3,
      },
    }),
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  backBtn: {
    marginRight: 4,
    marginLeft: -8,
  },
  mark: {
    width: 34,
    height: 34,
    marginRight: 11,
    tintColor: "#ffffff",
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
