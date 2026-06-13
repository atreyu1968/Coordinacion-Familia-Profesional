import React, { useMemo, useState } from "react";
import {
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";

import {
  useListChatGroups,
  type ChatGroup,
} from "@workspace/api-client-react";

import { AppHeader } from "@/components/AppHeader";
import { Avatar, EmptyState, ErrorState, Loading } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { formatRelative, initials } from "@/lib/format";

export default function ChatListScreen() {
  const colors = useColors();
  const { data, isLoading, isError, refetch, isRefetching } = useListChatGroups();
  const [search, setSearch] = useState("");

  useFocusEffect(
    React.useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  const bottomPad = Platform.OS === "web" ? 100 : 90;

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const groups = data ?? [];
    if (!term) return groups;
    return groups.filter((g) => g.name.toLowerCase().includes(term));
  }, [data, search]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader
        title="Mensajes"
        right={
          <Pressable
            onPress={() => router.push("/new-chat")}
            hitSlop={12}
            style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
          >
            <Feather name="edit" size={22} color="#ffffff" />
          </Pressable>
        }
      />
      {isLoading ? (
        <Loading />
      ) : isError ? (
        <ErrorState onRetry={refetch} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item: ChatGroup) => String(item.id)}
          contentContainerStyle={{ paddingBottom: bottomPad, flexGrow: 1 }}
          onRefresh={refetch}
          refreshing={isRefetching}
          scrollEnabled={filtered.length > 0}
          ListHeaderComponent={
            (data ?? []).length > 0 ? (
              <View style={styles.searchWrap}>
                <View
                  style={[
                    styles.searchBox,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                      borderRadius: colors.radius,
                    },
                  ]}
                >
                  <Feather name="search" size={18} color={colors.mutedForeground} />
                  <TextInput
                    value={search}
                    onChangeText={setSearch}
                    placeholder="Buscar conversaciones"
                    placeholderTextColor={colors.mutedForeground}
                    autoCapitalize="none"
                    style={[styles.searchInput, { color: colors.foreground }]}
                  />
                  {search.length > 0 ? (
                    <Pressable onPress={() => setSearch("")} hitSlop={8}>
                      <Feather name="x" size={18} color={colors.mutedForeground} />
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ) : null
          }
          ListEmptyComponent={
            search.trim() ? (
              <EmptyState
                icon="search"
                title="Sin resultados"
                message="No se encontraron conversaciones."
              />
            ) : (
              <EmptyState
                icon="message-circle"
                title="Sin conversaciones"
                message="Pulsa el icono de redacción para iniciar un chat."
              />
            )
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() =>
                router.push({ pathname: "/chat/[id]", params: { id: String(item.id), name: item.name } })
              }
              style={({ pressed }) => [
                styles.row,
                { borderBottomColor: colors.border, opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Avatar text={initials(item.name)} />
              <View style={styles.rowBody}>
                <Text
                  style={[styles.name, { color: colors.foreground }]}
                  numberOfLines={1}
                >
                  {item.name}
                </Text>
                <Text style={[styles.preview, { color: colors.mutedForeground }]}>
                  {item.type === "direct" ? "Mensaje directo" : "Grupo"}
                </Text>
              </View>
              <View style={styles.rowEnd}>
                {item.lastMessageAt ? (
                  <Text style={[styles.time, { color: colors.mutedForeground }]}>
                    {formatRelative(item.lastMessageAt)}
                  </Text>
                ) : null}
                {(item.unreadCount ?? 0) > 0 ? (
                  <View style={[styles.badge, { backgroundColor: colors.primary }]}>
                    <Text
                      style={[styles.badgeText, { color: colors.primaryForeground }]}
                    >
                      {(item.unreadCount ?? 0) > 99 ? "99+" : item.unreadCount}
                    </Text>
                  </View>
                ) : null}
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  searchWrap: { padding: 16 },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  rowBody: { flex: 1, gap: 3 },
  rowEnd: { alignItems: "flex-end", gap: 6 },
  name: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  preview: { fontSize: 13, fontFamily: "Inter_400Regular" },
  time: { fontSize: 12, fontFamily: "Inter_400Regular" },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
});
