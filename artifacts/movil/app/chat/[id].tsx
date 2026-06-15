import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
  type AudioSource,
} from "expo-audio";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";

import {
  getListChatGroupsQueryKey,
  getListChatMembersQueryKey,
  listGroupMessages,
  useDeleteMessage,
  useEditMessage,
  useForwardMessage,
  useListChatGroups,
  useListChatMembers,
  useReactToMessage,
  useRequestUploadUrl,
  useSendGroupMessage,
  type ChatGroup,
  type ChatMember,
  type Message,
} from "@workspace/api-client-react";

import { AppHeader } from "@/components/AppHeader";
import { EmptyState, ErrorState, Loading } from "@/components/ui";
import { getAuthToken } from "@/contexts/AuthContext";
import { useAuth } from "@/contexts/AuthContext";
import { useBadges } from "@/contexts/BadgesContext";
import { useColors } from "@/hooks/useColors";
import { connectSocket } from "@/lib/socket";
import { formatRelative, initials, roleLabel } from "@/lib/format";

// Full emoji keyboard for composing.
const EMOJIS = [
  "😀", "😁", "😂", "🤣", "😊", "😍", "😘", "😎",
  "🤔", "😅", "🙂", "😉", "😢", "😡", "🥳", "😴",
  "👍", "👎", "🙏", "👏", "🙌", "💪", "🤝", "👀",
  "❤️", "🔥", "🎉", "💯", "✅", "❌", "⚠️", "✨",
  "📌", "📅", "📍", "📎", "📝", "☕", "🚀", "⭐",
];

// Quick reaction bar shown on long-press (WhatsApp-style).
const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

const ON_WEB = Platform.OS === "web";

function apiBase(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  return `https://${domain}/api`;
}

function attachmentFullUrl(message: Message): string | null {
  if (!message.attachmentUrl) return null;
  return `${apiBase()}/${message.attachmentUrl}`;
}

