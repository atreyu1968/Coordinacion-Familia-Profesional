import {
  useRef,
  useState,
  useEffect,
  type FormEvent,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListCompanyAlerts,
  useCreateCompanyAlert,
  useDeleteCompanyAlert,
  getListCompanyAlertsQueryKey,
  useListGdcanResources,
  useCreateGdcanResource,
  getListGdcanResourcesQueryKey,
  useListProvinces,
  useGetAiStatus,
  useAiChat,
  type CreateCompanyAlertInput,
  type CreateGdcanResourceInput,
  type GdcanResourceType,
  type AiMessage,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import {
  Briefcase,
  Plus,
  Search,
  Trash2,
  Building2,
  MapPin,
  Users,
  Mail,
  User as UserIcon,
  Landmark,
  BookOpen,
  HelpCircle,
  LinkIcon,
  ExternalLink,
  Bot,
  Send,
  AlertTriangle,
} from "lucide-react";

const ALL = "all";
const GLOBAL = "global";
const GDCAN_PORTAL_URL =
  "https://www3.gobiernodecanarias.org/medusa/gdcan/";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function canPublish(role: string | undefined): boolean {
  return (
    role === "superadmin" || role === "coordinator" || role === "prospector"
  );
}

// ---------------------------------------------------------------------------
// Company alerts tab
// ---------------------------------------------------------------------------
function CreateAlertDialog() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: provinces = [] } = useListProvinces();
  const createMut = useCreateCompanyAlert();

  const isSuperadmin = user?.role === "superadmin";

  const [open, setOpen] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [sector, setSector] = useState("");
  const [location, setLocation] = useState("");
  const [positions, setPositions] = useState("");
  const [contact, setContact] = useState("");
  const [description, setDescription] = useState("");
  const [provinceId, setProvinceId] = useState<string>(GLOBAL);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCompanyName("");
      setSector("");
      setLocation("");
      setPositions("");
      setContact("");
      setDescription("");
      setProvinceId(GLOBAL);
      setError(null);
    }
  }, [open]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!companyName.trim()) {
      setError("El nombre de la empresa es obligatorio.");
      return;
    }
    const payload: CreateCompanyAlertInput = {
      companyName: companyName.trim(),
      sector: sector.trim() || null,
      location: location.trim() || null,
      positions: positions.trim() ? Number(positions) : null,
      contact: contact.trim() || null,
      description: description.trim() || null,
      // Only superadmin chooses the province; others are pinned server-side.
      provinceId: isSuperadmin
        ? provinceId === GLOBAL
          ? null
          : Number(provinceId)
        : null,
    };
    try {
      const result = await createMut.mutateAsync({ data: payload });
      await qc.invalidateQueries({
        queryKey: getListCompanyAlertsQueryKey(),
      });
      if (result.emailPending) {
        toast({
          title: "Alerta publicada",
          description:
            "El aviso por email está pendiente: un administrador debe configurar el envío de correos (Resend).",
        });
      } else if (result.notifiedCount > 0) {
        toast({
          title: "Alerta publicada",
          description: `Aviso enviado a ${result.notifiedCount} tutor${
            result.notifiedCount === 1 ? "" : "es"
          } de FCT.`,
        });
      } else {
        toast({
          title: "Alerta publicada",
          description: companyName.trim(),
        });
      }
      setOpen(false);
    } catch {
      setError("No se pudo publicar la alerta. Inténtalo de nuevo.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="w-4 h-4" /> Nueva alerta
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nueva alerta de empresa</DialogTitle>
          <DialogDescription>
            Publica una oportunidad de FCT o FP Dual para el profesorado.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="a-name">Empresa *</Label>
            <Input
              id="a-name"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="a-sector">Sector</Label>
              <Input
                id="a-sector"
                value={sector}
                onChange={(e) => setSector(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="a-loc">Localidad</Label>
              <Input
                id="a-loc"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="a-pos">Plazas</Label>
              <Input
                id="a-pos"
                type="number"
                min={0}
                value={positions}
                onChange={(e) => setPositions(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="a-contact">Contacto</Label>
              <Input
                id="a-contact"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="email o teléfono"
              />
            </div>
          </div>
          {isSuperadmin && (
            <div className="space-y-2">
              <Label>Provincia</Label>
              <Select value={provinceId} onValueChange={setProvinceId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={GLOBAL}>Todas (global)</SelectItem>
                  {provinces.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="a-desc">Descripción</Label>
            <Textarea
              id="a-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          {error && (
            <p className="text-sm font-medium text-destructive">{error}</p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={createMut.isPending}>
              {createMut.isPending ? "Publicando..." : "Publicar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AlertsTab() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const deleteMut = useDeleteCompanyAlert();
  const { data: provinces = [] } = useListProvinces();

  const [search, setSearch] = useState("");
  const { data: alerts = [], isLoading } = useListCompanyAlerts(
    search.trim() ? { search: search.trim() } : undefined,
  );

  const provinceName = (id: number | null | undefined) =>
    id == null ? "Global" : provinces.find((p) => p.id === id)?.name ?? "—";

  const canDelete = (
    createdById: number | null | undefined,
    alertProvinceId: number | null | undefined,
  ) =>
    createdById === user?.id ||
    user?.role === "superadmin" ||
    (user?.role === "coordinator" &&
      user?.provinceId != null &&
      alertProvinceId === user.provinceId);

  const onDelete = async (id: number) => {
    try {
      await deleteMut.mutateAsync({ id });
      await qc.invalidateQueries({ queryKey: getListCompanyAlertsQueryKey() });
      toast({ title: "Alerta eliminada" });
    } catch {
      toast({
        title: "No se pudo eliminar",
        description: "Comprueba tus permisos.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por empresa, sector o localidad..."
            className="pl-9"
          />
        </div>
        {canPublish(user?.role) && (
          <div className="sm:ml-auto">
            <CreateAlertDialog />
          </div>
        )}
      </div>

      {isLoading ? (
        <p className="text-muted-foreground py-8 text-center">Cargando...</p>
      ) : alerts.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No hay alertas de empresas todavía.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {alerts.map((a) => (
            <Card key={a.id} className="flex flex-col">
              <CardContent className="p-4 flex flex-col gap-3 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="w-9 h-9 rounded-md bg-muted flex items-center justify-center text-muted-foreground shrink-0">
                    <Building2 className="w-4 h-4" />
                  </div>
                  <Badge variant="secondary" className="shrink-0">
                    {provinceName(a.provinceId)}
                  </Badge>
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold leading-tight">
                    {a.companyName}
                  </h3>
                  {a.sector && (
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {a.sector}
                    </p>
                  )}
                  {a.description && (
                    <p className="text-sm text-muted-foreground mt-2 line-clamp-3">
                      {a.description}
                    </p>
                  )}
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  {a.location && (
                    <div className="flex items-center gap-1.5">
                      <MapPin className="w-3 h-3" /> {a.location}
                    </div>
                  )}
                  {a.positions != null && (
                    <div className="flex items-center gap-1.5">
                      <Users className="w-3 h-3" /> {a.positions}{" "}
                      {a.positions === 1 ? "plaza" : "plazas"}
                    </div>
                  )}
                  {a.contact && (
                    <div className="flex items-center gap-1.5">
                      <Mail className="w-3 h-3" /> {a.contact}
                    </div>
                  )}
                  <div className="flex items-center gap-1.5">
                    <UserIcon className="w-3 h-3" />
                    {a.createdByName ?? "Autor desconocido"}
                  </div>
                </div>
                {canDelete(a.createdById, a.provinceId) && (
                  <div className="flex justify-end pt-1">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            ¿Eliminar alerta?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            Se eliminará la alerta de «{a.companyName}». Esta
                            acción no se puede deshacer.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction onClick={() => onDelete(a.id)}>
                            Eliminar
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// GDCAN resources tab
// ---------------------------------------------------------------------------
const GDCAN_TYPE_LABELS: Record<GdcanResourceType, string> = {
  manual: "Manual",
  faq: "Pregunta frecuente",
  link: "Enlace",
};

function gdcanTypeIcon(type: GdcanResourceType) {
  if (type === "manual") return <BookOpen className="w-4 h-4" />;
  if (type === "faq") return <HelpCircle className="w-4 h-4" />;
  return <LinkIcon className="w-4 h-4" />;
}

function CreateGdcanDialog() {
  const qc = useQueryClient();
  const createMut = useCreateGdcanResource();

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<GdcanResourceType>("manual");
  const [url, setUrl] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle("");
      setType("manual");
      setUrl("");
      setContent("");
      setError(null);
    }
  }, [open]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!title.trim()) {
      setError("El título es obligatorio.");
      return;
    }
    if (type === "link" && !url.trim()) {
      setError("Los enlaces necesitan una URL.");
      return;
    }
    const payload: CreateGdcanResourceInput = {
      title: title.trim(),
      type,
      url: url.trim() || null,
      content: content.trim() || null,
    };
    try {
      await createMut.mutateAsync({ data: payload });
      await qc.invalidateQueries({
        queryKey: getListGdcanResourcesQueryKey(),
      });
      toast({ title: "Recurso añadido", description: title.trim() });
      setOpen(false);
    } catch {
      setError("No se pudo guardar el recurso. Inténtalo de nuevo.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="w-4 h-4" /> Añadir recurso
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Añadir recurso GDCAN</DialogTitle>
          <DialogDescription>
            Manuales, preguntas frecuentes y enlaces sobre GDCAN.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="g-title">Título *</Label>
            <Input
              id="g-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Tipo *</Label>
            <Select
              value={type}
              onValueChange={(v) => setType(v as GdcanResourceType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual</SelectItem>
                <SelectItem value="faq">Pregunta frecuente</SelectItem>
                <SelectItem value="link">Enlace</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="g-url">
              URL {type === "link" ? "*" : "(opcional)"}
            </Label>
            <Input
              id="g-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://..."
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="g-content">
              Contenido {type === "faq" ? "(respuesta)" : "(opcional)"}
            </Label>
            <Textarea
              id="g-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={4}
            />
          </div>
          {error && (
            <p className="text-sm font-medium text-destructive">{error}</p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={createMut.isPending}>
              {createMut.isPending ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function GdcanTab() {
  const { user } = useAuth();
  const { data: resources = [], isLoading } = useListGdcanResources();

  return (
    <div className="space-y-4">
      <Alert>
        <Landmark className="h-4 w-4" />
        <AlertTitle>Portal GDCAN</AlertTitle>
        <AlertDescription className="flex flex-col gap-2">
          <span>
            Gestión de la actividad docente del Gobierno de Canarias. Accede al
            portal oficial para la gestión de FCT.
          </span>
          <Button asChild variant="outline" size="sm" className="w-fit gap-2">
            <a
              href={GDCAN_PORTAL_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="w-4 h-4" /> Abrir portal GDCAN
            </a>
          </Button>
        </AlertDescription>
      </Alert>

      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Manuales, FAQs y enlaces
        </h2>
        {canPublish(user?.role) && <CreateGdcanDialog />}
      </div>

      {isLoading ? (
        <p className="text-muted-foreground py-8 text-center">Cargando...</p>
      ) : resources.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Aún no hay manuales ni preguntas frecuentes.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {resources.map((r) => (
            <Card key={r.id} className="flex flex-col">
              <CardContent className="p-4 flex flex-col gap-3 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="w-9 h-9 rounded-md bg-muted flex items-center justify-center text-muted-foreground shrink-0">
                    {gdcanTypeIcon(r.type)}
                  </div>
                  <Badge variant="secondary" className="shrink-0">
                    {GDCAN_TYPE_LABELS[r.type]}
                  </Badge>
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold leading-tight">{r.title}</h3>
                  {r.content && (
                    <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap line-clamp-4">
                      {r.content}
                    </p>
                  )}
                </div>
                {r.url && (
                  <Button
                    asChild
                    size="sm"
                    variant="outline"
                    className="gap-2 w-fit"
                  >
                    <a href={r.url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="w-4 h-4" /> Abrir
                    </a>
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bot GDCAN tab (reuses the AI chat with the GDCAN context)
// ---------------------------------------------------------------------------
function BotTab() {
  const { data: status, isLoading: statusLoading } = useGetAiStatus();
  const chatMut = useAiChat();

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const configured = status?.configured === true;

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, chatMut.isPending]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || chatMut.isPending) return;
    setError(null);

    const history = messages;
    const next: AiMessage[] = [...history, { role: "user", content: text }];
    setMessages(next);
    setInput("");

    try {
      const res = await chatMut.mutateAsync({
        data: { message: text, context: "gdcan", history },
      });
      setMessages([...next, { role: "assistant", content: res.reply }]);
    } catch {
      setError(
        "El asistente no está disponible en este momento. Inténtalo más tarde.",
      );
      setMessages(history);
      setInput(text);
    }
  };

  return (
    <div className="space-y-4">
      {!statusLoading && !configured && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Asistente pendiente de configuración</AlertTitle>
          <AlertDescription>
            El bot de GDCAN aún no está activo. Un administrador debe añadir la
            clave de DeepSeek desde el Panel de Control para habilitarlo.
          </AlertDescription>
        </Alert>
      )}

      <Card className="flex flex-col h-[55vh]">
        <CardContent className="flex flex-col flex-1 p-0 overflow-hidden">
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground gap-2">
                <Bot className="w-10 h-10" />
                <p className="font-medium">Bot de GDCAN</p>
                <p className="text-sm max-w-sm">
                  Pregunta sobre trámites, plazos y procedimientos de GDCAN para
                  la gestión de la FCT.
                </p>
              </div>
            ) : (
              messages.map((m, i) => (
                <div
                  key={i}
                  className={`flex gap-3 ${
                    m.role === "user" ? "flex-row-reverse" : ""
                  }`}
                >
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                      m.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {m.role === "user" ? (
                      <UserIcon className="w-4 h-4" />
                    ) : (
                      <Bot className="w-4 h-4" />
                    )}
                  </div>
                  <div
                    className={`rounded-lg px-4 py-2 max-w-[80%] text-sm whitespace-pre-wrap ${
                      m.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))
            )}
            {chatMut.isPending && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-muted text-muted-foreground flex items-center justify-center shrink-0">
                  <Bot className="w-4 h-4" />
                </div>
                <div className="rounded-lg px-4 py-2 bg-muted text-sm text-muted-foreground">
                  Escribiendo...
                </div>
              </div>
            )}
          </div>

          {error && (
            <p className="px-4 pb-2 text-sm font-medium text-destructive">
              {error}
            </p>
          )}

          <form onSubmit={onSubmit} className="border-t p-3 flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                configured ? "Escribe tu consulta..." : "Asistente no disponible"
              }
              disabled={!configured || chatMut.isPending}
            />
            <Button
              type="submit"
              disabled={!configured || chatMut.isPending || !input.trim()}
              className="gap-2"
            >
              <Send className="w-4 h-4" />
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function FctPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
          <Briefcase className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            FCT y Prospección
          </h1>
          <p className="text-sm text-muted-foreground">
            Alertas de empresas, recursos de GDCAN y asistencia para la gestión
            de la FCT.
          </p>
        </div>
      </div>

      <Tabs defaultValue="alertas">
        <TabsList>
          <TabsTrigger value="alertas" className="gap-2">
            <Briefcase className="w-4 h-4" /> Alertas de empresas
          </TabsTrigger>
          <TabsTrigger value="gdcan" className="gap-2">
            <Landmark className="w-4 h-4" /> GDCAN
          </TabsTrigger>
          <TabsTrigger value="bot" className="gap-2">
            <Bot className="w-4 h-4" /> Bot GDCAN
          </TabsTrigger>
        </TabsList>
        <TabsContent value="alertas" className="mt-6">
          <AlertsTab />
        </TabsContent>
        <TabsContent value="gdcan" className="mt-6">
          <GdcanTab />
        </TabsContent>
        <TabsContent value="bot" className="mt-6">
          <BotTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
