import React, { useMemo, useState } from "react";
import {
  Alert,
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
  useSyncModuleChatGroups,
  type ChatGroup,
} from "@workspace/api-client-react";

import { AppHeader } from "@/components/AppHeader";
import { EmptyState, ErrorState, Loading } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { formatRelative, initials } from "@/lib/format";

// Visual identity per conversation kind so direct chats are instantly
// distinguishable from group/module chats in the list (frontend-only, derived
// from ChatGroup.type).
function chatTypeMeta(
  type: string | null | undefined,
  colors: ReturnType<typeof useColors>,
): { color: string; label: string; icon: React.ComponentProps<typeof Feather>["name"] } {
  if (type === "direct") {
    return { color: colors.primary, label: "Directo", icon: "user" };
  }
  if (type === "module") {
    return { color: colors.success, label: "Módulo", icon: "book-open" };
  }
  return { color: colors.secondary, label: "Grupo", icon: "users" };
}

export default function ChatListScreen() {
  const colors = useColors();
  const { user } = useAuth();
  const { data, isLoading, isError, refetch, isRefetching } = useListChatGroups();
  const [search, setSearch] = useState("");

  const canManageModules =
    user?.role === "superadmin" ||
    user?.role === "coordinator" ||
    user?.role === "department_head";
  const syncModules = useSyncModuleChatGroups();

  const generateModuleGroups = () => {
    if (syncModules.isPending) return;
    syncModules.mutate(undefined, {
      onSuccess: (result) => {
        void refetch();
        Alert.alert(
          "Grupos de módulos",
          `Creados: ${result.created} · Actualizados: ${result.updated}`,
        );
      },
      onError: () => {
        Alert.alert("Error", "No se pudieron generar los grupos.");
      },
    });
  };

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
          <View style={styles.headerActions}>
            <Pressable
              onPress={() => router.push("/new-group")}
              hitSlop={12}
              style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
            >
              <Feather name="users" size={22} color="#ffffff" />
            </Pressable>
            <Pressable
              onPress={() => router.push("/new-chat")}
              hitSlop={12}
              style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
            >
              <Feather name="edit" size={22} color="#ffffff" />
            </Pressable>
          </View>
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
            <View>
              {canManageModules ? (
                <View style={styles.generateWrap}>
                  <Pressable
                    onPress={generateModuleGroups}
                    disabled={syncModules.isPending}
                    style={({ pressed }) => [
                      styles.generateBtn,
                      {
                        backgroundColor: colors.primary,
                        borderRadius: colors.radius,
                        opacity: pressed || syncModules.isPending ? 0.6 : 1,
                      },
                    ]}
                  >
                    <Feather name="refresh-cw" size={16} color={colors.primaryForeground} />
                    <Text
                      style={[styles.generateText, { color: colors.primaryForeground }]}
                    >
                      {syncModules.isPending
                        ? "Generando…"
                        : "Generar grupos de módulos"}
                    </Text>
                  </Pressable>
                </View>
              ) : null}
              {(data ?? []).length > 0 ? (
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
              ) : null}
            </View>
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
          renderItem={({ item }) => {
            const meta = chatTypeMeta(item.type, colors);
            return (
            <Pressable
              onPress={() =>
                router.push({ pathname: "/chat/[id]", params: { id: String(item.id), name: item.name } })
              }
              style={({ pressed }) => [
                styles.row,
                { borderBottomColor: colors.border, opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <View
                style={[
                  styles.typeAvatar,
                  { backgroundColor: meta.color + "22", borderColor: meta.color },
                ]}
              >
                {item.type === "direct" ? (
                  <Text style={[styles.typeAvatarText, { color: meta.color }]}>
                    {initials(item.name)}
                  </Text>
                ) : (
                  <Feather name={meta.icon} size={20} color={meta.color} />
                )}
              </View>
              <View style={styles.rowBody}>
                <Text
                  style={[styles.name, { color: colors.foreground }]}
                  numberOfLines={1}
                >
                  {item.name}
                </Text>
                <View style={styles.previewRow}>
                  <View style={[styles.typeBadge, { backgroundColor: meta.color + "22" }]}>
                    <Feather name={meta.icon} size={10} color={meta.color} />
                    <Text style={[styles.typeBadgeText, { color: meta.color }]}>
                      {meta.label}
                    </Text>
                  </View>
                </View>
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
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 18 },
  generateWrap: { paddingHorizontal: 16, paddingTop: 16 },
  generateBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  generateText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
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
  rowBody: { flex: 1, gap: 4 },
  rowEnd: { alignItems: "flex-end", gap: 6 },
  name: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  previewRow: { flexDirection: "row", alignItems: "center" },
  typeAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
  },
  typeAvatarText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  typeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  typeBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
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
