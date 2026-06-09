import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";

import {
  listGroupMessages,
  useSendGroupMessage,
  type Message,
} from "@workspace/api-client-react";

import { AppHeader } from "@/components/AppHeader";
import { EmptyState, ErrorState, Loading } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useBadges } from "@/contexts/BadgesContext";
import { useColors } from "@/hooks/useColors";
import { connectSocket } from "@/lib/socket";
import { formatRelative } from "@/lib/format";
import { startCall, roomFromUrl } from "@/lib/call";

const EMOJIS = [
  "😀", "😁", "😂", "🤣", "😊", "😍", "😘", "😎",
  "🤔", "😅", "🙂", "😉", "😢", "😡", "🥳", "😴",
  "👍", "👎", "🙏", "👏", "🙌", "💪", "🤝", "👀",
  "❤️", "🔥", "🎉", "💯", "✅", "❌", "⚠️", "✨",
  "📌", "📅", "📍", "📎", "📝", "☕", "🚀", "⭐",
];

const JITSI_RE = /(https:\/\/meet\.jit\.si\/[^\s]+)/;

function extractCallUrl(content: string): string | null {
  const match = content.match(JITSI_RE);
  return match ? match[1] : null;
}

export default function ChatDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, token } = useAuth();
  const { markChatRead, setActiveChat } = useBadges();
  const params = useLocalSearchParams<{ id: string; name?: string }>();
  const groupId = Number(params.id);

  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showEmojis, setShowEmojis] = useState(false);

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
    // Viewing the chat clears its badge and silences its unread updates.
    setActiveChat(groupId);
    markChatRead(groupId);

    const onMessage = (msg: Message) => {
      if (msg.groupId !== groupId) return;
      mergeMessages([msg]);
    };

    socket.on("message", onMessage);
    return () => {
      socket.emit("leave", groupId);
      socket.off("message", onMessage);
      // Persist the read marker on leave so messages received while the chat
      // was open are counted as read across devices.
      markChatRead(groupId);
      // Leaving the chat re-enables its unread badge for future messages.
      setActiveChat(null);
    };
  }, [token, groupId, mergeMessages, markChatRead, setActiveChat]);

  const onSend = () => {
    const content = draft.trim();
    if (!content) return;
    setDraft("");
    setShowEmojis(false);
    sendMutation.mutate(
      { id: groupId, data: { content } },
      {
        onSuccess: (msg) => mergeMessages([msg]),
      },
    );
  };

  const startGroupCall = (audioOnly: boolean) => {
    if (!Number.isInteger(groupId) || sendMutation.isPending) return;
    const slug =
      `coordinaadg-chat-${groupId}-` +
      `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    const url = `https://meet.jit.si/${slug}`;
    const content = audioOnly
      ? `🔊 Llamada de audio iniciada — únete aquí: ${url}`
      : `📹 Videollamada iniciada — únete aquí: ${url}`;
    // Post the join link first; only open the room once the message has been
    // persisted, so every member can discover and join the same call.
    sendMutation.mutate(
      { id: groupId, data: { content } },
      {
        onSuccess: (msg) => {
          mergeMessages([msg]);
          startCall(router, {
            room: slug,
            title: params.name ?? "Llamada",
            audioOnly,
          });
        },
      },
    );
  };

  const onJoinCall = (url: string, audioOnly: boolean) => {
    const room = roomFromUrl(url);
    if (!room) return;
    startCall(router, {
      room,
      title: params.name ?? "Llamada",
      audioOnly,
    });
  };

  const addEmoji = (emoji: string) => {
    setDraft((prev) => prev + emoji);
  };

  const bottomInset = Platform.OS === "web" ? 16 : insets.bottom;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader
        title={params.name ?? "Conversación"}
        showBack
        right={
          <View style={styles.callActions}>
            <Pressable
              onPress={() => startGroupCall(true)}
              hitSlop={10}
              disabled={sendMutation.isPending}
              style={({ pressed }) => [
                styles.callBtn,
                { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
              ]}
              accessibilityLabel="Iniciar llamada de audio"
            >
              <Feather name="phone" size={18} color={colors.primaryForeground} />
            </Pressable>
            <Pressable
              onPress={() => startGroupCall(false)}
              hitSlop={10}
              disabled={sendMutation.isPending}
              style={({ pressed }) => [
                styles.callBtn,
                { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
              ]}
              accessibilityLabel="Iniciar videollamada"
            >
              <Feather name="video" size={18} color={colors.primaryForeground} />
            </Pressable>
          </View>
        }
      />
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
              const callUrl = extractCallUrl(item.content);
              const audioCall =
                !!callUrl &&
                (item.content.includes("🔊") ||
                  /llamada de audio/i.test(item.content));
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
                    {callUrl ? (
                      <Pressable
                        onPress={() => onJoinCall(callUrl, audioCall)}
                        style={({ pressed }) => [
                          styles.joinBtn,
                          {
                            backgroundColor: mine
                              ? colors.primaryForeground
                              : colors.primary,
                            opacity: pressed ? 0.85 : 1,
                          },
                        ]}
                      >
                        <Feather
                          name={audioCall ? "phone" : "video"}
                          size={15}
                          color={mine ? colors.primary : colors.primaryForeground}
                        />
                        <Text
                          style={[
                            styles.joinText,
                            {
                              color: mine
                                ? colors.primary
                                : colors.primaryForeground,
                            },
                          ]}
                        >
                          {audioCall
                            ? "Unirse a la llamada"
                            : "Unirse a la videollamada"}
                        </Text>
                      </Pressable>
                    ) : null}
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
        {showEmojis ? (
          <View
            style={[
              styles.emojiPanel,
              { backgroundColor: colors.card, borderTopColor: colors.border },
            ]}
          >
            <ScrollView
              contentContainerStyle={styles.emojiGrid}
              keyboardShouldPersistTaps="handled"
            >
              {EMOJIS.map((emoji) => (
                <Pressable
                  key={emoji}
                  onPress={() => addEmoji(emoji)}
                  style={({ pressed }) => [
                    styles.emojiBtn,
                    { opacity: pressed ? 0.5 : 1 },
                  ]}
                >
                  <Text style={styles.emojiText}>{emoji}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}
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
          <Pressable
            onPress={() => setShowEmojis((v) => !v)}
            hitSlop={8}
            style={({ pressed }) => [styles.emojiToggle, { opacity: pressed ? 0.5 : 1 }]}
            accessibilityLabel="Emoticonos"
          >
            <Feather
              name="smile"
              size={24}
              color={showEmojis ? colors.primary : colors.mutedForeground}
            />
          </Pressable>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onFocus={() => setShowEmojis(false)}
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
  callActions: { flexDirection: "row", gap: 8 },
  callBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
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
  joinBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    marginTop: 4,
  },
  joinText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  emojiPanel: {
    maxHeight: 200,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  emojiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    padding: 8,
  },
  emojiBtn: {
    width: "12.5%",
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emojiText: { fontSize: 26 },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 12,
    paddingTop: 10,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  emojiToggle: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
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
