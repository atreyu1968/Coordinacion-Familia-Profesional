import React, { useEffect, useState } from "react";
import { AutoLinkText } from "@/components/AutoLinkText";
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
  useGetForumThread,
  useGetForumCollaboration,
  getGetForumCollaborationQueryKey,
  useListForumPosts,
  useCreateForumPost,
  useDeleteForumPost,
  useUpdateForumPost,
  useMarkForumThreadRead,
  getListForumPostsQueryKey,
  getListForumThreadsQueryKey,
  getListForumModulesQueryKey,
  useListCurriculumResources,
  getListCurriculumResourcesQueryKey,
  useListLearningOutcomes,
  getListLearningOutcomesQueryKey,
  type ForumPost,
  type Resource,
} from "@workspace/api-client-react";

import { AppHeader } from "@/components/AppHeader";
import { AgreementPanel } from "@/components/AgreementPanel";
import { Button, EmptyState, ErrorState, Loading } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { formatRelative } from "@/lib/format";
import { openBrowserLink } from "@/lib/browser-link";
import { webAppUrl, webOutcomeUrl } from "@/lib/web-links";
import { downloadAttachment, wikiAttachmentId } from "@/lib/wiki-attachment";

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
  const { data: thread } = useGetForumThread(threadId);
  const collabModuleId = thread?.moduleId ?? 0;
  const { data: collab } = useGetForumCollaboration(collabModuleId, {
    query: {
      queryKey: getGetForumCollaborationQueryKey(collabModuleId),
      enabled: collabModuleId > 0,
      retry: false,
    },
  });
  const origin =
    collab && (collab.enabled || collab.canConfigure)
      ? collab.threads.find((t) => t.threadId === threadId)
      : undefined;
  const originUrl =
    origin && thread
      ? webOutcomeUrl(thread.moduleId, origin.kind, origin.outcomeId, origin.criterionId)
      : null;
  const materialFilter =
    origin?.kind === "material_ce" && origin.criterionId != null
      ? { criterionId: origin.criterionId, outcomeId: null as number | null }
      : origin?.kind === "material_ra" && origin.outcomeId != null
        ? { criterionId: null as number | null, outcomeId: origin.outcomeId }
        : null;
  const resModuleId = materialFilter ? collabModuleId : 0;
  const resQuery = useListCurriculumResources(resModuleId, {
    query: {
      queryKey: getListCurriculumResourcesQueryKey(resModuleId),
      enabled: resModuleId > 0,
      retry: false,
      refetchOnMount: "always",
      refetchOnWindowFocus: true,
    },
  });
  const { data: outcomes = [] } = useListLearningOutcomes(resModuleId, {
    query: { queryKey: getListLearningOutcomesQueryKey(resModuleId), enabled: resModuleId > 0 },
  });
  const parentOf = new Map<number, number>();
  outcomes.forEach((o) => o.criteria.forEach((c) => parentOf.set(c.id, o.id)));
  const materialResources: Resource[] = materialFilter
    ? (resQuery.data ?? []).filter((r) => {
        const c = r.curriculum;
        if (!c || c.archived) return false;
        if (materialFilter.criterionId != null) return c.targets.some((t) => t.criterionId === materialFilter.criterionId);
        return c.targets.some(
          (t) => (t.criterionId != null ? parentOf.get(t.criterionId) ?? t.outcomeId : t.outcomeId) === materialFilter.outcomeId,
        );
      })
    : [];
  const libraryUrl = materialFilter
    ? webAppUrl(
        `/recursos?module=${collabModuleId}&${materialFilter.criterionId != null ? `criterionId=${materialFilter.criterionId}` : `outcomeId=${materialFilter.outcomeId}`}`,
      )
    : null;
  const [resError, setResError] = useState<string | null>(null);
  const openResource = (r: Resource) => {
    const url = r.fileUrl;
    if (!url) return;
    setResError(null);
    const attachmentId = wikiAttachmentId(url);
    if (attachmentId != null) {
      void downloadAttachment(attachmentId, r.title).catch((e: unknown) =>
        setResError(e instanceof Error ? e.message : "No se pudo abrir el adjunto."),
      );
      return;
    }
    if (url.startsWith("/")) return;
    void openBrowserLink(url).catch(() => setResError("No se pudo abrir el enlace."));
  };
  const [showResources, setShowResources] = useState(false);
  const canManagePost = (authorId: number | null | undefined) =>
    (authorId != null && authorId === user?.id) ||
    thread?.canModerate === true;

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
      {origin ? (
        <View style={[styles.originBar, { borderBottomColor: colors.border, backgroundColor: colors.card }]}>
          <Text style={[styles.originText, { color: colors.mutedForeground }]} numberOfLines={1}>
            {origin.kind === "programming_section" ? "Programación didáctica" : "Materiales RA/CE"} · {origin.key}
            {origin.archived ? " · archivado" : ""}
          </Text>
          {originUrl ? (
            <Pressable
              testID="link-thread-origin"
              accessibilityRole="link"
              hitSlop={8}
              onPress={() => void openBrowserLink(originUrl).catch(() => undefined)}
            >
              <Text style={[styles.originLink, { color: colors.primary }]}>
                {origin.kind === "material_ce" ? "Ver criterio (web)" : "Ver RA (web)"}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {origin && thread && ["programming_section", "material_ra", "material_ce"].includes(origin.kind) ? (
        <AgreementPanel threadId={threadId} moduleId={thread.moduleId} />
      ) : null}
      {materialFilter ? (
        <View style={[styles.resBox, { borderBottomColor: colors.border, backgroundColor: colors.card }]} testID="panel-curriculum-resources">
          <Pressable style={styles.resHead} onPress={() => setShowResources((v) => !v)} accessibilityRole="button" testID="toggle-curriculum-resources">
            <Feather name="book-open" size={14} color={colors.primary} />
            <Text style={[styles.resTitle, { color: colors.foreground }]}>
              Recursos {materialFilter.criterionId != null ? "del CE" : "del RA"}
              {resQuery.isLoading ? "" : ` (${materialResources.length})`}
            </Text>
            <Feather name={showResources ? "chevron-up" : "chevron-down"} size={16} color={colors.mutedForeground} />
          </Pressable>
          {showResources ? (
            <View style={styles.resList}>
              {resQuery.isLoading ? (
                <Text style={[styles.resMeta, { color: colors.mutedForeground }]}>Cargando recursos...</Text>
              ) : resQuery.isError ? (
                <Pressable onPress={() => void resQuery.refetch()} testID="button-retry-curriculum">
                  <Text style={[styles.resMeta, { color: colors.destructive }]}>No se pudieron cargar. Toca para reintentar.</Text>
                </Pressable>
              ) : materialResources.length === 0 ? (
                <Text style={[styles.resMeta, { color: colors.mutedForeground }]}>Aún no hay recursos asociados.</Text>
              ) : (
                materialResources.slice(0, 8).map((r) => (
                  <Pressable
                    key={r.id}
                    disabled={!r.fileUrl}
                    onPress={() => openResource(r)}
                    style={styles.resRow}
                    testID={`row-curriculum-resource-${r.id}`}
                  >
                    <Text style={[styles.resName, { color: r.fileUrl ? colors.primary : colors.foreground }]} numberOfLines={2}>
                      {r.title}
                    </Text>
                    <Text style={[styles.resMeta, { color: colors.mutedForeground }]} numberOfLines={2}>
                      {r.curriculum?.originCenterName ?? "Centro de origen no disponible"} · {r.type} · {r.curriculum?.audience === "students" ? "Para alumnado" : "Uso docente"} · {r.curriculum?.license}
                      {r.curriculum?.restricted ? " · Solución restringida" : ""}
                    </Text>
                  </Pressable>
                ))
              )}
              {resError ? (
                <Text style={[styles.resMeta, { color: colors.destructive }]}>{resError}</Text>
              ) : null}
              {libraryUrl ? (
                <Pressable onPress={() => void openBrowserLink(libraryUrl).catch(() => undefined)} accessibilityRole="link" testID="link-curriculum-library-web">
                  <Text style={[styles.originLink, { color: colors.primary }]}>Ver y gestionar en la biblioteca (web)</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}
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
                      <AutoLinkText text={item.content} />
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
  originBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  originText: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium" },
  originLink: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  container: { flex: 1 },
  resBox: { paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, gap: 6 },
  resHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  resTitle: { flex: 1, fontSize: 13, fontFamily: "Inter_600SemiBold" },
  resList: { gap: 8, maxHeight: 260 },
  resRow: { gap: 2 },
  resName: { fontSize: 14, fontFamily: "Inter_500Medium" },
  resMeta: { fontSize: 11, fontFamily: "Inter_400Regular" },
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
