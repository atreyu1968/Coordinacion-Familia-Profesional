import React, { useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";

import {
  useCreateChatGroup,
  useListUsers,
  type User,
} from "@workspace/api-client-react";

import { AppHeader } from "@/components/AppHeader";
import { Avatar, EmptyState, ErrorState, Loading } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { initials, roleLabel } from "@/lib/format";

export default function NewGroupScreen() {
  const colors = useColors();
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Record<number, User>>({});
  const { data, isLoading, isError, refetch } = useListUsers(
    search.trim() ? { search: search.trim() } : undefined,
  );
  const createGroup = useCreateChatGroup();

  const toggle = (u: User) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[u.id]) delete next[u.id];
      else next[u.id] = u;
      return next;
    });
  };

  const selectedList = Object.values(selected);

  const create = () => {
    if (createGroup.isPending) return;
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert("Falta el nombre", "Escribe un nombre para el grupo.");
      return;
    }
    if (selectedList.length === 0) {
      Alert.alert("Sin miembros", "Selecciona al menos una persona.");
      return;
    }
    createGroup.mutate(
      {
        data: {
          name: trimmed,
          type: "group",
          memberIds: selectedList.map((u) => u.id),
        },
      },
      {
        onSuccess: (group) => {
          router.replace({
            pathname: "/chat/[id]",
            params: { id: String(group.id), name: group.name },
          });
        },
        onError: () => {
          Alert.alert("Error", "No se pudo crear el grupo.");
        },
      },
    );
  };

  const others = (data ?? []).filter((u) => u.id !== user?.id);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader
        title="Nuevo grupo"
        showBack
        right={
          <Pressable
            onPress={create}
            hitSlop={12}
            disabled={createGroup.isPending}
            style={({ pressed }) => ({
              opacity: pressed || createGroup.isPending ? 0.5 : 1,
            })}
          >
            <Text style={styles.headerAction}>Crear</Text>
          </Pressable>
        }
      />
      <View style={styles.form}>
        <View
          style={[
            styles.field,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: colors.radius,
            },
          ]}
        >
          <Feather name="users" size={18} color={colors.mutedForeground} />
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Nombre del grupo"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.fieldInput, { color: colors.foreground }]}
          />
        </View>
        <View
          style={[
            styles.field,
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
            placeholder="Buscar personas"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            style={[styles.fieldInput, { color: colors.foreground }]}
          />
        </View>
        {selectedList.length > 0 ? (
          <Text style={[styles.count, { color: colors.mutedForeground }]}>
            {selectedList.length} seleccionada(s)
          </Text>
        ) : null}
      </View>
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
            <EmptyState
              icon="users"
              title="Sin resultados"
              message="No se encontraron personas."
            />
          }
          renderItem={({ item }) => {
            const isSel = !!selected[item.id];
            return (
              <Pressable
                onPress={() => toggle(item)}
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
                  <Text
                    style={[styles.role, { color: colors.mutedForeground }]}
                    numberOfLines={1}
                  >
                    {roleLabel(item.role)}
                  </Text>
                </View>
                <Feather
                  name={isSel ? "check-circle" : "circle"}
                  size={22}
                  color={isSel ? colors.primary : colors.mutedForeground}
                />
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
  headerAction: { color: "#ffffff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  form: { padding: 16, gap: 12 },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  fieldInput: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  count: { fontSize: 13, fontFamily: "Inter_500Medium" },
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