function formatSize(bytes?: number | null): string {
  if (bytes == null || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Fetch a private attachment with the auth header and expose it as a base64
// data URI usable as an <Image>/audio source on both web and native.
function useAuthDataUri(url: string | null): string | null {
  const [dataUri, setDataUri] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!url) {
      setDataUri(null);
      return;
    }
    const token = getAuthToken();
    (async () => {
      try {
        const res = await fetch(url, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const blob = await res.blob();
        const reader = new FileReader();
        reader.onloadend = () => {
          if (!cancelled && typeof reader.result === "string") {
            setDataUri(reader.result);
          }
        };
        reader.readAsDataURL(blob);
      } catch {
        // Leave as null — the bubble shows a fallback.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);
  return dataUri;
}

// Inline image bubble that loads the (private) attachment with auth.
function AuthImage({ url }: { url: string }) {
  const colors = useColors();
  const dataUri = useAuthDataUri(url);
  if (!dataUri) {
    return (
      <View style={[styles.imageLoading, { backgroundColor: colors.muted }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  return (
    <Image source={{ uri: dataUri }} style={styles.image} contentFit="cover" />
  );
}

// Download (web) or open/share (native) an authenticated attachment file.
async function openAttachmentFile(url: string, name: string): Promise<void> {
  const token = getAuthToken();
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  if (Platform.OS === "web") {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error("descarga fallida");
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = name || "documento";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(blobUrl);
    return;
  }
  const safeName = (name || `documento-${Date.now()}`).replace(/[^\w.\-]+/g, "_");
  const target = `${FileSystem.cacheDirectory ?? ""}${safeName}`;
  const dl = await FileSystem.downloadAsync(url, target, { headers });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(dl.uri);
  }
}

// Pressable file attachment chip: downloads (web) / opens (native) on tap.
function FileBubble({
  url,
  name,
  size,
  mine,
}: {
  url: string;
  name: string;
  size: number | null | undefined;
  mine: boolean;
}) {
  const colors = useColors();
  const [busy, setBusy] = useState(false);
  const fg = mine ? colors.primaryForeground : colors.foreground;
  const mutedFg = mine ? "rgba(255,255,255,0.7)" : colors.mutedForeground;
  const onPress = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await openAttachmentFile(url, name);
    } catch {
      Alert.alert("Error", "No se pudo abrir el archivo.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.fileChip,
        { backgroundColor: mine ? "rgba(255,255,255,0.15)" : colors.muted },
      ]}
    >
      <Feather name="file" size={20} color={fg} />
      <View style={styles.flex}>
        <Text style={[styles.fileName, { color: fg }]} numberOfLines={1}>
          {name || "Documento"}
        </Text>
        {size ? (
          <Text style={[styles.fileSize, { color: mutedFg }]}>
            {formatSize(size)}
          </Text>
        ) : null}
      </View>
      {busy ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <Feather name="download" size={18} color={mutedFg} />
      )}
    </Pressable>
  );
}

// Voice-message bubble with play/pause and duration.
function AudioBubble({
  url,
  mine,
}: {
  url: string;
  mine: boolean;
}) {
  const colors = useColors();
  const dataUri = useAuthDataUri(url);
  const source: AudioSource = dataUri ? { uri: dataUri } : null;
  const player = useAudioPlayer(source);
  const status = useAudioPlayerStatus(player);

  const fg = mine ? colors.primaryForeground : colors.foreground;
  const ready = !!dataUri && status.isLoaded;

  const toggle = () => {
    if (!ready) return;
    if (status.playing) {
      player.pause();
    } else {
      if (status.didJustFinish || status.currentTime >= status.duration) {
        void player.seekTo(0);
      }
      player.play();
    }
  };

  const remaining =
    status.duration > 0
      ? status.duration - status.currentTime
      : 0;

  return (
    <Pressable onPress={toggle} style={styles.audioRow}>
      {ready ? (
        <Feather
          name={status.playing ? "pause-circle" : "play-circle"}
          size={32}
          color={fg}
        />
      ) : (
        <ActivityIndicator color={fg} />
      )}
      <View style={styles.audioBarWrap}>
        <View style={[styles.audioBar, { backgroundColor: fg + "44" }]}>
          <View
            style={[
              styles.audioBarFill,
              {
                backgroundColor: fg,
                width:
                  status.duration > 0
                    ? `${Math.min(100, (status.currentTime / status.duration) * 100)}%`
                    : "0%",
              },
            ]}
          />
        </View>
        <Text style={[styles.audioTime, { color: fg, opacity: 0.85 }]}>
          {formatDuration(status.playing || status.currentTime > 0 ? remaining : status.duration)}
        </Text>
      </View>
    </Pressable>
  );
}

function ReadReceipt({ readByCount }: { readByCount: number }) {
  const read = readByCount > 0;
  const color = read ? "#4fc3f7" : "rgba(255,255,255,0.7)";
  return (
    <View style={styles.receipt}>
      <Feather name="check" size={13} color={color} />
      {read ? (
        <Feather name="check" size={13} color={color} style={styles.receiptSecond} />
      ) : null}
    </View>
  );
}

export default function ChatDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { markChatRead, setActiveChat } = useBadges();
  const params = useLocalSearchParams<{ id: string; name?: string }>();
  const groupId = Number(params.id);

  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showEmojis, setShowEmojis] = useState(false);

  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [actionMessage, setActionMessage] = useState<Message | null>(null);
  const [forwarding, setForwarding] = useState<Message | null>(null);
  const [forwardTargets, setForwardTargets] = useState<Set<number>>(new Set());
  const [showMembers, setShowMembers] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [uploading, setUploading] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Record<number, string>>({});

  const sendMutation = useSendGroupMessage();
  const editMutation = useEditMessage();
  const deleteMutation = useDeleteMessage();
  const reactMutation = useReactToMessage();
  const forwardMutation = useForwardMessage();
  const requestUpload = useRequestUploadUrl();

  const membersQuery = useListChatMembers(groupId, {
    query: {
      queryKey: getListChatMembersQueryKey(groupId),
      enabled: showMembers && Number.isInteger(groupId),
    },
  });
  const groupsQuery = useListChatGroups({
    query: {
      queryKey: getListChatGroupsQueryKey(),
      enabled: !!forwarding,
    },
  });

  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(audioRecorder);

  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);

  const mergeMessages = useCallback((incoming: Message[]) => {
    setMessages((prev) => {
      const byId = new Map<number, Message>();
      // Incoming wins so edits / deletes / reactions replace the cached copy.
      for (const m of [...prev, ...incoming]) byId.set(m.id, m);
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

  const { token } = useAuth();

  useEffect(() => {
    if (!token || !Number.isInteger(groupId)) return;
    const socket = connectSocket(token);
    socket.emit("join", groupId);
    setActiveChat(groupId);
    markChatRead(groupId);

    const onMessage = (msg: Message) => {
      if (msg.groupId !== groupId) return;
      mergeMessages([msg]);
    };
    const onEdited = (msg: Message) => {
      if (msg.groupId !== groupId) return;
      mergeMessages([msg]);
    };
    const onDeleted = (msg: Message) => {
      if (msg.groupId !== groupId) return;
      mergeMessages([msg]);
    };
    const onReaction = (msg: Message) => {
      if (msg.groupId !== groupId) return;
      mergeMessages([msg]);
    };
    const onTyping = (payload: { groupId: number; userId: number; name?: string }) => {
      if (payload.groupId !== groupId || payload.userId === user?.id) return;
      setTypingUsers((prev) => ({
        ...prev,
        [payload.userId]: payload.name ?? "Alguien",
      }));
    };
    const onStopTyping = (payload: { groupId: number; userId: number }) => {
      if (payload.groupId !== groupId) return;
      setTypingUsers((prev) => {
        const next = { ...prev };
        delete next[payload.userId];
        return next;
      });
    };

    socket.on("message", onMessage);
    socket.on("message_edited", onEdited);
    socket.on("message_deleted", onDeleted);
    socket.on("message_reaction", onReaction);
    socket.on("typing", onTyping);
    socket.on("stop_typing", onStopTyping);

    return () => {
      if (isTypingRef.current) {
        isTypingRef.current = false;
        socket.emit("stop_typing", groupId);
      }
      socket.emit("leave", groupId);
      socket.off("message", onMessage);
      socket.off("message_edited", onEdited);
      socket.off("message_deleted", onDeleted);
      socket.off("message_reaction", onReaction);
      socket.off("typing", onTyping);
      socket.off("stop_typing", onStopTyping);
      markChatRead(groupId);
      setActiveChat(null);
    };
  }, [token, groupId, mergeMessages, markChatRead, setActiveChat, user?.id]);

  // ----- typing emit -----
  const emitStopTyping = useCallback(() => {
    if (!token || !isTypingRef.current) return;
    isTypingRef.current = false;
    connectSocket(token).emit("stop_typing", groupId);
  }, [token, groupId]);

  const onChangeDraft = (text: string) => {
    setDraft(text);
    if (!token || !Number.isInteger(groupId)) return;
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      connectSocket(token).emit("typing", groupId);
    }
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(emitStopTyping, 2000);
  };

  useEffect(() => {
    return () => {
      if (typingTimeout.current) clearTimeout(typingTimeout.current);
    };
  }, []);

  // ----- send / edit -----
  const onSend = () => {
    const content = draft.trim();
    if (!content) return;
    emitStopTyping();
    setShowEmojis(false);

    if (editing) {
      const target = editing;
      setEditing(null);
      setDraft("");
      editMutation.mutate(
        { id: target.id, data: { content } },
        { onSuccess: (msg) => mergeMessages([msg]) },
      );
      return;
    }

    setDraft("");
    const replyId = replyTo?.id ?? null;
    setReplyTo(null);
    sendMutation.mutate(
      { id: groupId, data: { content, replyToId: replyId } },
      { onSuccess: (msg) => mergeMessages([msg]) },
    );
  };

  const addEmoji = (emoji: string) => setDraft((prev) => prev + emoji);

  // ----- attachments -----
  const uploadAndSend = useCallback(
    async (
      uri: string,
      name: string,
      contentType: string,
      size: number,
      kind: "image" | "file" | "audio",
    ) => {
      setUploading(true);
      const replyId = replyTo?.id ?? null;
      setReplyTo(null);
      try {
        const { uploadURL, objectPath } = await requestUpload.mutateAsync({
          data: { name, size, contentType },
        });
        const blob = await (await fetch(uri)).blob();
        const putRes = await fetch(uploadURL, {
          method: "PUT",
          headers: { "Content-Type": contentType },
          body: blob,
        });
        if (!putRes.ok) throw new Error("upload failed");
        await new Promise<void>((resolve, reject) => {
          sendMutation.mutate(
            {
              id: groupId,
              data: {
                content: "",
                kind,
                replyToId: replyId,
                attachmentPath: objectPath,
                attachmentName: name,
                attachmentType: contentType,
                attachmentSize: size,
              },
            },
            {
              onSuccess: (msg) => {
                mergeMessages([msg]);
                resolve();
              },
              onError: reject,
            },
          );
        });
      } catch {
        Alert.alert("No se pudo enviar", "Inténtalo de nuevo.");
      } finally {
        setUploading(false);
      }
    },
    [groupId, replyTo, requestUpload, sendMutation, mergeMessages],
  );

  const pickImage = async () => {
    setShowAttachMenu(false);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.8,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const contentType = asset.mimeType ?? "image/jpeg";
      const name = asset.fileName ?? `imagen-${Date.now()}.jpg`;
      await uploadAndSend(asset.uri, name, contentType, asset.fileSize ?? 0, "image");
    } catch {
      Alert.alert("No se pudo adjuntar", "Inténtalo de nuevo.");
    }
  };

  const pickFile = async () => {
    setShowAttachMenu(false);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const contentType = asset.mimeType ?? "application/octet-stream";
      await uploadAndSend(
        asset.uri,
        asset.name,
        contentType,
        asset.size ?? 0,
        "file",
      );
    } catch {
      Alert.alert("No se pudo adjuntar", "Inténtalo de nuevo.");
    }
  };

  // ----- voice recording -----
  const startRecording = async () => {
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          "Permiso necesario",
          "Concede acceso al micrófono para grabar mensajes de voz.",
        );
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
    } catch {
      Alert.alert("No se pudo grabar", "Inténtalo de nuevo.");
    }
  };

  const cancelRecording = async () => {
    try {
      await audioRecorder.stop();
    } catch {
      // ignore
    }
  };

  const stopAndSendRecording = async () => {
    try {
      await audioRecorder.stop();
      const uri = audioRecorder.uri;
      if (!uri) return;
      const contentType = ON_WEB ? "audio/webm" : "audio/m4a";
      const ext = ON_WEB ? "webm" : "m4a";
      const blob = await (await fetch(uri)).blob();
      await uploadAndSend(
        uri,
        `audio-${Date.now()}.${ext}`,
        contentType,
        blob.size ?? 0,
        "audio",
      );
    } catch {
      Alert.alert("No se pudo enviar", "Inténtalo de nuevo.");
    }
  };

  // ----- message actions -----
  const onReact = (message: Message, emoji: string) => {
    setActionMessage(null);
    reactMutation.mutate(
      { id: message.id, data: { emoji } },
      { onSuccess: (msg) => mergeMessages([msg]) },
    );
  };

  const onStartReply = (message: Message) => {
    setActionMessage(null);
    setEditing(null);
    setReplyTo(message);
  };

  const onStartEdit = (message: Message) => {
    setActionMessage(null);
    setReplyTo(null);
    setEditing(message);
    setDraft(message.content);
  };

  const onDelete = (message: Message) => {
    setActionMessage(null);
    Alert.alert("Eliminar mensaje", "¿Seguro que quieres eliminarlo?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Eliminar",
        style: "destructive",
        onPress: () =>
          deleteMutation.mutate(
            { id: message.id },
            { onSuccess: (msg) => mergeMessages([msg]) },
          ),
      },
    ]);
  };

  const onStartForward = (message: Message) => {
    setActionMessage(null);
    setForwardTargets(new Set());
    setForwarding(message);
  };

  const toggleForwardTarget = (id: number) => {
    setForwardTargets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const confirmForward = () => {
    if (!forwarding || forwardTargets.size === 0) return;
    const target = forwarding;
    const ids = Array.from(forwardTargets);
    setForwarding(null);
    forwardMutation.mutate(
      { id: target.id, data: { groupIds: ids } },
      {
        onSuccess: (msgs) => {
          const here = msgs.filter((m) => m.groupId === groupId);
          if (here.length) mergeMessages(here);
          Alert.alert("Reenviado", "El mensaje se ha reenviado.");
        },
        onError: () => Alert.alert("Error", "No se pudo reenviar."),
      },
    );
  };

  // ----- derived -----
  const displayed = useMemo(() => {
    const term = searchQuery.trim().toLowerCase();
    if (!term) return messages;
    return messages.filter(
      (m) => !m.deleted && (m.content ?? "").toLowerCase().includes(term),
    );
  }, [messages, searchQuery]);

  const typingNames = Object.values(typingUsers);
  const typingLabel =
    typingNames.length === 1
      ? `${typingNames[0]} está escribiendo…`
      : typingNames.length > 1
        ? "Varias personas están escribiendo…"
        : null;

  const bottomInset = ON_WEB ? 16 : insets.bottom;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader
        title={params.name ?? "Conversación"}
        showBack
        right={
          <View style={styles.headerActions}>
            <Pressable
              onPress={() => {
                setShowSearch((v) => !v);
                if (showSearch) setSearchQuery("");
              }}
              hitSlop={12}
              style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
              accessibilityLabel="Buscar en la conversación"
            >
              <Feather name="search" size={22} color="#ffffff" />
            </Pressable>
            <Pressable
              onPress={() => setShowMembers(true)}
              hitSlop={12}
              style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
              accessibilityLabel="Miembros"
            >
              <Feather name="users" size={22} color="#ffffff" />
            </Pressable>
          </View>
        }
      />
      {showSearch ? (
        <View
          style={[
            styles.searchBar,
            { backgroundColor: colors.card, borderBottomColor: colors.border },
          ]}
        >
          <Feather name="search" size={18} color={colors.mutedForeground} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Buscar en la conversación"
            placeholderTextColor={colors.mutedForeground}
            autoFocus
            style={[styles.searchInput, { color: colors.foreground }]}
          />
          {searchQuery.length > 0 ? (
            <Pressable onPress={() => setSearchQuery("")} hitSlop={8}>
              <Feather name="x" size={18} color={colors.mutedForeground} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
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
            data={displayed}
            inverted
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <EmptyState
                  icon={searchQuery.trim() ? "search" : "message-circle"}
                  title={searchQuery.trim() ? "Sin resultados" : "Sin mensajes"}
                  message={
                    searchQuery.trim()
                      ? "No hay mensajes que coincidan."
                      : "Escribe el primer mensaje de esta conversación."
                  }
                />
              </View>
            }
            renderItem={({ item }) => (
              <MessageBubble
                message={item}
                mine={item.senderId === user?.id}
                colors={colors}
                onLongPress={() => setActionMessage(item)}
                onReact={(emoji) => onReact(item, emoji)}
              />
            )}
          />
        )}

        {typingLabel ? (
          <Text style={[styles.typing, { color: colors.mutedForeground }]}>
            {typingLabel}
          </Text>
        ) : null}

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

        {/* Reply / edit preview */}
        {replyTo ? (
          <View
            style={[
              styles.composePreview,
              { backgroundColor: colors.card, borderTopColor: colors.border },
            ]}
          >
            <View style={[styles.previewBar, { backgroundColor: colors.primary }]} />
            <View style={styles.flex}>
              <Text style={[styles.previewTitle, { color: colors.primary }]}>
                Respondiendo a {replyTo.senderName ?? "mensaje"}
              </Text>
              <Text
                style={[styles.previewBody, { color: colors.mutedForeground }]}
                numberOfLines={1}
              >
                {replyTo.deleted ? "Mensaje eliminado" : replyTo.content || "Archivo adjunto"}
              </Text>
            </View>
            <Pressable onPress={() => setReplyTo(null)} hitSlop={8}>
              <Feather name="x" size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>
        ) : null}
        {editing ? (
          <View
            style={[
              styles.composePreview,
              { backgroundColor: colors.card, borderTopColor: colors.border },
            ]}
          >
            <View style={[styles.previewBar, { backgroundColor: colors.secondary }]} />
            <View style={styles.flex}>
              <Text style={[styles.previewTitle, { color: colors.foreground }]}>
                Editando mensaje
              </Text>
              <Text
                style={[styles.previewBody, { color: colors.mutedForeground }]}
                numberOfLines={1}
              >
                {editing.content}
              </Text>
            </View>
            <Pressable
              onPress={() => {
                setEditing(null);
                setDraft("");
              }}
              hitSlop={8}
            >
              <Feather name="x" size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>
        ) : null}

        {/* Recording bar */}
        {recorderState.isRecording ? (
          <View
            style={[
              styles.recordingBar,
              {
                backgroundColor: colors.background,
                borderTopColor: colors.border,
                paddingBottom: bottomInset + 8,
              },
            ]}
          >
            <Pressable onPress={cancelRecording} hitSlop={8} style={styles.recordCancel}>
              <Feather name="trash-2" size={22} color={colors.destructive} />
            </Pressable>
            <View style={styles.recordingInfo}>
              <View style={[styles.recordDot, { backgroundColor: colors.destructive }]} />
              <Text style={[styles.recordTime, { color: colors.foreground }]}>
                Grabando… {formatDuration(recorderState.durationMillis / 1000)}
              </Text>
            </View>
            <Pressable
              onPress={stopAndSendRecording}
              style={({ pressed }) => [
                styles.sendBtn,
                { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <Feather name="arrow-up" size={22} color={colors.primaryForeground} />
            </Pressable>
          </View>
        ) : (
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
              style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.5 : 1 }]}
              accessibilityLabel="Emoticonos"
            >
              <Feather
                name="smile"
                size={24}
                color={showEmojis ? colors.primary : colors.mutedForeground}
              />
            </Pressable>
            <Pressable
              onPress={() => setShowAttachMenu(true)}
              hitSlop={8}
              disabled={uploading}
              style={({ pressed }) => [
                styles.iconBtn,
                { opacity: uploading ? 0.4 : pressed ? 0.5 : 1 },
              ]}
              accessibilityLabel="Adjuntar"
            >
              {uploading ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Feather name="paperclip" size={23} color={colors.mutedForeground} />
              )}
            </Pressable>
            <TextInput
              value={draft}
              onChangeText={onChangeDraft}
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
            {draft.trim() || editing ? (
              <Pressable
                onPress={onSend}
                style={({ pressed }) => [
                  styles.sendBtn,
                  { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
                ]}
              >
                <Feather
                  name={editing ? "check" : "arrow-up"}
                  size={22}
                  color={colors.primaryForeground}
                />
              </Pressable>
            ) : (
              <Pressable
                onPress={startRecording}
                style={({ pressed }) => [
                  styles.sendBtn,
                  { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
                ]}
                accessibilityLabel="Grabar mensaje de voz"
              >
                <Feather name="mic" size={22} color={colors.primaryForeground} />
              </Pressable>
            )}
          </View>
        )}
      </KeyboardAvoidingView>

      {/* Attach menu */}
      <Modal
        visible={showAttachMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAttachMenu(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setShowAttachMenu(false)}>
          <View
            style={[
              styles.sheet,
              { backgroundColor: colors.card, paddingBottom: bottomInset + 16 },
            ]}
          >
            <Pressable style={styles.sheetItem} onPress={pickImage}>
              <Feather name="image" size={22} color={colors.primary} />
              <Text style={[styles.sheetText, { color: colors.foreground }]}>Imagen</Text>
            </Pressable>
            <Pressable style={styles.sheetItem} onPress={pickFile}>
              <Feather name="file" size={22} color={colors.primary} />
              <Text style={[styles.sheetText, { color: colors.foreground }]}>Archivo</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Message action menu */}
      <Modal
        visible={!!actionMessage}
        transparent
        animationType="fade"
        onRequestClose={() => setActionMessage(null)}
      >
        <Pressable style={styles.backdrop} onPress={() => setActionMessage(null)}>
          <View
            style={[
              styles.sheet,
              { backgroundColor: colors.card, paddingBottom: bottomInset + 16 },
            ]}
          >
            <View style={styles.reactionBar}>
              {QUICK_REACTIONS.map((emoji) => (
                <Pressable
                  key={emoji}
                  onPress={() => actionMessage && onReact(actionMessage, emoji)}
                  style={({ pressed }) => [
                    styles.reactionBtn,
                    { opacity: pressed ? 0.5 : 1 },
                  ]}
                >
                  <Text style={styles.reactionEmoji}>{emoji}</Text>
                </Pressable>
              ))}
            </View>
            {actionMessage && !actionMessage.deleted ? (
              <>
                <Pressable
                  style={styles.sheetItem}
                  onPress={() => onStartReply(actionMessage)}
                >
                  <Feather name="corner-up-left" size={20} color={colors.foreground} />
                  <Text style={[styles.sheetText, { color: colors.foreground }]}>
                    Responder
                  </Text>
                </Pressable>
                <Pressable
                  style={styles.sheetItem}
                  onPress={() => onStartForward(actionMessage)}
                >
                  <Feather name="corner-up-right" size={20} color={colors.foreground} />
                  <Text style={[styles.sheetText, { color: colors.foreground }]}>
                    Reenviar
                  </Text>
                </Pressable>
                {actionMessage.senderId === user?.id ? (
                  <>
                    {actionMessage.kind === "text" || !actionMessage.kind ? (
                      <Pressable
                        style={styles.sheetItem}
                        onPress={() => onStartEdit(actionMessage)}
                      >
                        <Feather name="edit-2" size={20} color={colors.foreground} />
                        <Text style={[styles.sheetText, { color: colors.foreground }]}>
                          Editar
                        </Text>
                      </Pressable>
                    ) : null}
                    <Pressable
                      style={styles.sheetItem}
                      onPress={() => onDelete(actionMessage)}
                    >
                      <Feather name="trash-2" size={20} color={colors.destructive} />
                      <Text style={[styles.sheetText, { color: colors.destructive }]}>
                        Eliminar
                      </Text>
                    </Pressable>
                  </>
                ) : null}
              </>
            ) : null}
          </View>
        </Pressable>
      </Modal>

      {/* Forward target picker */}
      <Modal
        visible={!!forwarding}
        transparent
        animationType="slide"
        onRequestClose={() => setForwarding(null)}
      >
        <View style={styles.backdrop}>
          <View
            style={[
              styles.fullSheet,
              { backgroundColor: colors.background, paddingBottom: bottomInset + 16 },
            ]}
          >
            <View style={[styles.sheetHeader, { borderBottomColor: colors.border }]}>
              <Pressable onPress={() => setForwarding(null)} hitSlop={8}>
                <Text style={[styles.sheetCancel, { color: colors.primary }]}>Cancelar</Text>
              </Pressable>
              <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Reenviar a</Text>
              <Pressable
                onPress={confirmForward}
                disabled={forwardTargets.size === 0}
                hitSlop={8}
              >
                <Text
                  style={[
                    styles.sheetCancel,
                    { color: forwardTargets.size === 0 ? colors.mutedForeground : colors.primary },
                  ]}
                >
                  Enviar
                </Text>
              </Pressable>
            </View>
            <FlatList
              data={(groupsQuery.data ?? []) as ChatGroup[]}
              keyExtractor={(g) => String(g.id)}
              renderItem={({ item }) => {
                const selected = forwardTargets.has(item.id);
                return (
                  <Pressable
                    style={[styles.forwardRow, { borderBottomColor: colors.border }]}
                    onPress={() => toggleForwardTarget(item.id)}
                  >
                    <Feather
                      name={selected ? "check-circle" : "circle"}
                      size={22}
                      color={selected ? colors.primary : colors.mutedForeground}
                    />
                    <Text style={[styles.forwardName, { color: colors.foreground }]} numberOfLines={1}>
                      {item.name}
                    </Text>
                  </Pressable>
                );
              }}
            />
          </View>
        </View>
      </Modal>

      {/* Members panel */}
      <Modal
        visible={showMembers}
        transparent
        animationType="slide"
        onRequestClose={() => setShowMembers(false)}
      >
        <View style={styles.backdrop}>
          <View
            style={[
              styles.fullSheet,
              { backgroundColor: colors.background, paddingBottom: bottomInset + 16 },
            ]}
          >
            <View style={[styles.sheetHeader, { borderBottomColor: colors.border }]}>
              <View style={{ width: 60 }} />
              <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Miembros</Text>
              <Pressable onPress={() => setShowMembers(false)} hitSlop={8}>
                <Text style={[styles.sheetCancel, { color: colors.primary }]}>Cerrar</Text>
              </Pressable>
            </View>
            {membersQuery.isLoading ? (
              <Loading />
            ) : (
              <FlatList
                data={(membersQuery.data ?? []) as ChatMember[]}
                keyExtractor={(m) => String(m.userId)}
                ListEmptyComponent={
                  <EmptyState icon="users" title="Sin miembros" />
                }
                renderItem={({ item }) => {
                  const self = item.userId === user?.id;
                  return (
                    <View style={[styles.memberRow, { borderBottomColor: colors.border }]}>
                      <View style={[styles.memberAvatar, { backgroundColor: colors.accent }]}>
                        <Text style={[styles.memberInitials, { color: colors.accentForeground }]}>
                          {initials(item.name)}
                        </Text>
                      </View>
                      <View style={styles.flex}>
                        <Text style={[styles.memberName, { color: colors.foreground }]} numberOfLines={1}>
                          {item.name ?? "Usuario"}
                          {self ? " (tú)" : ""}
                        </Text>
                        {item.role ? (
                          <Text style={[styles.memberRole, { color: colors.mutedForeground }]}>
                            {roleLabel(item.role)}
                          </Text>
                        ) : null}
                      </View>
                      {self ? (
                        <View style={[styles.selfBadge, { backgroundColor: colors.primary }]}>
                          <Text style={[styles.selfBadgeText, { color: colors.primaryForeground }]}>
                            Tú
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  );
                }}
              />
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function MessageBubble({
  message,
  mine,
  colors,
  onLongPress,
  onReact,
}: {
  message: Message;
  mine: boolean;
  colors: ReturnType<typeof useColors>;
  onLongPress: () => void;
  onReact: (emoji: string) => void;
}) {
  const attachmentUrl = attachmentFullUrl(message);
  const kind = message.kind ?? "text";
  const bubbleBg = mine ? colors.primary : colors.card;
  const fg = mine ? colors.primaryForeground : colors.foreground;
  const mutedFg = mine ? colors.primaryForeground : colors.mutedForeground;

  return (
    <View
      style={[
        styles.bubbleRow,
        { justifyContent: mine ? "flex-end" : "flex-start" },
      ]}
    >
      <Pressable
        onLongPress={onLongPress}
        delayLongPress={250}
        style={[
          styles.bubble,
          {
            backgroundColor: bubbleBg,
            borderColor: colors.border,
            borderTopRightRadius: mine ? 4 : 16,
            borderTopLeftRadius: mine ? 16 : 4,
          },
        ]}
      >
        {!mine ? (
          <Text style={[styles.sender, { color: colors.primary }]}>
            {message.senderName ?? "Usuario"}
          </Text>
        ) : null}

        {message.forwardedFrom ? (
          <Text style={[styles.forwarded, { color: mutedFg }]}>↪ Reenviado</Text>
        ) : null}

        {/* Quoted reply */}
        {message.replyToId ? (
          <View
            style={[
              styles.quote,
              {
                backgroundColor: mine ? "rgba(255,255,255,0.15)" : colors.muted,
                borderLeftColor: mine ? colors.primaryForeground : colors.primary,
              },
            ]}
          >
            <Text style={[styles.quoteName, { color: fg }]} numberOfLines={1}>
              {message.replyToSenderName ?? "Mensaje"}
            </Text>
            <Text style={[styles.quoteBody, { color: mutedFg }]} numberOfLines={2}>
              {message.replyToContent ?? "Archivo adjunto"}
            </Text>
          </View>
        ) : null}

        {message.deleted ? (
          <Text style={[styles.deletedText, { color: mutedFg }]}>
            🚫 Mensaje eliminado
          </Text>
        ) : (
          <>
            {kind === "image" && attachmentUrl ? (
              <AuthImage url={attachmentUrl} />
            ) : null}
            {kind === "audio" && attachmentUrl ? (
              <AudioBubble url={attachmentUrl} mine={mine} />
            ) : null}
            {kind === "file" && attachmentUrl ? (
              <FileBubble
                url={attachmentUrl}
                name={message.attachmentName ?? "Documento"}
                size={message.attachmentSize}
                mine={mine}
              />
            ) : null}

            {message.content ? (
              <Text style={[styles.msgText, { color: fg }]}>{message.content}</Text>
            ) : null}
          </>
        )}

        {/* Reaction chips */}
        {message.reactions && message.reactions.length > 0 ? (
          <View style={styles.reactionChips}>
            {message.reactions.map((r) => (
              <Pressable
                key={r.emoji}
                onPress={() => onReact(r.emoji)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: r.reactedByMe
                      ? colors.primary + "33"
                      : mine
                        ? "rgba(255,255,255,0.18)"
                        : colors.muted,
                    borderColor: r.reactedByMe ? colors.primary : "transparent",
                  },
                ]}
              >
                <Text style={styles.chipEmoji}>{r.emoji}</Text>
                <Text style={[styles.chipCount, { color: fg }]}>{r.count}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <View style={styles.metaRow}>
          {message.editedAt && !message.deleted ? (
            <Text style={[styles.edited, { color: mutedFg }]}>editado</Text>
          ) : null}
          <Text
            style={[styles.msgTime, { color: mutedFg, opacity: mine ? 0.8 : 1 }]}
          >
            {formatRelative(message.createdAt)}
          </Text>
          {mine && !message.deleted ? (
            <ReadReceipt readByCount={message.readByCount ?? 0} />
          ) : null}
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 18 },
  list: { padding: 16, gap: 8, flexGrow: 1 },
  emptyWrap: { flex: 1, transform: [{ scaleY: -1 }], minHeight: 300 },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  bubbleRow: { flexDirection: "row" },
  bubble: {
    maxWidth: "82%",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  sender: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  forwarded: { fontSize: 11, fontFamily: "Inter_500Medium", fontStyle: "italic" },
  msgText: { fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 21 },
  deletedText: { fontSize: 15, fontFamily: "Inter_400Regular", fontStyle: "italic" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-end" },
  edited: { fontSize: 10, fontFamily: "Inter_400Regular", fontStyle: "italic" },
  msgTime: { fontSize: 10, fontFamily: "Inter_400Regular" },
  receipt: { flexDirection: "row", alignItems: "center", width: 18 },
  receiptSecond: { marginLeft: -8 },
  quote: {
    borderLeftWidth: 3,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    gap: 2,
  },
  quoteName: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  quoteBody: { fontSize: 12, fontFamily: "Inter_400Regular" },
  image: { width: 220, height: 220, borderRadius: 10 },
  imageLoading: {
    width: 220,
    height: 220,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  audioRow: { flexDirection: "row", alignItems: "center", gap: 10, minWidth: 200 },
  audioBarWrap: { flex: 1, gap: 4 },
  audioBar: { height: 4, borderRadius: 2, overflow: "hidden" },
  audioBarFill: { height: 4, borderRadius: 2 },
  audioTime: { fontSize: 11, fontFamily: "Inter_400Regular" },
  fileChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderRadius: 10,
    minWidth: 200,
  },
  fileName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  fileSize: { fontSize: 11, fontFamily: "Inter_400Regular" },
  reactionChips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 2 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipEmoji: { fontSize: 13 },
  chipCount: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  typing: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    fontStyle: "italic",
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  emojiPanel: { maxHeight: 200, borderTopWidth: StyleSheet.hairlineWidth },
  emojiGrid: { flexDirection: "row", flexWrap: "wrap", padding: 8 },
  emojiBtn: { width: "12.5%", aspectRatio: 1, alignItems: "center", justifyContent: "center" },
  emojiText: { fontSize: 26 },
  composePreview: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  previewBar: { width: 4, alignSelf: "stretch", borderRadius: 2 },
  previewTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  previewBody: { fontSize: 13, fontFamily: "Inter_400Regular" },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 10,
    paddingTop: 10,
    gap: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: { width: 40, height: 42, alignItems: "center", justifyContent: "center" },
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
  recordingBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingTop: 10,
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  recordCancel: { width: 42, height: 42, alignItems: "center", justifyContent: "center" },
  recordingInfo: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  recordDot: { width: 12, height: 12, borderRadius: 6 },
  recordTime: { fontSize: 15, fontFamily: "Inter_500Medium" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingTop: 8 },
  sheetItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 22,
    paddingVertical: 15,
  },
  sheetText: { fontSize: 16, fontFamily: "Inter_500Medium" },
  reactionBar: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  reactionBtn: { padding: 6 },
  reactionEmoji: { fontSize: 30 },
  fullSheet: {
    height: "75%",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    overflow: "hidden",
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  sheetCancel: { fontSize: 15, fontFamily: "Inter_500Medium", minWidth: 60 },
  forwardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  forwardName: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium" },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  memberAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  memberInitials: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  memberName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  memberRole: { fontSize: 13, fontFamily: "Inter_400Regular" },
  selfBadge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  selfBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
});
