import React, { useCallback, useEffect, useRef, useState } from "react";
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
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";

import {
  listGroupMessages,
  useSendGroupMessage,
  type Message,
} from "@workspace/api-client-react";

import { AppHeader } from "@/components/AppHeader";
import { EmptyState, ErrorState, Loading } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { connectSocket } from "@/lib/socket";
import { formatRelative } from "@/lib/format";

export default function ChatDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, token } = useAuth();
  const params = useLocalSearchParams<{ id: string; name?: string }>();
  const groupId = Number(params.id);

  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const sendMutation = useSendGroupMessage();

  const mergeMessages = useCallback((incoming: Message[]) => {
    setMessages((prev) => {
      const byId = new Map<number, Message>();
      // Newest-first ordering for the inverted list.
      for (const m of [...incoming, ...prev]) byId.set(m.id, m);
      return Array.from(byId.values()).sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    });
  }, []);

  const loadMessages = useCallback(async () => {
    setLoadError(false);
    try {
      const data = await listGroupMessages(groupId);
      // Merge (not replace) so realtime messages that arrived during the
      // fetch are preserved.
      mergeMessages(data);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [groupId, mergeMessages]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    if (!token || !Number.isInteger(groupId)) return;
    const socket = connectSocket(token);
    socket.emit("join", groupId);

    const onMessage = (msg: Message) => {
      if (msg.groupId !== groupId) return;
      mergeMessages([msg]);
    };

    socket.on("message", onMessage);
    return () => {
      socket.emit("leave", groupId);
      socket.off("message", onMessage);
    };
  }, [token, groupId, mergeMessages]);

  const onSend = () => {
    const content = draft.trim();
    if (!content) return;
    setDraft("");
    sendMutation.mutate(
      { id: groupId, data: { content } },
      {
        onSuccess: (msg) => mergeMessages([msg]),
      },
    );
  };

  const bottomInset = Platform.OS === "web" ? 16 : insets.bottom;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader title={params.name ?? "Conversación"} showBack />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior="padding"
        keyboardVerticalOffset={0}
      >
        {loading ? (
          <Loading />
        ) : loadError && messages.length === 0 ? (
          <ErrorState onRetry={loadMessages} />
        ) : (
          <FlatList
            data={messages}
            inverted
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <EmptyState
                  icon="message-circle"
                  title="Sin mensajes"
                  message="Escribe el primer mensaje de esta conversación."
                />
              </View>
            }
            renderItem={({ item }) => {
              const mine = item.senderId === user?.id;
              return (
                <View
                  style={[
                    styles.bubbleRow,
                    { justifyContent: mine ? "flex-end" : "flex-start" },
                  ]}
                >
                  <View
                    style={[
                      styles.bubble,
                      {
                        backgroundColor: mine ? colors.primary : colors.card,
                        borderColor: colors.border,
                        borderTopRightRadius: mine ? 4 : 16,
                        borderTopLeftRadius: mine ? 16 : 4,
                      },
                    ]}
                  >
                    {!mine ? (
                      <Text style={[styles.sender, { color: colors.primary }]}>
                        {item.senderName ?? "Usuario"}
                      </Text>
                    ) : null}
                    <Text
                      style={[
                        styles.msgText,
                        { color: mine ? colors.primaryForeground : colors.foreground },
                      ]}
                    >
                      {item.content}
                    </Text>
                    <Text
                      style={[
                        styles.msgTime,
                        {
                          color: mine
                            ? colors.primaryForeground
                            : colors.mutedForeground,
                          opacity: mine ? 0.7 : 1,
                        },
                      ]}
                    >
                      {formatRelative(item.createdAt)}
                    </Text>
                  </View>
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
            placeholder="Mensaje"
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
            disabled={!draft.trim()}
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
  list: { padding: 16, gap: 8, flexGrow: 1 },
  emptyWrap: { flex: 1, transform: [{ scaleY: -1 }], minHeight: 300 },
  bubbleRow: { flexDirection: "row" },
  bubble: {
    maxWidth: "82%",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 3,
  },
  sender: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  msgText: { fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 21 },
  msgTime: { fontSize: 10, fontFamily: "Inter_400Regular", alignSelf: "flex-end" },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 12,
    paddingTop: 10,
    gap: 10,
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
