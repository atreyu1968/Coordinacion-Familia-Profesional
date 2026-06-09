import React, { useEffect, useState } from "react";
import {
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";

import {
  useListForumPosts,
  useCreateForumPost,
  useDeleteForumPost,
  useUpdateForumPost,
  useMarkForumThreadRead,
  getListForumPostsQueryKey,
  getListForumThreadsQueryKey,
  getListForumModulesQueryKey,
  type ForumPost,
} from "@workspace/api-client-react";

import { AppHeader } from "@/components/AppHeader";
import { Button, EmptyState, ErrorState, Loading } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { formatRelative } from "@/lib/format";

export default function ForoTemaScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { user } = useAuth();
  const params = useLocalSearchParams<{
    id: string;
    title?: string;
    module?: string;
    center?: string;
  }>();
  const threadId = Number(params.id);
  const threadCenterId = params.center ? Number(params.center) : null;

  const isManager =
    user?.role === "coordinator" || user?.role === "department_head";
  // Mirrors the backend: author/superadmin always; managers only on scoped
  // (non-global) threads, which their visibility already confines to scope.
  const canManagePost = (authorId: number | null | undefined) =>
    (authorId != null && authorId === user?.id) ||
    user?.role === "superadmin" ||
    (isManager && threadCenterId != null);

  const { data: posts = [], isLoading, isError, refetch } = useListForumPosts(threadId);
  const createMut = useCreateForumPost();
  const deleteMut = useDeleteForumPost();
  const updateMut = useUpdateForumPost();
  const markReadMut = useMarkForumThreadRead();

  const [draft, setDraft] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");

  // Mark the thread read on open, then refresh the unread badges upstream.
  useEffect(() => {
    markReadMut.mutate(
      { id: threadId },
      {
        onSuccess: () => {
          void qc.invalidateQueries({ queryKey: getListForumModulesQueryKey() });
          void qc.invalidateQueries({ queryKey: getListForumThreadsQueryKey() });
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  const ordered = [...posts].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: getListForumPostsQueryKey(threadId) });
    await qc.invalidateQueries({ queryKey: getListForumThreadsQueryKey() });
  };

  const onSend = async () => {
    const content = draft.trim();
    if (!content) return;
    setDraft("");
    try {
      await createMut.mutateAsync({ id: threadId, data: { content } });
      await refresh();
      markReadMut.mutate({ id: threadId });
    } catch {
      setDraft(content);
    }
  };

  const onDelete = async (id: number) => {
    try {
      await deleteMut.mutateAsync({ id });
      await refresh();
    } catch {
      // ignore; surface nothing destructive
    }
  };

  const onSaveEdit = async () => {
    const content = editText.trim();
    if (editId == null || !content) return;
    try {
      await updateMut.mutateAsync({ id: editId, data: { content } });
      setEditId(null);
      setEditText("");
      await refresh();
    } catch {
      // ignore
    }
  };

  const bottomInset = Platform.OS === "web" ? 16 : insets.bottom;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader
        title={params.title ?? "Tema"}
        subtitle={params.module || undefined}
        showBack
      />
      <KeyboardAvoidingView style={styles.flex} behavior="padding" keyboardVerticalOffset={0}>
        {isLoading ? (
          <Loading />
        ) : isError && posts.length === 0 ? (
          <ErrorState onRetry={refetch} />
        ) : (
          <FlatList
            data={ordered}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <EmptyState
                  icon="message-circle"
                  title="Sin mensajes"
                  message="Escribe la primera respuesta."
                />
              </View>
            }
            renderItem={({ item }: { item: ForumPost }) => {
              const canManage = canManagePost(item.authorId);
              const isAuthor = item.authorId != null && item.authorId === user?.id;
              const isEditing = editId === item.id;
              return (
                <View
                  style={[styles.post, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <View style={styles.postHead}>
                    <Text style={[styles.author, { color: colors.primary }]}>
                      {item.authorName ?? "Usuario"}
                    </Text>
                    <View style={styles.postHeadRight}>
                      <Text style={[styles.time, { color: colors.mutedForeground }]}>
                        {formatRelative(item.createdAt)}
                        {item.editedAt ? " · editado" : ""}
                      </Text>
                      {isAuthor && !isEditing ? (
                        <Pressable
                          onPress={() => {
                            setEditId(item.id);
                            setEditText(item.content);
                          }}
                          hitSlop={8}
                        >
                          <Feather name="edit-2" size={14} color={colors.mutedForeground} />
                        </Pressable>
                      ) : null}
                      {canManage ? (
                        <Pressable
                          onPress={() => onDelete(item.id)}
                          disabled={deleteMut.isPending}
                          hitSlop={8}
                        >
                          <Feather name="trash-2" size={15} color={colors.destructive} />
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                  {isEditing ? (
                    <View style={styles.editWrap}>
                      <TextInput
                        value={editText}
                        onChangeText={setEditText}
                        multiline
                        autoFocus
                        style={[
                          styles.editInput,
                          {
                            backgroundColor: colors.background,
                            borderColor: colors.border,
                            color: colors.foreground,
                            borderRadius: colors.radius,
                          },
                        ]}
                      />
                      <View style={styles.editActions}>
                        <Button
                          label="Cancelar"
                          variant="secondary"
                          onPress={() => {
                            setEditId(null);
                            setEditText("");
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
                    <Text style={[styles.postText, { color: colors.foreground }]}>
                      {item.content}
                    </Text>
                  )}
                </View>
              );
            }}
          />
        )}
        <View
          style={[
            styles.inputBar,
            {
              borderTopColor: colors.border,
              backgroundColor: colors.background,
              paddingBottom: bottomInset + 8,
            },
          ]}
        >
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Escribe una respuesta"
            placeholderTextColor={colors.mutedForeground}
            multiline
            style={[
              styles.input,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                color: colors.foreground,
                borderRadius: colors.radius,
              },
            ]}
          />
          <Pressable
            onPress={onSend}
            disabled={!draft.trim() || createMut.isPending}
            style={({ pressed }) => [
              styles.sendBtn,
              {
                backgroundColor: colors.primary,
                opacity: !draft.trim() ? 0.4 : pressed ? 0.8 : 1,
              },
            ]}
          >
            <Feather name="arrow-up" size={22} color={colors.primaryForeground} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  list: { padding: 16, gap: 10, flexGrow: 1 },
  emptyWrap: { flex: 1, minHeight: 300 },
  post: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
  },
  postHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  postHeadRight: { flexDirection: "row", alignItems: "center", gap: 12 },
  author: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  time: { fontSize: 11, fontFamily: "Inter_400Regular" },
  postText: { fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 21 },
  editWrap: { gap: 10 },
  editInput: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    minHeight: 70,
    textAlignVertical: "top",
  },
  editActions: { flexDirection: "row", gap: 10 },
  editBtn: { flex: 1 },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 12,
    paddingTop: 10,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    borderWidth: StyleSheet.hairlineWidth,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
});
