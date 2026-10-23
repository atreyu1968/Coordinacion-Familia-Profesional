import { AutoLinkText } from "@/components/auto-link-text";
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type FormEvent,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListChatGroups,
  getListChatGroupsQueryKey,
  useListChatContacts,
  getListChatContactsQueryKey,
  useCreateChatGroup,
  listGroupMessages,
  useSendGroupMessage,
  useEditMessage,
  useDeleteMessage,
  useHideMessageForMe,
  useListHiddenGroupMessages,
  getListHiddenGroupMessagesQueryKey,
  useRestoreHiddenMessage,
  useHideChatGroupForMe,
  useRestoreChatGroupForMe,
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
import { useModuleParam } from "@/lib/use-module-param";
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
  EyeOff,
  Eye,
  FileText,
  Image as ImageIcon,
} from "lucide-react";
import { HtmlDocxDownloadButton, isHtmlDocumentName } from "@/components/html-docx-download-button";
import { PdfPreviewDialog, isPdfDocument } from "@/components/pdf-preview-dialog";
import { CreateChatGroupDialog, LeaveChatGroupButton } from "@/components/chat-group-actions";

const TOKEN_KEY = "coordina_adg_token";
const CHAT_PAGE_SIZE = 200;
const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
const EMOJIS = [
  "😀", "😁", "😂", "🤣", "😊", "😍", "😘", "😎",
  "🤔", "😅", "🙂", "😉", "😢", "😡", "🥳", "😴",
  "👍", "👎", "🙏", "👏", "🙌", "💪", "🤝", "👀",
  "❤️", "🔥", "🎉", "💯", "✅", "❌", "⚠️", "✨",
  "📌", "📅", "📍", "📎", "📝", "☕", "🚀", "⭐",
];

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
    <div className="flex flex-wrap items-center gap-2">
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
      {isPdfDocument(message.attachmentName, message.attachmentType) && (
        <PdfPreviewDialog
          title={message.attachmentName ?? "Documento PDF"}
          loadPdf={async () => {
            if (!blobUrl) throw new Error("El archivo todavía no está disponible.");
            const response = await fetch(blobUrl);
            if (!response.ok) throw new Error("No se pudo abrir el archivo adjunto.");
            return response.blob();
          }}
        />
      )}
      {isHtmlDocumentName(message.attachmentName ?? "") && (
        <HtmlDocxDownloadButton
          fileName={message.attachmentName ?? "documento.html"}
          testId={`button-download-chat-attachment-docx-${message.id}`}
          disabled={!blobUrl}
          loadHtml={async () => {
            if (!blobUrl) throw new Error("El archivo todavía no está disponible");
            const token = localStorage.getItem(TOKEN_KEY);
            const response = await fetch(blobUrl);
            if (!response.ok) throw new Error("No se pudo descargar el archivo");
            return {
              blob: await response.blob(),
              baseUrl: new URL(`${import.meta.env.BASE_URL}api/${message.attachmentUrl}`, window.location.href).href,
              imageHeaders: token ? { Authorization: `Bearer ${token}` } : undefined,
            };
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single message bubble
// ---------------------------------------------------------------------------
function chatMemberRole(role: string | null | undefined): string {
  switch (role) {
    case "teacher":
      return "Docente";
    case "coordinator":
      return "Coordinador/a";
    case "department_head":
      return "Jefe/a de departamento";
    case "superadmin":
      return "Administrador/a";
    default:
      return role?.replaceAll("_", " ") || "Cargo no indicado";
  }
}

function MessageBubble({
  message,
  mine,
  senderMeta,
  onReact,
  onReply,
  onEdit,
  onDelete,
  onHideForMe,
  onForward,
}: {
  message: Message;
  mine: boolean;
  senderMeta?: Pick<ChatMember, "role" | "centerName">;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onHideForMe: () => void;
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
            <div className="mb-0.5">
              <div className="text-xs font-semibold opacity-80">
                {message.senderName ?? "Usuario"}
              </div>
              <div className="text-[10px] opacity-65">
                {chatMemberRole(senderMeta?.role)} · {senderMeta?.centerName ?? "Sin centro indicado"}
              </div>
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
                  <AutoLinkText text={message.content} />
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
          <div className="flex items-center opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 transition-opacity">
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
                    onClick={onHideForMe}
                  >
                    <EyeOff className="w-4 h-4 mr-2" /> Ocultar solo para mí
                  </DropdownMenuItem>
                )}
                {mine && (
                  <DropdownMenuItem
                    onClick={onDelete}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="w-4 h-4 mr-2" /> Eliminar para todos
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
                    <div className="text-xs text-muted-foreground">
                      {chatMemberRole(m.role)} · {m.centerName ?? "Sin centro indicado"}
                    </div>
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
  const membersQuery = useListChatMembers(groupId, {
    query: {
      queryKey: getListChatMembersQueryKey(groupId),
      enabled: Number.isInteger(groupId),
    },
  });
  const members = membersQuery.data ?? [];
  const membersByUserId = useMemo(
    () => new Map(members.map((member) => [member.userId, member])),
    [members],
  );
  const directParticipant =
    group.type === "direct"
      ? members.find((member) => member.userId !== user?.id)
      : undefined;

  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [showHiddenMessages, setShowHiddenMessages] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [forwardMsg, setForwardMsg] = useState<Message | null>(null);
  const [typingNames, setTypingNames] = useState<Record<number, string>>({});
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showEmojis, setShowEmojis] = useState(false);

  const sendMut = useSendGroupMessage();
  const editMut = useEditMessage();
  const deleteMut = useDeleteMessage();
  const hideMessageMut = useHideMessageForMe();
  const restoreHiddenMessageMut = useRestoreHiddenMessage();
  const hiddenMessagesQuery = useListHiddenGroupMessages(groupId, {
    query: {
      queryKey: getListHiddenGroupMessagesQueryKey(groupId),
      enabled: showHiddenMessages,
    },
  });
  const reactMut = useReactToMessage();
  const markReadMut = useMarkChatRead();
  const uploadMut = useRequestUploadUrl();
  const queryClient = useQueryClient();

  const scrollRef = useRef<HTMLDivElement>(null);
  const preserveScrollHeightRef = useRef<number | null>(null);
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
    setHasOlder(false);
    setLoadingOlder(false);
    preserveScrollHeightRef.current = null;
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
          setHasOlder(data.length === CHAT_PAGE_SIZE);
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

  const loadOlderMessages = useCallback(async () => {
    const beforeId = messages[0]?.id;
    if (!hasOlder || loadingOlder || beforeId == null) return;
    setLoadingOlder(true);
    try {
      const older = await listGroupMessages(groupId, { beforeId });
      setHasOlder(older.length === CHAT_PAGE_SIZE);
      if (older.length > 0) {
        preserveScrollHeightRef.current = scrollRef.current?.scrollHeight ?? null;
        mergeMessages(older);
      }
    } catch {
      toast({
        title: "Error",
        description: "No se pudieron cargar los mensajes anteriores.",
        variant: "destructive",
      });
    } finally {
      setLoadingOlder(false);
    }
  }, [groupId, hasOlder, loadingOlder, messages, mergeMessages]);

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
      void queryClient.invalidateQueries({
        queryKey: getListHiddenGroupMessagesQueryKey(groupId),
      });
    };
    const onHiddenForMe = (event: { groupId: number; messageId: number }) => {
      if (event.groupId !== groupId) return;
      setMessages((previous) =>
        previous.filter((message) => message.id !== event.messageId),
      );
      void queryClient.invalidateQueries({
        queryKey: getListHiddenGroupMessagesQueryKey(groupId),
      });
    };
    const onRestoredForMe = (event: { groupId: number; message: Message }) => {
      if (event.groupId !== groupId) return;
      mergeMessages([event.message]);
      void queryClient.invalidateQueries({
        queryKey: getListHiddenGroupMessagesQueryKey(groupId),
      });
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
    socket.on("message_hidden_for_me", onHiddenForMe);
    socket.on("message_restored_for_me", onRestoredForMe);
    socket.on("typing", onTyping);
    socket.on("stop_typing", onStopTyping);

    return () => {
      socket.emit("leave", groupId);
      socket.off("message", onMessage);
      socket.off("message_edited", onUpdate);
      socket.off("message_deleted", onUpdate);
      socket.off("message_reaction", onUpdate);
      socket.off("message_hidden_for_me", onHiddenForMe);
      socket.off("message_restored_for_me", onRestoredForMe);
      socket.off("typing", onTyping);
      socket.off("stop_typing", onStopTyping);
      if (isTypingRef.current) {
        socket.emit("stop_typing", groupId);
        isTypingRef.current = false;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, groupId, meId, mergeMessages, queryClient]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      if (preserveScrollHeightRef.current !== null) {
        scrollRef.current.scrollTop +=
          scrollRef.current.scrollHeight - preserveScrollHeightRef.current;
        preserveScrollHeightRef.current = null;
        return;
      }
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
    if (
      !window.confirm(
        "Se sustituirá este mensaje por «Mensaje eliminado» para todas las personas de la conversación. ¿Continuar?",
      )
    ) {
      return;
    }
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

  const onHideForMe = (message: Message) => {
    hideMessageMut.mutate(
      { id: message.id },
      {
        onSuccess: () =>
          setMessages((previous) =>
            previous.filter((candidate) => candidate.id !== message.id),
          ),
        onError: () =>
          toast({
            title: "Error",
            description: "No se pudo ocultar el mensaje para ti.",
            variant: "destructive",
          }),
      },
    );
  };

  const onRestoreHiddenMessage = (message: Message) => {
    restoreHiddenMessageMut.mutate(
      { id: message.id },
      {
        onSuccess: (restored) => {
          mergeMessages([restored]);
          void queryClient.invalidateQueries({
            queryKey: getListHiddenGroupMessagesQueryKey(groupId),
          });
          toast({ title: "Mensaje restaurado" });
        },
        onError: () =>
          toast({
            title: "Error",
            description: "No se pudo restaurar el mensaje.",
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
            {directParticipant
              ? `${chatMemberRole(directParticipant.role)} · ${directParticipant.centerName ?? "Sin centro indicado"}`
              : typeLabel(group.type)}
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
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setShowMembers(true)}
          aria-label="Ver participantes"
        >
          <Users className="w-5 h-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setShowHiddenMessages(true)}
          aria-label="Ver mensajes ocultos"
          title="Mensajes ocultos"
        >
          <EyeOff className="w-5 h-5" />
        </Button>
        <LeaveChatGroupButton group={group} onLeft={onBack} />
      </div>

      <Dialog open={showHiddenMessages} onOpenChange={setShowHiddenMessages}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <EyeOff className="w-5 h-5" /> Mensajes ocultos
            </DialogTitle>
            <DialogDescription>
              Solo tú ves esta lista. Restaurar un mensaje no cambia lo que ven las demás personas.
            </DialogDescription>
          </DialogHeader>
          {hiddenMessagesQuery.isLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Cargando…</p>
          ) : hiddenMessagesQuery.isError ? (
            <div className="py-4 text-sm">
              No se pudieron cargar los mensajes ocultos.{" "}
              <button
                type="button"
                className="text-primary underline"
                onClick={() => void hiddenMessagesQuery.refetch()}
              >
                Reintentar
              </button>
            </div>
          ) : (hiddenMessagesQuery.data ?? []).length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No tienes mensajes ocultos en esta conversación.
            </p>
          ) : (
            <ul className="space-y-2">
              {(hiddenMessagesQuery.data ?? []).map((message) => (
                <li key={message.id} className="flex items-center gap-3 rounded-md border p-3">
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm break-words ${message.deleted ? "italic text-muted-foreground" : ""}`}>
                      {message.deleted
                        ? "Mensaje eliminado para todos"
                        : message.content || message.attachmentName || "Archivo adjunto"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">{formatTime(message.createdAt)}</p>
                  </div>
                  {!message.deleted && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={restoreHiddenMessageMut.isPending}
                      onClick={() => onRestoreHiddenMessage(message)}
                    >
                      Restaurar
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>

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
        ) : (
          <>
            {hasOlder && (
              <div className="flex justify-center pb-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={loadingOlder}
                  onClick={loadOlderMessages}
                >
                  {loadingOlder ? "Cargando…" : "Cargar mensajes anteriores"}
                </Button>
              </div>
            )}
            {filtered.length === 0 ? (
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
                  senderMeta={membersByUserId.get(m.senderId)}
                  onReact={(emoji) => onReact(m, emoji)}
                  onReply={() => {
                    setEditing(null);
                    setReplyTo(m);
                  }}
                  onEdit={() => startEdit(m)}
                  onDelete={() => onDelete(m)}
                  onHideForMe={() => onHideForMe(m)}
                  onForward={() => setForwardMsg(m)}
                />
              ))
            )}
          </>
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
        <Popover open={showEmojis} onOpenChange={setShowEmojis}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={recording}
              aria-label="Emojis"
            >
              <Smile className="w-5 h-5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2" align="start">
            <div className="grid grid-cols-8 gap-1">
              {EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => {
                    setDraft((d) => d + emoji);
                    if (!editing) emitTyping();
                  }}
                  className="text-xl hover:scale-125 transition-transform p-1"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
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
  const queryClient = useQueryClient();
  const moduleParam = useModuleParam();
  const token = useMemo(() => localStorage.getItem(TOKEN_KEY), []);
  const { data: groups = [], isLoading, refetch } = useListChatGroups();
  const {
    data: hiddenGroups = [],
    isLoading: hiddenLoading,
    isError: hiddenError,
    refetch: refetchHidden,
  } = useListChatGroups(
    { hidden: true },
    {
      query: {
        queryKey: getListChatGroupsQueryKey({ hidden: true }),
        staleTime: 0,
      },
    },
  );
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filter, setFilter] = useState("");
  const [contactsOpen, setContactsOpen] = useState(false);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [contactSearch, setContactSearch] = useState("");
  const {
    data: contacts = [],
    isLoading: contactsLoading,
    isError: contactsError,
    refetch: refetchContacts,
  } = useListChatContacts(undefined, {
    query: { queryKey: getListChatContactsQueryKey(), enabled: contactsOpen, staleTime: 0 },
  });
  const createDirect = useCreateChatGroup();
  const hideConversationMut = useHideChatGroupForMe();
  const restoreConversationMut = useRestoreChatGroupForMe();
  const [activeTab, setActiveTab] = useState<"people" | "groups" | "hidden">("people");
  const [didPreselect, setDidPreselect] = useState(false);

  useEffect(() => {
    if (didPreselect || moduleParam == null || groups.length === 0) return;
    const match = groups.find((g) => g.moduleId === moduleParam);
    if (match) {
      setSelectedId(match.id);
      setActiveTab("groups");
    }
    setDidPreselect(true);
  }, [didPreselect, moduleParam, groups]);

  // Refresh the chat list on chat_update events (new messages / unread badges).
  useEffect(() => {
    if (!token) return;
    const socket = connectSocket(token);
    const onChatUpdate = () => {
      void refetch();
      void refetchHidden();
    };
    socket.on("chat_update", onChatUpdate);
    socket.on("message", onChatUpdate);
    return () => {
      socket.off("chat_update", onChatUpdate);
      socket.off("message", onChatUpdate);
    };
  }, [token, refetch, refetchHidden]);

  const sorted = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return [...(activeTab === "hidden" ? hiddenGroups : groups)]
      .filter((group) =>
        activeTab === "hidden" ||
        (activeTab === "people"
          ? group.type === "direct"
          : group.type !== "direct"),
      )
      .filter((g) => !q || g.name.toLowerCase().includes(q))
      .sort((a, b) => {
        const ta = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
        const tb = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
        return tb - ta;
      });
  }, [groups, hiddenGroups, filter, activeTab]);

  const selected =
    groups.find((g) => g.id === selectedId) ??
    hiddenGroups.find((g) => g.id === selectedId) ??
    null;
  const matchingContacts = contacts.filter((contact) =>
    `${contact.name} ${contact.centerName ?? ""}`.toLocaleLowerCase()
      .includes(contactSearch.trim().toLocaleLowerCase()),
  );
  const startDirect = (contact: (typeof contacts)[number]) => {
    if (createDirect.isPending) return;
    createDirect.mutate(
      { data: { name: contact.name, type: "direct", memberIds: [contact.id] } },
      {
        onSuccess: (group) => {
          queryClient.setQueryData<ChatGroup[]>(getListChatGroupsQueryKey(), (previous = []) =>
            previous.some((conversation) => conversation.id === group.id) ? previous : [group, ...previous],
          );
          setContactsOpen(false);
          setSelectedId(group.id);
          setActiveTab("people");
          void refetch();
        },
        onError: () => toast({
          title: "No se pudo iniciar la conversación",
          description: "Comprueba la conexión y vuelve a intentarlo.",
          variant: "destructive",
        }),
      },
    );
  };

  const hideConversation = (group: ChatGroup) => {
    if (
      !window.confirm(
        "La conversación se ocultará solo de tu lista. El historial de las demás personas no se borrará y volverá a aparecer cuando haya actividad nueva. ¿Continuar?",
      )
    ) {
      return;
    }
    hideConversationMut.mutate(
      { id: group.id },
      {
        onSuccess: () => {
          queryClient.setQueryData<ChatGroup[]>(
            getListChatGroupsQueryKey(),
            (previous = []) => previous.filter((conversation) => conversation.id !== group.id),
          );
          queryClient.setQueryData<ChatGroup[]>(
            getListChatGroupsQueryKey({ hidden: true }),
            (previous = []) => [group, ...previous.filter((conversation) => conversation.id !== group.id)],
          );
          if (selectedId === group.id) setSelectedId(null);
          void refetch();
          void refetchHidden();
        },
        onError: () =>
          toast({
            title: "No se pudo ocultar la conversación",
            description: "Inténtalo de nuevo.",
            variant: "destructive",
          }),
      },
    );
  };

  const restoreConversation = (group: ChatGroup) => {
    restoreConversationMut.mutate(
      { id: group.id },
      {
        onSuccess: () => {
          queryClient.setQueryData<ChatGroup[]>(
            getListChatGroupsQueryKey({ hidden: true }),
            (previous = []) => previous.filter((conversation) => conversation.id !== group.id),
          );
          queryClient.setQueryData<ChatGroup[]>(
            getListChatGroupsQueryKey(),
            (previous = []) => [group, ...previous.filter((conversation) => conversation.id !== group.id)],
          );
          void refetch();
          void refetchHidden();
          toast({ title: "Conversación restaurada" });
        },
        onError: () => toast({
          title: "No se pudo restaurar la conversación",
          description: "Inténtalo de nuevo.",
          variant: "destructive",
        }),
      },
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <MessageCircle className="w-6 h-6 text-primary" /> Mensajes
          </h1>
          <p className="text-muted-foreground">
            Conversaciones directas y de grupo con tu profesorado y coordinación.
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => setNewGroupOpen(true)}>Nuevo grupo</Button>
          <Button type="button" onClick={() => setContactsOpen(true)}>Nuevo mensaje</Button>
        </div>
      </div>
      <CreateChatGroupDialog open={newGroupOpen} onOpenChange={setNewGroupOpen} onCreated={(group) => {
        queryClient.setQueryData<ChatGroup[]>(getListChatGroupsQueryKey(), (previous = []) => [group, ...previous]);
        setSelectedId(group.id);
        setActiveTab("groups");
        void refetch();
      }} />
      <Dialog open={contactsOpen} onOpenChange={setContactsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nuevo mensaje</DialogTitle>
            <DialogDescription>Elige a una persona registrada para conversar.</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            maxLength={100}
            value={contactSearch}
            onChange={(event) => setContactSearch(event.target.value)}
            placeholder="Buscar por nombre o centro"
            aria-label="Buscar personas registradas"
          />
          <div className="max-h-[min(55vh,22rem)] overflow-y-auto overscroll-contain rounded-md border">
            {contactsLoading ? (
              <p className="p-4 text-sm text-muted-foreground">Cargando personas…</p>
            ) : contactsError ? (
              <div className="p-4 text-sm">
                No se pudieron cargar los contactos.{" "}
                <button type="button" onClick={() => void refetchContacts()} className="text-primary underline">
                  Reintentar
                </button>
              </div>
            ) : matchingContacts.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                {contactSearch.trim() ? "No hay personas con ese nombre." : "No hay otras cuentas activas."}
              </p>
            ) : matchingContacts.map((contact) => (
              <button
                key={contact.id}
                type="button"
                disabled={createDirect.isPending}
                onClick={() => startDirect(contact)}
                className="flex w-full items-center gap-3 border-b px-3 py-2.5 text-left last:border-b-0 hover:bg-accent disabled:opacity-50"
              >
                <Avatar className="h-9 w-9 shrink-0">
                  <AvatarFallback>{initials(contact.name)}</AvatarFallback>
                </Avatar>
                <span className="min-w-0 text-sm">
                  <span className="block truncate">{contact.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {contact.centerName ?? "Sin centro indicado"}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="grid grid-rows-1 md:grid-cols-[320px_1fr] h-[calc(100vh-16rem)] min-h-[480px]">
            {/* Left: conversation list */}
            <div
              className={`border-r flex flex-col ${
                selected ? "hidden md:flex" : "flex"
              }`}
            >
              <div className="grid grid-cols-3 gap-2 p-3 border-b shrink-0">
                {(
                  [
                    ["people", "Personas"],
                    ["groups", "Grupos"],
                    ["hidden", "Ocultas"],
                  ] as const
                ).map(([tab, label]) => {
                  const count = groups.filter((group) =>
                    tab === "people"
                      ? group.type === "direct"
                      : tab === "groups"
                        ? group.type !== "direct"
                        : false,
                  ).length;
                  const tabCount =
                    tab === "hidden" ? hiddenGroups.length : count;
                  const selectedTab = activeTab === tab;
                  return (
                    <button
                      key={tab}
                      type="button"
                      role="tab"
                      aria-selected={selectedTab}
                      onClick={() => {
                        setSelectedId(null);
                        setActiveTab(tab);
                      }}
                      className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                        selectedTab
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background text-muted-foreground hover:bg-accent"
                      }`}
                    >
                      {label} <span className="opacity-80">· {tabCount}</span>
                    </button>
                  );
                })}
              </div>
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
                {activeTab === "hidden" && hiddenLoading ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">
                    Cargando conversaciones ocultas…
                  </p>
                ) : activeTab === "hidden" && hiddenError ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">
                    No se pudieron cargar.{" "}
                    <button type="button" onClick={() => void refetchHidden()} className="text-primary underline">
                      Reintentar
                    </button>
                  </p>
                ) : isLoading ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">
                    Cargando…
                  </p>
                ) : sorted.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center px-4">
                    {filter.trim()
                      ? "No se encontraron conversaciones."
                      : activeTab === "hidden"
                        ? "No tienes conversaciones ocultas."
                        : activeTab === "people"
                          ? "No tienes conversaciones. Pulsa «Nuevo mensaje» para ver las personas registradas."
                          : "Aún no perteneces a ningún grupo."}
                  </p>
                ) : (
                  <ul>
                    {sorted.map((g) => {
                      const active = g.id === selectedId;
                      return (
                        <li key={g.id}>
                          <div className="flex items-stretch">
                            <button
                              type="button"
                              onClick={() => setSelectedId(g.id)}
                              className={`min-w-0 flex-1 flex items-center gap-3 px-3 py-2.5 text-left hover:bg-accent transition-colors border-l-2 ${
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
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="shrink-0 self-center text-muted-foreground"
                              aria-label={`Ocultar conversación ${g.name}`}
                              title="Ocultar solo de mi lista"
                              disabled={
                                activeTab === "hidden"
                                  ? restoreConversationMut.isPending
                                  : hideConversationMut.isPending
                              }
                              onClick={() =>
                                activeTab === "hidden"
                                  ? restoreConversation(g)
                                  : hideConversation(g)
                              }
                            >
                              {activeTab === "hidden" ? (
                                <Eye className="h-4 w-4" />
                              ) : (
                                <EyeOff className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
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
