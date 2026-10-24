import React, { useCallback } from "react";
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";

import {
  getListHiddenChatMessagesQueryKey,
  getListHiddenGroupMessagesQueryKey,
  useListHiddenChatMessages,
  useRestoreHiddenMessage,
  type HiddenChatMessage,
} from "@workspace/api-client-react";

import { AppHeader } from "@/components/AppHeader";
import { EmptyState, ErrorState, Loading } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { formatRelative } from "@/lib/format";

export default function HiddenMessagesScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { data = [], isLoading, isError, refetch, isRefetching } =
    useListHiddenChatMessages({
      query: {
        queryKey: getListHiddenChatMessagesQueryKey(),
        refetchOnMount: "always",
      },
    });
  const restoreMessage = useRestoreHiddenMessage();

  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  const restore = (message: HiddenChatMessage) => {
    if (message.deleted || restoreMessage.isPending) return;
    restoreMessage.mutate(
      { id: message.id },
      {
        onSuccess: () => {
          queryClient.setQueryData<HiddenChatMessage[]>(
            getListHiddenChatMessagesQueryKey(),
            (current = []) => current.filter((item) => item.id !== message.id),
          );
          void queryClient.invalidateQueries({
            queryKey: getListHiddenGroupMessagesQueryKey(message.conversationId),
          });
        },
        onError: () => {
          Alert.alert(
            "No se pudo restaurar",
            "Comprueba que sigues perteneciendo a la conversación e inténtalo de nuevo.",
          );
        },
      },
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader
        title="Mensajes ocultos"
        subtitle="Solo tú puedes ver esta lista"
        showBack
      />
      {isLoading ? (
        <Loading />
      ) : isError ? (
        <ErrorState onRetry={refetch} />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => String(item.id)}
          onRefresh={refetch}
          refreshing={isRefetching}
          contentContainerStyle={[
            styles.list,
            data.length === 0 ? styles.emptyList : null,
          ]}
          ListHeaderComponent={
            <Text style={[styles.hint, { color: colors.mutedForeground }]}>
              Los mensajes eliminados para todos aparecen sin contenido y no se pueden restaurar.
            </Text>
          }
          ListEmptyComponent={
            <EmptyState
              icon="eye-off"
              title="No hay mensajes ocultos"
              message="Los mensajes que ocultes de tus conversaciones aparecerán aquí."
            />
          }
          renderItem={({ item }) => {
            const preview = item.deleted
              ? "Mensaje eliminado para todos"
              : item.content ||
                (item.attachmentName
                  ? `Archivo adjunto · ${item.attachmentName}`
                  : "Archivo adjunto");
            return (
              <View
                style={[
                  styles.row,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    borderRadius: colors.radius,
                  },
                ]}
              >
                <View style={styles.message}>
                  <Text
                    style={[
                      styles.preview,
                      {
                        color: item.deleted
                          ? colors.mutedForeground
                          : colors.foreground,
                        fontStyle: item.deleted ? "italic" : "normal",
                      },
                    ]}
                  >
                    {preview}
                  </Text>
                  <Text style={[styles.context, { color: colors.mutedForeground }]}>
                    <Feather name="message-circle" size={13} color={colors.mutedForeground} />
                    {" "}{item.conversationName} · {formatRelative(item.createdAt)}
                  </Text>
                </View>
                {!item.deleted ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Restaurar mensaje de ${item.conversationName}`}
                    disabled={restoreMessage.isPending}
                    onPress={() => restore(item)}
                    style={({ pressed }) => [
                      styles.restore,
                      {
                        borderColor: colors.primary,
                        borderRadius: colors.radius,
                        opacity: pressed || restoreMessage.isPending ? 0.55 : 1,
                      },
                    ]}
                  >
                    <Text style={[styles.restoreText, { color: colors.primary }]}>
                      Restaurar
                    </Text>
                  </Pressable>
                ) : null}
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
  list: { padding: 16, paddingBottom: 36, gap: 10 },
  emptyList: { flexGrow: 1 },
  hint: { fontSize: 13, lineHeight: 19, marginBottom: 4 },
  row: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  message: { flex: 1, gap: 6 },
  preview: { fontSize: 15, lineHeight: 21, fontFamily: "Inter_500Medium" },
  context: { fontSize: 12, lineHeight: 17 },
  restore: { borderWidth: 1, paddingVertical: 8, paddingHorizontal: 10 },
  restoreText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
