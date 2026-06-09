import React, { useMemo, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { useListForumModules, type ForumModule } from "@workspace/api-client-react";

import { AppHeader } from "@/components/AppHeader";
import { Card, EmptyState, Loading } from "@/components/ui";
import { useColors } from "@/hooks/useColors";

const SIN_CICLO = "Sin ciclo";

export default function ForosScreen() {
  const colors = useColors();
  const router = useRouter();
  const { data: modules = [], isLoading } = useListForumModules();
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return modules;
    return modules.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        (m.code ?? "").toLowerCase().includes(q) ||
        (m.cycleName ?? "").toLowerCase().includes(q),
    );
  }, [modules, search]);

  const groups = useMemo(() => {
    const map = new Map<string, ForumModule[]>();
    for (const m of filtered) {
      const key = m.cycleName ?? SIN_CICLO;
      const list = map.get(key) ?? [];
      list.push(m);
      map.set(key, list);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const bottomPad = Platform.OS === "web" ? 100 : 40;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader title="Foros" subtitle="Debates por módulo" showBack />
      {isLoading ? (
        <Loading />
      ) : modules.length === 0 ? (
        <EmptyState
          icon="message-square"
          title="Sin foros"
          message="No hay módulos disponibles para tu ámbito."
        />
      ) : (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]}>
          <View
            style={[
              styles.searchBar,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderRadius: colors.radius,
              },
            ]}
          >
            <Feather name="search" size={16} color={colors.mutedForeground} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Buscar módulo o ciclo"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.searchInput, { color: colors.foreground }]}
            />
          </View>

          {groups.length === 0 ? (
            <EmptyState
              icon="search"
              title="Sin resultados"
              message="Ningún módulo coincide con tu búsqueda."
            />
          ) : (
            groups.map(([cycle, mods]) => (
              <View key={cycle} style={styles.group}>
                <Text style={[styles.cycle, { color: colors.mutedForeground }]}>
                  {cycle.toUpperCase()}
                </Text>
                {mods.map((m) => (
                  <Pressable
                    key={m.id}
                    onPress={() =>
                      router.push({
                        pathname: "/foros/modulo/[id]",
                        params: { id: String(m.id), name: m.name, cycle: m.cycleName ?? "" },
                      })
                    }
                    style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                  >
                    <Card style={styles.itemCard}>
                      <View style={[styles.iconWrap, { backgroundColor: colors.accent }]}>
                        <Feather name="message-square" size={18} color={colors.accentForeground} />
                      </View>
                      <View style={styles.itemBody}>
                        <Text
                          style={[styles.itemTitle, { color: colors.foreground }]}
                          numberOfLines={2}
                        >
                          {m.name}
                        </Text>
                        {m.code ? (
                          <Text style={[styles.itemMeta, { color: colors.mutedForeground }]}>
                            {m.code}
                          </Text>
                        ) : null}
                      </View>
                      <View style={styles.badges}>
                        {m.unreadCount > 0 ? (
                          <View style={[styles.unread, { backgroundColor: colors.primary }]}>
                            <Text style={[styles.unreadText, { color: colors.primaryForeground }]}>
                              {m.unreadCount}
                            </Text>
                          </View>
                        ) : null}
                        <View style={[styles.badge, { backgroundColor: colors.accent }]}>
                          <Text style={[styles.badgeText, { color: colors.accentForeground }]}>
                            {m.threadCount}
                          </Text>
                        </View>
                      </View>
                    </Card>
                  </Pressable>
                ))}
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 18 },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchInput: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular", padding: 0 },
  group: { gap: 10 },
  cycle: { fontSize: 12, fontFamily: "Inter_600SemiBold", letterSpacing: 0.5 },
  itemCard: { flexDirection: "row", alignItems: "center", gap: 14 },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  itemBody: { flex: 1, gap: 3 },
  itemTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  itemMeta: { fontSize: 12, fontFamily: "Inter_400Regular" },
  badges: { flexDirection: "row", alignItems: "center", gap: 6 },
  unread: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  unreadText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  badge: {
    minWidth: 28,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
