import React, { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";

import {
  useCreateChatGroup,
  useListChatContacts,
  getListChatContactsQueryKey,
  type ChatContact,
} from "@workspace/api-client-react";

import { AppHeader } from "@/components/AppHeader";
import { Avatar, EmptyState, ErrorState, Loading } from "@/components/ui";
import { chatMemberColor } from "@/lib/chat-role-colors";
import { useColors } from "@/hooks/useColors";
import { initials, roleLabel } from "@/lib/format";

export default function NewChatScreen() {
  const colors = useColors();
  const [search, setSearch] = useState("");
  const [chatError, setChatError] = useState("");
  const contactParams = search.trim() ? { search: search.trim() } : undefined;
  const { data, isLoading, isError, refetch } = useListChatContacts(contactParams, {
    query: {
      queryKey: getListChatContactsQueryKey(contactParams),
      staleTime: 0,
      refetchOnMount: "always",
    },
  });
  const createGroup = useCreateChatGroup();

  const startChat = (other: ChatContact) => {
    if (createGroup.isPending) return;
    setChatError("");
    createGroup.mutate(
      {
        data: {
          name: other.name,
          type: "direct",
          memberIds: [other.id],
        },
      },
      {
        onSuccess: (group) => {
          router.replace({
            pathname: "/chat/[id]",
            params: { id: String(group.id), name: group.name },
          });
        },
        onError: () => setChatError("No se pudo iniciar la conversación. Inténtalo de nuevo."),
      },
    );
  };

  const others = data ?? [];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader title="Nuevo mensaje" showBack />
      <View style={styles.searchWrap}>
        <View
          style={[
            styles.searchBox,
            { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius },
          ]}
        >
          <Feather name="search" size={18} color={colors.mutedForeground} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            maxLength={100}
            placeholder="Buscar personas o centros"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            style={[styles.searchInput, { color: colors.foreground }]}
          />
        </View>
      </View>
      {chatError ? (
        <Text style={{ color: colors.destructive, paddingHorizontal: 16, paddingBottom: 8 }}>
          {chatError}
        </Text>
      ) : null}
      {isLoading ? (
        <Loading />
      ) : isError ? (
        <ErrorState onRetry={refetch} />
      ) : (
        <FlatList
          data={others}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ flexGrow: 1 }}
          scrollEnabled={others.length > 0}
          ListEmptyComponent={
            <EmptyState icon="users" title="Sin resultados" message="No se encontraron personas." />
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => startChat(item)}
              style={({ pressed }) => [
                styles.row,
                { borderBottomColor: colors.border, opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Avatar text={initials(item.name)} color={chatMemberColor(item.role, colors)} />
              <View style={styles.rowBody}>
                <Text style={[styles.name, { color: chatMemberColor(item.role, colors) }]} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={[styles.role, { color: colors.mutedForeground }]} numberOfLines={1}>
                  {item.centerName ?? "Sin centro indicado"}
                </Text>
                <Text style={[styles.role, { color: colors.mutedForeground }]} numberOfLines={1}>
                  {roleLabel(item.role)}
                </Text>
              </View>
              <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
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
  name: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  role: { fontSize: 13, fontFamily: "Inter_400Regular" },
});
