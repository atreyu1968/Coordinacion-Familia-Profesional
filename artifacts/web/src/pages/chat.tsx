import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type FormEvent,
} from "react";
import {
  useListChatGroups,
  listGroupMessages,
  useSendGroupMessage,
  useEditMessage,
  useDeleteMessage,
  useReactToMessage,
  useForwardMessage,
  useMarkChatRead,
  useListChatMembers,
  getListChatMembersQueryKey,
  useRequestUploadUrl,
  type ChatGroup,
  type Message,
  type ChatMember,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { connectSocket } from "@/lib/socket";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import {
  MessageCircle,
  Send,
  Paperclip,
  Mic,
  Square,
  Smile,
  Search,
  Users,
  Reply,
  Pencil,
  Trash2,
  Forward,
  X,
  Check,
  CheckCheck,
  Download,
  MoreVertical,
  ArrowLeft,
  FileText,
  Image as ImageIcon,
} from "lucide-react";

const TOKEN_KEY = "coordina_adg_token";
const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatTime(value?: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatListTime(value?: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" });
}

function formatSize(bytes?: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Direct chats vs group/module chats get visually distinct accent colours,
// derived purely from the chat type on the frontend.
function isDirect(type?: string): boolean {
  return type === "direct";
}

function accentClasses(type?: string): string {
  return isDirect(type)
    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
    : "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300";
}

function typeLabel(type?: string): string {
  if (type === "direct") return "Directo";
  if (type === "module") return "Módulo";
  return "Grupo";
}

function initials(name?: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "").concat(parts[1]?.[0] ?? "").toUpperCase() || "?";
}

// ---------------------------------------------------------------------------
// Authenticated attachment blob URL hook
// ---------------------------------------------------------------------------
function useAuthedBlobUrl(relativeUrl?: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!relativeUrl) {
      setUrl(null);
      return;
    }
    let objectUrl: string | null = null;
    let cancelled = false;
    const token = localStorage.getItem(TOKEN_KEY);
    fetch(`${import.meta.env.BASE_URL}api/${relativeUrl}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error("fetch"))))
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [relativeUrl]);
  return url;
}

// ---------------------------------------------------------------------------
// Attachment rendering inside a bubble
// ---------------------------------------------------------------------------
function AttachmentView({ message }: { message: Message }) {
  const blobUrl = useAuthedBlobUrl(message.attachmentUrl);

  if (message.kind === "image") {
    if (!blobUrl) {
      return (
        <div className="flex items-center gap-2 text-xs opacity-70 py-2">
          <ImageIcon className="w-4 h-4" /> Cargando imagen…
        </div>
      );
    }
    return (
      <a href={blobUrl} target="_blank" rel="noreferrer">
        <img
          src={blobUrl}
          alt={message.attachmentName ?? "imagen"}
          className="rounded-md max-h-64 max-w-full object-cover"
        />
      </a>
    );
  }

  if (message.kind === "audio") {
    if (!blobUrl) {
      return (
        <div className="flex items-center gap-2 text-xs opacity-70 py-2">
          <Mic className="w-4 h-4" /> Cargando audio…
        </div>
      );
    }
    return <audio controls src={blobUrl} className="max-w-full h-10" />;
  }

  // Generic file
  return (
    <a
      href={blobUrl ?? undefined}
      download={message.attachmentName ?? "documento"}
      className="inline-flex items-center gap-2 rounded-md border bg-background/60 px-3 py-2 text-sm hover:bg-accent"
    >
      {blobUrl ? (
        <Download className="w-4 h-4 shrink-0" />
      ) : (
        <FileText className="w-4 h-4 shrink-0 opacity-70" />
      )}
      <span className="truncate max-w-[12rem]">
        {message.attachmentName ?? "documento"}
      </span>
      {message.attachmentSize != null && (
        <span className="text-xs text-muted-foreground shrink-0">
          {formatSize(message.attachmentSize)}
        </span>
      )}
    </a>
  );
}

// ---------------------------------------------------------------------------
// Single message bubble
// ---------------------------------------------------------------------------
function MessageBubble({
  message,
  mine,
  onReact,
  onReply,
  onEdit,
  onDelete,
  onForward,
}: {
  message: Message;
  mine: boolean;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onForward: () => void;
}) {
  const deleted = message.deleted === true;

  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"} group`}>
      <div className={`flex items-end gap-1 max-w-[80%] ${mine ? "flex-row-reverse" : ""}`}>
        <div
          className={`rounded-2xl px-3 py-2 text-sm shadow-sm ${
            mine
              ? "bg-primary text-primary-foreground rounded-br-sm"
              : "bg-muted text-foreground rounded-bl-sm"
          }`}
        >
          {!mine && !deleted && (
            <div className="text-xs font-semibold mb-0.5 opacity-80">
              {message.senderName ?? "Usuario"}
            </div>
          )}

          {message.forwardedFrom && !deleted && (
            <div className="text-[11px] italic opacity-70 mb-0.5 flex items-center gap-1">
              <Forward className="w-3 h-3" /> Reenviado
            </div>
          )}

          {message.replyToId && !deleted && (
            <div
              className={`text-xs rounded-md px-2 py-1 mb-1 border-l-2 ${
                mine
                  ? "bg-primary-foreground/15 border-primary-foreground/50"
                  : "bg-background/60 border-primary/50"
              }`}
            >
              <div className="font-semibold truncate">
                {message.replyToSenderName ?? "Mensaje"}
              </div>
              <div className="truncate opacity-80">
                {message.replyToContent ?? ""}
              </div>
            </div>
          )}

          {deleted ? (
            <div className="italic opacity-70">🚫 Mensaje eliminado</div>
          ) : (
            <>
              {message.attachmentUrl && (
                <div className="mb-1">
                  <AttachmentView message={message} />
                </div>
              )}
              {message.content && (
                <div className="whitespace-pre-wrap break-words">
                  {message.content}
                </div>
              )}
            </>
          )}

          <div
            className={`flex items-center gap-1 justify-end mt-0.5 text-[10px] ${
              mine ? "text-primary-foreground/70" : "text-muted-foreground"
            }`}
          >
            {message.editedAt && !deleted && <span>editado</span>}
            <span>{formatTime(message.createdAt)}</span>
            {mine && !deleted && (
              <span aria-label="Estado de lectura">
                {(message.readByCount ?? 0) > 0 ? (
                  <CheckCheck className="w-3.5 h-3.5 inline" />
                ) : (
                  <Check className="w-3.5 h-3.5 inline" />
                )}
              </span>
            )}
          </div>

          {/* Reaction chips */}
          {message.reactions && message.reactions.length > 0 && !deleted && (
            <div className="flex flex-wrap gap-1 mt-1">
              {message.reactions.map((r) => (
                <button
                  key={r.emoji}
                  type="button"
                  onClick={() => onReact(r.emoji)}
                  className={`text-xs rounded-full px-1.5 py-0.5 border ${
                    r.reactedByMe
                      ? "bg-primary/20 border-primary/40"
                      : "bg-background/60 border-border"
                  }`}
                >
                  {r.emoji} {r.count}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Action toolbar (hidden until hover) */}
        {!deleted && (
          <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground"
                  aria-label="Reaccionar"
                >
                  <Smile className="w-4 h-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-1 flex gap-1" align="center">
                {QUICK_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => onReact(emoji)}
                    className="text-xl hover:scale-125 transition-transform px-1"
                  >
                    {emoji}
                  </button>
                ))}
              </PopoverContent>
            </Popover>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground"
                  aria-label="Más acciones"
                >
                  <MoreVertical className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align={mine ? "end" : "start"}>
                <DropdownMenuItem onClick={onReply}>
                  <Reply className="w-4 h-4 mr-2" /> Responder
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onForward}>
                  <Forward className="w-4 h-4 mr-2" /> Reenviar
                </DropdownMenuItem>
                {mine && message.kind !== "image" && message.kind !== "file" && message.kind !== "audio" && (
                  <DropdownMenuItem onClick={onEdit}>
                    <Pencil className="w-4 h-4 mr-2" /> Editar
                  </DropdownMenuItem>
                )}
                {mine && (
                  <DropdownMenuItem
                    onClick={onDelete}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="w-4 h-4 mr-2" /> Eliminar
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Members panel
// ---------------------------------------------------------------------------
function MembersDialog({
  groupId,
  open,
  onOpenChange,
}: {
  groupId: number;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { user } = useAuth();
  const { data: members = [], isLoading } = useListChatMembers(groupId, {
    query: { queryKey: getListChatMembersQueryKey(groupId), enabled: open },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" /> Miembros
          </DialogTitle>
          <DialogDescription>
            Participantes de esta conversación.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Cargando…
          </p>
        ) : members.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No hay miembros.
          </p>
        ) : (
          <ul className="space-y-1">
            {members.map((m: ChatMember) => {
              const self = m.userId === user?.id;
              return (
                <li
                  key={m.userId}
                  className={`flex items-center gap-3 rounded-md px-2 py-2 ${
                    self ? "bg-accent" : ""
                  }`}
                >
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="text-xs">
                      {initials(m.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">
                      {m.name ?? "Usuario"}
                      {self && (
                        <span className="text-xs text-muted-foreground"> (tú)</span>
                      )}
                    </div>
                    {m.role && (
                      <div className="text-xs text-muted-foreground capitalize">
                        {m.role.replace("_", " ")}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Forward dialog
// ---------------------------------------------------------------------------
function ForwardDialog({
  message,
  groups,
  open,
  onOpenChange,
}: {
  message: Message | null;
  groups: ChatGroup[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const forwardMut = useForwardMessage();
  const [selected, setSelected] = useState<number[]>([]);

  useEffect(() => {
    if (open) setSelected([]);
  }, [open, message]);

  const toggle = (id: number) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const onConfirm = async () => {
    if (!message || selected.length === 0) return;
    try {
      await forwardMut.mutateAsync({
        id: message.id,
        data: { groupIds: selected },
      });
      toast({ title: "Mensaje reenviado" });
      onOpenChange(false);
    } catch {
      toast({
        title: "Error",
        description: "No se pudo reenviar el mensaje.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Forward className="w-5 h-5" /> Reenviar
          </DialogTitle>
          <DialogDescription>
            Elige a qué conversaciones quieres reenviar este mensaje.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-1">
          {groups.map((g) => (
            <li key={g.id}>
              <label className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-accent cursor-pointer">
                <Checkbox
                  checked={selected.includes(g.id)}
                  onCheckedChange={() => toggle(g.id)}
                />
                <Avatar className="h-8 w-8">
                  <AvatarFallback className={`text-xs ${accentClasses(g.type)}`}>
                    {initials(g.name)}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm truncate">{g.name}</span>
              </label>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button
            onClick={onConfirm}
            disabled={selected.length === 0 || forwardMut.isPending}
          >
            {forwardMut.isPending ? "Reenviando…" : "Reenviar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Conversation view (right pane)
// ---------------------------------------------------------------------------
function ConversationView({
  group,
  groups,
  onBack,
}: {
  group: ChatGroup;
  groups: ChatGroup[];
  onBack: () => void;
}) {
  const { user } = useAuth();
  const token = useMemo(() => localStorage.getItem(TOKEN_KEY), []);
  const groupId = group.id;

  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [forwardMsg, setForwardMsg] = useState<Message | null>(null);
  const [typingNames, setTypingNames] = useState<Record<number, string>>({});
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);

  const sendMut = useSendGroupMessage();
  const editMut = useEditMessage();
  const deleteMut = useDeleteMessage();
  const reactMut = useReactToMessage();
  const markReadMut = useMarkChatRead();
  const uploadMut = useRequestUploadUrl();

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const meId = user?.id;

  // Merge a list/single message into state, replacing by id, sorted asc.
  const mergeMessages = useCallback((incoming: Message[]) => {
    setMessages((prev) => {
      const byId = new Map<number, Message>();
      for (const m of prev) byId.set(m.id, m);
      for (const m of incoming) byId.set(m.id, m);
      return Array.from(byId.values()).sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
    });
  }, []);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessages([]);
    listGroupMessages(groupId)
      .then((data) => {
        if (!cancelled) {
          setMessages(
            [...data].sort(
              (a, b) =>
                new Date(a.createdAt).getTime() -
                new Date(b.createdAt).getTime(),
            ),
          );
        }
      })
      .catch(() => {
        if (!cancelled)
          toast({
            title: "Error",
            description: "No se pudieron cargar los mensajes.",
            variant: "destructive",
          });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  // Realtime wiring
  useEffect(() => {
    if (!token) return;
    const socket = connectSocket(token);
    socket.emit("join", groupId);
    markReadMut.mutate({ id: groupId });

    const onMessage = (msg: Message) => {
      if (msg.groupId !== groupId) return;
      mergeMessages([msg]);
      if (msg.senderId !== meId) markReadMut.mutate({ id: groupId });
    };
    const onUpdate = (msg: Message) => {
      if (msg.groupId !== groupId) return;
      mergeMessages([msg]);
    };
    const onTyping = (p: { groupId: number; userId: number; name: string }) => {
      if (p.groupId !== groupId || p.userId === meId) return;
      setTypingNames((prev) => ({ ...prev, [p.userId]: p.name }));
    };
    const onStopTyping = (p: { groupId: number; userId: number }) => {
      if (p.groupId !== groupId) return;
      setTypingNames((prev) => {
        const next = { ...prev };
        delete next[p.userId];
        return next;
      });
    };

    socket.on("message", onMessage);
    socket.on("message_edited", onUpdate);
    socket.on("message_deleted", onUpdate);
    socket.on("message_reaction", onUpdate);
    socket.on("typing", onTyping);
    socket.on("stop_typing", onStopTyping);

    return () => {
      socket.emit("leave", groupId);
      socket.off("message", onMessage);
      socket.off("message_edited", onUpdate);
      socket.off("message_deleted", onUpdate);
      socket.off("message_reaction", onUpdate);
      socket.off("typing", onTyping);
      socket.off("stop_typing", onStopTyping);
      if (isTypingRef.current) {
        socket.emit("stop_typing", groupId);
        isTypingRef.current = false;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, groupId, meId, mergeMessages]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return messages;
    return messages.filter((m) =>
      (m.content ?? "").toLowerCase().includes(q),
    );
  }, [messages, search]);

  // Typing indicator emit (debounced stop)
  const emitTyping = useCallback(() => {
    if (!token) return;
    const socket = connectSocket(token);
    if (!isTypingRef.current) {
      socket.emit("typing", groupId);
      isTypingRef.current = true;
    }
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      socket.emit("stop_typing", groupId);
      isTypingRef.current = false;
    }, 2000);
  }, [token, groupId]);

  const stopTypingNow = useCallback(() => {
    if (!token) return;
    if (typingTimer.current) clearTimeout(typingTimer.current);
    if (isTypingRef.current) {
      connectSocket(token).emit("stop_typing", groupId);
      isTypingRef.current = false;
    }
  }, [token, groupId]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const content = draft.trim();
    if (!content) return;
    setDraft("");
    stopTypingNow();

    if (editing) {
      const target = editing;
      setEditing(null);
      try {
        const updated = await editMut.mutateAsync({
          id: target.id,
          data: { content },
        });
        mergeMessages([updated]);
      } catch {
        toast({
          title: "Error",
          description: "No se pudo editar el mensaje.",
          variant: "destructive",
        });
      }
      return;
    }

    const reply = replyTo;
    setReplyTo(null);
    try {
      const msg = await sendMut.mutateAsync({
        id: groupId,
        data: { content, kind: "text", replyToId: reply?.id ?? null },
      });
      mergeMessages([msg]);
    } catch {
      toast({
        title: "Error",
        description: "No se pudo enviar el mensaje.",
        variant: "destructive",
      });
    }
  };

  const uploadAndSend = async (file: Blob, name: string, kind: string) => {
    setUploading(true);
    try {
      const res = await uploadMut.mutateAsync({
        data: {
          name,
          size: file.size,
          contentType: file.type || "application/octet-stream",
        },
      });
      await fetch(res.uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      const reply = replyTo;
      setReplyTo(null);
      const msg = await sendMut.mutateAsync({
        id: groupId,
        data: {
          content: "",
          kind,
          replyToId: reply?.id ?? null,
          attachmentPath: res.objectPath,
          attachmentName: name,
          attachmentType: file.type || null,
          attachmentSize: file.size,
        },
      });
      mergeMessages([msg]);
    } catch {
      toast({
        title: "Error",
        description: "No se pudo enviar el archivo.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const onPickFile = (list: FileList | null, kind: "image" | "file") => {
    const file = list?.[0];
    if (file) void uploadAndSend(file, file.name, kind);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (imageInputRef.current) imageInputRef.current.value = "";
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        const ext = (recorder.mimeType || "audio/webm").includes("mp4")
          ? "mp4"
          : "webm";
        stream.getTracks().forEach((t) => t.stop());
        void uploadAndSend(blob, `audio-${Date.now()}.${ext}`, "audio");
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      toast({
        title: "Micrófono no disponible",
        description: "No se pudo acceder al micrófono.",
        variant: "destructive",
      });
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    setRecording(false);
  };

  const onReact = (message: Message, emoji: string) => {
    reactMut.mutate(
      { id: message.id, data: { emoji } },
      { onSuccess: (updated) => mergeMessages([updated]) },
    );
  };

  const onDelete = (message: Message) => {
    deleteMut.mutate(
      { id: message.id },
      {
        onSuccess: (updated) => mergeMessages([updated]),
        onError: () =>
          toast({
            title: "Error",
            description: "No se pudo eliminar el mensaje.",
            variant: "destructive",
          }),
      },
    );
  };

  const startEdit = (message: Message) => {
    setReplyTo(null);
    setEditing(message);
    setDraft(message.content ?? "");
  };

  const typingText = Object.values(typingNames);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 border-b px-4 py-3 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={onBack}
          aria-label="Volver"
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <Avatar className="h-9 w-9">
          <AvatarFallback className={`text-xs ${accentClasses(group.type)}`}>
            {initials(group.name)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="font-semibold truncate">{group.name}</div>
          <div className="text-xs text-muted-foreground">
            {typeLabel(group.type)}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setShowSearch((v) => !v)}
          aria-label="Buscar en la conversación"
        >
          <Search className="w-5 h-5" />
        </Button>
        {!isDirect(group.type) && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowMembers(true)}
            aria-label="Ver miembros"
          >
            <Users className="w-5 h-5" />
          </Button>
        )}
      </div>

      {showSearch && (
        <div className="px-4 py-2 border-b shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar en esta conversación…"
              className="pl-8"
              autoFocus
            />
          </div>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-2">
        {loading ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            Cargando mensajes…
          </p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            {search.trim()
              ? "Sin resultados para tu búsqueda."
              : "No hay mensajes todavía. ¡Escribe el primero!"}
          </p>
        ) : (
          filtered.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              mine={m.senderId === meId}
              onReact={(emoji) => onReact(m, emoji)}
              onReply={() => {
                setEditing(null);
                setReplyTo(m);
              }}
              onEdit={() => startEdit(m)}
              onDelete={() => onDelete(m)}
              onForward={() => setForwardMsg(m)}
            />
          ))
        )}
      </div>

      {/* Typing indicator */}
      {typingText.length > 0 && (
        <div className="px-4 py-1 text-xs text-muted-foreground italic shrink-0">
          {typingText.join(", ")}{" "}
          {typingText.length === 1 ? "está escribiendo…" : "están escribiendo…"}
        </div>
      )}

      {/* Reply / edit preview */}
      {(replyTo || editing) && (
        <div className="px-4 py-2 border-t bg-muted/40 flex items-center gap-2 shrink-0">
          <div className="flex-1 min-w-0 border-l-2 border-primary pl-2">
            <div className="text-xs font-semibold">
              {editing
                ? "Editando mensaje"
                : `Respondiendo a ${replyTo?.senderName ?? "mensaje"}`}
            </div>
            <div className="text-xs text-muted-foreground truncate">
              {editing ? editing.content : replyTo?.content}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => {
              setReplyTo(null);
              setEditing(null);
              setDraft("");
            }}
            aria-label="Cancelar"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      )}

      {/* Composer */}
      <form
        onSubmit={onSubmit}
        className="flex items-end gap-2 border-t px-3 py-3 shrink-0"
      >
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => onPickFile(e.target.files, "image")}
        />
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => onPickFile(e.target.files, "file")}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => imageInputRef.current?.click()}
          disabled={uploading || !!editing}
          aria-label="Adjuntar imagen"
        >
          <ImageIcon className="w-5 h-5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || !!editing}
          aria-label="Adjuntar archivo"
        >
          <Paperclip className="w-5 h-5" />
        </Button>
        <Input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (!editing) emitTyping();
          }}
          placeholder={recording ? "Grabando audio…" : "Escribe un mensaje…"}
          disabled={recording}
          className="flex-1"
        />
        {draft.trim() ? (
          <Button type="submit" size="icon" aria-label="Enviar">
            <Send className="w-5 h-5" />
          </Button>
        ) : recording ? (
          <Button
            type="button"
            size="icon"
            variant="destructive"
            onClick={stopRecording}
            aria-label="Detener grabación"
          >
            <Square className="w-5 h-5" />
          </Button>
        ) : (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={startRecording}
            disabled={uploading || !!editing}
            aria-label="Grabar mensaje de voz"
          >
            <Mic className="w-5 h-5" />
          </Button>
        )}
      </form>

      <MembersDialog
        groupId={groupId}
        open={showMembers}
        onOpenChange={setShowMembers}
      />
      <ForwardDialog
        message={forwardMsg}
        groups={groups}
        open={forwardMsg != null}
        onOpenChange={(v) => {
          if (!v) setForwardMsg(null);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function ChatPage() {
  const token = useMemo(() => localStorage.getItem(TOKEN_KEY), []);
  const { data: groups = [], isLoading, refetch } = useListChatGroups();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filter, setFilter] = useState("");

  // Refresh the chat list on chat_update events (new messages / unread badges).
  useEffect(() => {
    if (!token) return;
    const socket = connectSocket(token);
    const onChatUpdate = () => {
      void refetch();
    };
    socket.on("chat_update", onChatUpdate);
    socket.on("message", onChatUpdate);
    return () => {
      socket.off("chat_update", onChatUpdate);
      socket.off("message", onChatUpdate);
    };
  }, [token, refetch]);

  const sorted = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return [...groups]
      .filter((g) => !q || g.name.toLowerCase().includes(q))
      .sort((a, b) => {
        const ta = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
        const tb = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
        return tb - ta;
      });
  }, [groups, filter]);

  const selected = groups.find((g) => g.id === selectedId) ?? null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <MessageCircle className="w-6 h-6 text-primary" /> Mensajes
        </h1>
        <p className="text-muted-foreground">
          Conversaciones directas y de grupo con tu profesorado y coordinación.
        </p>
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="grid md:grid-cols-[320px_1fr] h-[calc(100vh-16rem)] min-h-[480px]">
            {/* Left: conversation list */}
            <div
              className={`border-r flex flex-col ${
                selected ? "hidden md:flex" : "flex"
              }`}
            >
              <div className="p-3 border-b shrink-0">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Buscar conversación…"
                    className="pl-8"
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {isLoading ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">
                    Cargando…
                  </p>
                ) : sorted.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center px-4">
                    No tienes conversaciones.
                  </p>
                ) : (
                  <ul>
                    {sorted.map((g) => {
                      const active = g.id === selectedId;
                      return (
                        <li key={g.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedId(g.id)}
                            className={`w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-accent transition-colors border-l-2 ${
                              active
                                ? "bg-accent border-primary"
                                : "border-transparent"
                            }`}
                          >
                            <Avatar className="h-10 w-10 shrink-0">
                              <AvatarFallback
                                className={`text-xs ${accentClasses(g.type)}`}
                              >
                                {initials(g.name)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium truncate">
                                  {g.name}
                                </span>
                                <span className="text-[10px] text-muted-foreground shrink-0">
                                  {formatListTime(g.lastMessageAt)}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-2">
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] px-1.5 py-0 ${accentClasses(
                                    g.type,
                                  )} border-transparent`}
                                >
                                  {typeLabel(g.type)}
                                </Badge>
                                {(g.unreadCount ?? 0) > 0 && (
                                  <span className="ml-auto inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold">
                                    {g.unreadCount}
                                  </span>
                                )}
                              </div>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>

            {/* Right: conversation */}
            <div className={`${selected ? "flex" : "hidden md:flex"} flex-col min-w-0`}>
              {selected ? (
                <ConversationView
                  key={selected.id}
                  group={selected}
                  groups={groups}
                  onBack={() => setSelectedId(null)}
                />
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center text-muted-foreground gap-2 p-8">
                  <MessageCircle className="w-12 h-12 opacity-40" />
                  <p>Selecciona una conversación para empezar.</p>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
