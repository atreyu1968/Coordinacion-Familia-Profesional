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
  getListChatGroupsQueryKey,
  useHideChatGroupForMe,
  useRestoreChatGroupForMe,
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
  const {
    data: hiddenData,
    isLoading: hiddenLoading,
    isError: hiddenError,
    refetch: refetchHidden,
    isRefetching: isHiddenRefetching,
  } = useListChatGroups(
    { hidden: true },
    { query: { queryKey: getListChatGroupsQueryKey({ hidden: true }), staleTime: 0 } },
  );
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"people" | "groups" | "hidden">("people");

  const canManageModules =
    user?.role === "superadmin" ||
    user?.role === "coordinator" ||
    user?.role === "department_head";
  const syncModules = useSyncModuleChatGroups();
  const hideConversationMutation = useHideChatGroupForMe();
  const restoreConversationMutation = useRestoreChatGroupForMe();

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

  const hideConversation = (group: ChatGroup) => {
    Alert.alert(
      "Ocultar conversación",
      "Solo desaparecerá de tu lista. El historial de las demás personas no se borrará y volverá a aparecer cuando haya actividad nueva.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Ocultar",
          style: "destructive",
          onPress: () =>
            hideConversationMutation.mutate(
              { id: group.id },
              {
                onSuccess: () => {
                  void refetch();
                  void refetchHidden();
                },
                onError: () =>
                  Alert.alert("Error", "No se pudo ocultar la conversación."),
              },
            ),
        },
      ],
    );
  };

  const restoreConversation = (group: ChatGroup) => {
    restoreConversationMutation.mutate(
      { id: group.id },
      {
        onSuccess: () => {
          void refetch();
          void refetchHidden();
        },
        onError: () =>
          Alert.alert("Error", "No se pudo restaurar la conversación."),
      },
    );
  };

  useFocusEffect(
    React.useCallback(() => {
      void refetch();
      void refetchHidden();
    }, [refetch, refetchHidden]),
  );

  const bottomPad = Platform.OS === "web" ? 100 : 90;

  const conversations = useMemo(() => {
    const groups = activeTab === "hidden" ? hiddenData ?? [] : data ?? [];
    return groups.filter((group) =>
      activeTab === "hidden" ||
      (activeTab === "people" ? group.type === "direct" : group.type !== "direct"),
    );
  }, [activeTab, data, hiddenData]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return conversations;
    return conversations.filter((group) =>
      group.name.toLowerCase().includes(term),
    );
  }, [conversations, search]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader
        title="Mensajes"
        right={
          <View style={styles.headerActions}>
            <Pressable
              onPress={() => router.push("/new-group")}
              accessibilityLabel="Crear grupo"
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
          onRefresh={activeTab === "hidden" ? refetchHidden : refetch}
          refreshing={activeTab === "hidden" ? isHiddenRefetching : isRefetching}
          scrollEnabled={filtered.length > 0}
          ListHeaderComponent={
            <View>
              <View style={styles.tabs}>
                {(
                  [
                    ["people", "Personas"],
                    ["groups", "Grupos"],
                    ["hidden", "Ocultas"],
                  ] as const
                ).map(([tab, label]) => {
                  const selected = activeTab === tab;
                  const count =
                    tab === "people"
                      ? (data ?? []).filter((group) => group.type === "direct").length
                      : tab === "groups"
                        ? (data ?? []).filter((group) => group.type !== "direct").length
                        : (hiddenData ?? []).length;
                  return (
                    <Pressable
                      key={tab}
                      accessibilityRole="tab"
                      accessibilityState={{ selected }}
                      testID={`chat-tab-${tab}`}
                      onPress={() => setActiveTab(tab)}
                      style={[
                        styles.tab,
                        {
                          backgroundColor: selected ? colors.primary : colors.card,
                          borderColor: selected ? colors.primary : colors.border,
                          borderRadius: colors.radius,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.tabText,
                          {
                            color: selected
                              ? colors.primaryForeground
                              : colors.mutedForeground,
                          },
                        ]}
                      >
                        {label} · {count}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {canManageModules && activeTab === "groups" ? (
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
            (activeTab === "hidden" ? hiddenLoading || hiddenError : false) ? (
              <EmptyState
                icon="message-circle"
                title={hiddenError ? "No se pudieron cargar" : "Cargando…"}
                message={hiddenError ? "Desliza hacia abajo para reintentar." : ""}
              />
            ) : search.trim() ? (
              <EmptyState
                icon="search"
                title="Sin resultados"
                message="No se encontraron conversaciones."
              />
            ) : (
              <EmptyState
                icon={activeTab === "people" ? "user" : "users"}
                title={
                  activeTab === "hidden"
                    ? "Sin conversaciones ocultas"
                    : activeTab === "people"
                      ? "Sin conversaciones"
                      : "Sin grupos"
                }
                message={
                  activeTab === "hidden"
                    ? "Las conversaciones que ocultes aparecerán aquí."
                    : activeTab === "people"
                    ? "Pulsa el icono de redacción para iniciar una conversación."
                    : "Aún no perteneces a ningún grupo."
                }
              />
            )
          }
          renderItem={({ item }) => {
            const meta = chatTypeMeta(item.type, colors);
            return (
              <View style={[styles.row, { borderBottomColor: colors.border }]}>
                <Pressable
                  onPress={() =>
                    router.push({ pathname: "/chat/[id]", params: { id: String(item.id), name: item.name } })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`Abrir conversación con ${item.name}`}
                  style={({ pressed }) => [
                    styles.rowMain,
                    { opacity: pressed ? 0.6 : 1 },
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
                <Pressable
                  onPress={() =>
                    activeTab === "hidden"
                      ? restoreConversation(item)
                      : hideConversation(item)
                  }
                  disabled={
                    activeTab === "hidden"
                      ? restoreConversationMutation.isPending
                      : hideConversationMutation.isPending
                  }
                  accessibilityRole="button"
                  accessibilityLabel={
                    activeTab === "hidden"
                      ? `Restaurar conversación ${item.name}`
                      : `Ocultar conversación ${item.name}`
                  }
                  testID={`${activeTab === "hidden" ? "restore" : "hide"}-conversation-${item.id}`}
                  hitSlop={8}
                  style={({ pressed }) => [
                    styles.hideAction,
                    {
                      opacity:
                        pressed ||
                        restoreConversationMutation.isPending ||
                        hideConversationMutation.isPending
                          ? 0.5
                          : 1,
                    },
                  ]}
                >
                  <Feather
                    name={activeTab === "hidden" ? "eye" : "eye-off"}
                    size={18}
                    color={colors.mutedForeground}
                  />
                </Pressable>
              </View>
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
  tabs: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  tab: {
    flex: 1,
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  tabText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
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
  rowMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  hideAction: {
    minWidth: 40,
    alignItems: "center",
    justifyContent: "center",
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
