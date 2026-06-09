import React, { useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";

import {
  useListForumThreads,
  useCreateForumThread,
  useDeleteForumThread,
  useUpdateForumThread,
  usePinForumThread,
  getListForumThreadsQueryKey,
  getListForumModulesQueryKey,
  type ForumThread,
} from "@workspace/api-client-react";

import { AppHeader } from "@/components/AppHeader";
import { Button, Card, EmptyState, Loading } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { formatRelative } from "@/lib/format";

export default function ForoModuloScreen() {
  const colors = useColors();
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ id: string; name?: string; cycle?: string }>();
  const moduleId = Number(params.id);

  const isManager =
    user?.role === "coordinator" || user?.role === "department_head";

  const [search, setSearch] = useState("");
  const { data: threads = [], isLoading } = useListForumThreads({
    moduleId,
    ...(search.trim() ? { q: search.trim() } : {}),
  });
  const createMut = useCreateForumThread();
  const deleteMut = useDeleteForumThread();
  const updateMut = useUpdateForumThread();
  const pinMut = usePinForumThread();

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: getListForumThreadsQueryKey({ moduleId }) });
    await qc.invalidateQueries({ queryKey: getListForumModulesQueryKey() });
  };

  const onCreate = async () => {
    if (!title.trim() || !content.trim()) {
      setError("El título y el mensaje son obligatorios.");
      return;
    }
    setError(null);
    try {
      await createMut.mutateAsync({
        data: { moduleId, title: title.trim(), content: content.trim() },
      });
      await refresh();
      setTitle("");
      setContent("");
      setShowForm(false);
    } catch {
      setError("No se pudo crear el tema. Inténtalo de nuevo.");
    }
  };

  const onDelete = async (id: number) => {
    try {
      await deleteMut.mutateAsync({ id });
      await refresh();
    } catch {
      setError("No se pudo eliminar el tema.");
    }
  };

  const onSaveEdit = async () => {
    if (editId == null || !editTitle.trim()) return;
    try {
      await updateMut.mutateAsync({ id: editId, data: { title: editTitle.trim() } });
      setEditId(null);
      setEditTitle("");
      await refresh();
    } catch {
      setError("No se pudo editar el tema.");
    }
  };

  const onTogglePin = async (t: ForumThread) => {
    try {
      await pinMut.mutateAsync({ id: t.id, data: { pinned: !t.pinnedAt } });
      await refresh();
    } catch {
      setError("No se pudo cambiar el estado del tema.");
    }
  };

  const bottomPad = Platform.OS === "web" ? 100 : 40;

  const inputStyle = [
    styles.input,
    {
      backgroundColor: colors.card,
      borderColor: colors.border,
      color: colors.foreground,
      borderRadius: colors.radius,
    },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader
        title={params.name ?? "Foro"}
        subtitle={params.cycle || undefined}
        showBack
        right={
          <Pressable
            onPress={() => setShowForm((v) => !v)}
            hitSlop={10}
            style={({ pressed }) => [
              styles.headerBtn,
              { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
            ]}
            accessibilityLabel="Nuevo tema"
          >
            <Feather name={showForm ? "x" : "plus"} size={20} color={colors.primaryForeground} />
          </Pressable>
        }
      />
      <KeyboardAwareScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]}
        keyboardShouldPersistTaps="handled"
        bottomOffset={20}
      >
        {showForm ? (
          <Card style={styles.formCard}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Nuevo tema</Text>
            <Text style={[styles.label, { color: colors.foreground }]}>Título</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Ej. Dudas sobre la práctica 3"
              placeholderTextColor={colors.mutedForeground}
              maxLength={160}
              style={inputStyle}
            />
            <Text style={[styles.label, { color: colors.foreground, marginTop: 14 }]}>
              Mensaje
            </Text>
            <TextInput
              value={content}
              onChangeText={setContent}
              placeholder="Escribe tu mensaje"
              placeholderTextColor={colors.mutedForeground}
              multiline
              numberOfLines={4}
              style={[inputStyle, styles.textarea]}
            />
            {error ? (
              <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text>
            ) : null}
            <Button
              label="Crear tema"
              onPress={onCreate}
              loading={createMut.isPending}
              style={{ marginTop: 18 }}
            />
          </Card>
        ) : null}

        {!showForm ? (
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
              placeholder="Buscar temas por título"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.searchInput, { color: colors.foreground }]}
            />
          </View>
        ) : null}

        {isLoading ? (
          <Loading />
        ) : threads.length === 0 ? (
          <EmptyState
            icon="message-square"
            title={search.trim() ? "Sin resultados" : "Sin temas"}
            message={
              search.trim()
                ? "Ningún tema coincide con tu búsqueda."
                : "Aún no hay temas en este foro. ¡Crea el primero!"
            }
          />
        ) : (
          threads.map((t: ForumThread) => {
            const isAuthor = t.authorId === user?.id;
            const canDelete =
              user?.role === "superadmin" || isAuthor || (isManager && t.centerId != null);
            const canPin =
              user?.role === "superadmin" || (isManager && t.centerId != null);
            const isEditing = editId === t.id;
            return (
              <Card key={t.id} style={styles.itemCard}>
                {isEditing ? (
                  <View style={styles.editWrap}>
                    <TextInput
                      value={editTitle}
                      onChangeText={setEditTitle}
                      maxLength={160}
                      style={inputStyle}
                      autoFocus
                    />
                    <View style={styles.editActions}>
                      <Button
                        label="Cancelar"
                        variant="secondary"
                        onPress={() => {
                          setEditId(null);
                          setEditTitle("");
                        }}
                        style={styles.editBtn}
                      />
                      <Button
                        label="Guardar"
                        onPress={onSaveEdit}
                        loading={updateMut.isPending}
                        style={styles.editBtn}
                      />
                    </View>
                  </View>
                ) : (
                  <Pressable
                    onPress={() =>
                      router.push({
                        pathname: "/foros/tema/[id]",
                        params: {
                          id: String(t.id),
                          title: t.title,
                          module: t.moduleName ?? "",
                          center: t.centerId == null ? "" : String(t.centerId),
                        },
                      })
                    }
                    style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                  >
                    <View style={styles.itemHead}>
                      <View style={styles.titleWrap}>
                        {t.pinnedAt ? (
                          <Feather name="bookmark" size={14} color={colors.primary} />
                        ) : null}
                        <Text
                          style={[styles.itemTitle, { color: colors.foreground }]}
                          numberOfLines={2}
                        >
                          {t.title}
                        </Text>
                        {t.unreadCount > 0 ? (
                          <View style={[styles.unread, { backgroundColor: colors.primary }]}>
                            <Text
                              style={[styles.unreadText, { color: colors.primaryForeground }]}
                            >
                              {t.unreadCount}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      <View style={styles.actions}>
                        {canPin ? (
                          <Pressable onPress={() => onTogglePin(t)} disabled={pinMut.isPending} hitSlop={8}>
                            <Feather
                              name="bookmark"
                              size={17}
                              color={t.pinnedAt ? colors.primary : colors.mutedForeground}
                            />
                          </Pressable>
                        ) : null}
                        {isAuthor ? (
                          <Pressable
                            onPress={() => {
                              setEditId(t.id);
                              setEditTitle(t.title);
                            }}
                            hitSlop={8}
                          >
                            <Feather name="edit-2" size={16} color={colors.mutedForeground} />
                          </Pressable>
                        ) : null}
                        {canDelete ? (
                          <Pressable
                            onPress={() => onDelete(t.id)}
                            disabled={deleteMut.isPending}
                            hitSlop={8}
                          >
                            <Feather name="trash-2" size={17} color={colors.destructive} />
                          </Pressable>
                        ) : null}
                      </View>
                    </View>
                    <View style={styles.metaRow}>
                      <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                        {t.authorName ?? "Usuario"}
                      </Text>
                      <View style={styles.metaItem}>
                        <Feather name="message-circle" size={12} color={colors.mutedForeground} />
                        <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                          {t.postCount}
                        </Text>
                      </View>
                      <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                        {formatRelative(t.lastPostAt)}
                        {t.editedAt ? " · editado" : ""}
                      </Text>
                    </View>
                  </Pressable>
                )}
              </Card>
            );
          })
        )}
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 12 },
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchInput: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular", padding: 0 },
  formCard: { gap: 6 },
  cardTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", marginBottom: 6 },
  label: { fontSize: 14, fontFamily: "Inter_500Medium", marginBottom: 8 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
  },
  textarea: { minHeight: 100, textAlignVertical: "top" },
  error: { fontSize: 14, fontFamily: "Inter_400Regular", marginTop: 12 },
  itemCard: { gap: 8 },
  editWrap: { gap: 12 },
  editActions: { flexDirection: "row", gap: 10 },
  editBtn: { flex: 1 },
  itemHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  titleWrap: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6 },
  itemTitle: { flexShrink: 1, fontSize: 16, fontFamily: "Inter_600SemiBold" },
  actions: { flexDirection: "row", alignItems: "center", gap: 14 },
  unread: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  unreadText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  metaRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  meta: { fontSize: 12, fontFamily: "Inter_500Medium" },
});
