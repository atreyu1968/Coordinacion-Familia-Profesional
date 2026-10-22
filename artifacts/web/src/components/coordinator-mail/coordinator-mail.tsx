import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useRoute } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetCoordinatorMailCaseQueryKey,
  getGetCoordinatorMailWorkspaceQueryKey,
  useAddCoordinatorMailCaseLink,
  useAddCoordinatorMailCaseNote,
  useDisconnectCoordinatorGmail,
  useGenerateCoordinatorMailReplyDraft,
  useGetCoordinatorMailCase,
  useGetCoordinatorMailWorkspace,
  useSendCoordinatorMailReply,
  useStartCoordinatorGmailOAuth,
  useSyncCoordinatorGmail,
  useUpdateCoordinatorMailCase,
  useRemoveCoordinatorMailCaseLink,
  useGetCoordinatorMailAdminSettings,
  useUpdateCoordinatorMailAdminSettings,
  type CoordinatorMailCase,
  type CoordinatorMailCaseDetail,
  type CoordinatorMailCaseStatus,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { HtmlDocxDownloadButton, isHtmlDocumentName } from "@/components/html-docx-download-button";
import {
  AlertTriangle, ArrowDownToLine, ArrowLeft, ArrowRight, CalendarClock,
  Check, ChevronDown, CircleAlert, Clock3, Inbox,
  Link2, Mail, MessageSquare, RefreshCw, Search, Send, Settings2, ShieldCheck,
  Sparkles, Unlink, Unplug, X,
} from "lucide-react";
import "./coordinator-mail.css";
import { KnowledgeCoveragePanel } from "./knowledge-coverage";

const PAGE_SIZE = 20;
const TOKEN_KEY = "coordina_adg_token";
const STATUS_LABEL: Record<CoordinatorMailCaseStatus, string> = {
  open: "Abierto", waiting: "En espera", closed: "Cerrado",
};
const safeDate = (date: Date | string | null | undefined, options?: Intl.DateTimeFormatOptions) =>
  date ? new Date(date).toLocaleString("es-ES", options ?? { dateStyle: "medium", timeStyle: "short" }) : "Sin fecha";
const statusClass = (status: CoordinatorMailCaseStatus) =>
  `mail-status mail-status--${status}`;

function WorkspaceShell({ children }: { children: ReactNode }) {
  return <main className="mail-shell" data-testid="coordinator-mail-workspace">{children}</main>;
}

function AccessDenied() {
  return <WorkspaceShell><section className="mail-empty" data-testid="status-mail-access-denied">
    <ShieldCheck aria-hidden="true" /><h1>Acceso restringido</h1>
    <p>Este espacio privado está disponible para coordinación y superadministración.</p>
  </section></WorkspaceShell>;
}

export default function CoordinatorMailPage() {
  const { user } = useAuth();
  const [isDetail, detailParams] = useRoute("/asuntos-correo/:id");
  const isInbox = useRoute("/asuntos-correo")[0];
  if (!user || !["coordinator", "superadmin"].includes(user.role)) return <AccessDenied />;
  return isDetail && detailParams?.id
    ? <CoordinatorMailDetail id={Number(detailParams.id)} />
    : isInbox ? <CoordinatorMailInbox /> : <AccessDenied />;
}

function ConnectionPanel() {
  const qc = useQueryClient();
  const params = { page: 1 };
  const query = useGetCoordinatorMailWorkspace(params, { query: { queryKey: getGetCoordinatorMailWorkspaceQueryKey(params), refetchInterval: 300_000 } });
  const sync = useSyncCoordinatorGmail();
  const connect = useStartCoordinatorGmailOAuth();
  const disconnect = useDisconnectCoordinatorGmail();
  const [actionError, setActionError] = useState("");
  const conn = query.data?.connection;
  const doSync = async () => {
    setActionError("");
    try {
      const result = await sync.mutateAsync();
      qc.setQueryData(getGetCoordinatorMailWorkspaceQueryKey(params), result);
      await qc.invalidateQueries({ queryKey: getGetCoordinatorMailWorkspaceQueryKey() });
    } catch {
      setActionError("No se pudo iniciar la sincronización. El historial local se conserva.");
    }
  };
  const doConnect = async () => {
    setActionError("");
    try {
      const result = await connect.mutateAsync();
      window.location.assign(result.authorizationUrl);
    } catch {
      setActionError("No se pudo iniciar la autorización de Google. La superadministración debe configurar OAuth primero.");
    }
  };
  const doDisconnect = async () => {
    if (!window.confirm("¿Desconectar Gmail? El historial y los asuntos guardados permanecerán en Coordina ADG.")) return;
    setActionError("");
    try {
      await disconnect.mutateAsync();
      await qc.invalidateQueries({ queryKey: getGetCoordinatorMailWorkspaceQueryKey() });
    } catch {
      setActionError("No se pudo desconectar Gmail. No se ha eliminado el historial local.");
    }
  };
  return <section className="mail-connection" aria-labelledby="mail-connection-title" data-testid="panel-mail-connection">
    <div className="mail-connection__mark"><Mail aria-hidden="true" /></div>
    <div className="mail-connection__copy">
      <div className="mail-eyebrow">Buzón de coordinación</div>
      <h2 id="mail-connection-title" data-testid="text-mail-connection-status">
        {query.isLoading ? "Comprobando conexión…" : conn?.connected ? conn.email || "Gmail conectado" : "Gmail sin conectar"}
      </h2>
      <p>{conn?.connected
        ? `Sincronización automática cada 5 minutos${conn.lastSyncAt ? ` · última revisión ${safeDate(conn.lastSyncAt)}` : ""}`
        : "Conecta la cuenta de correo dedicada para importar y gestionar asuntos."}</p>
      {conn?.syncError && <p className="mail-safe-error" role="alert" data-testid="status-mail-sync-error"><CircleAlert /> No se pudo completar la última sincronización. Puedes reintentarlo; el historial guardado sigue disponible.</p>}
      {actionError && <p className="mail-safe-error" role="alert" data-testid="status-mail-action-error"><CircleAlert /> {actionError}</p>}
    </div>
    <div className="mail-connection__actions">
      {conn?.connected ? <>
        <Button variant="outline" onClick={() => void doSync()} disabled={sync.isPending} data-testid="button-sync-gmail">
          <RefreshCw className={sync.isPending ? "mail-spin" : ""} /> {sync.isPending ? "Sincronizando" : "Sincronizar"}
        </Button>
        <Button variant="ghost" onClick={() => void doDisconnect()} disabled={disconnect.isPending} data-testid="button-disconnect-gmail"><Unplug /> Desconectar</Button>
      </> : conn?.oauthAvailable ? <Button onClick={() => void doConnect()} disabled={connect.isPending} data-testid="button-connect-gmail">
        <Mail /> {connect.isPending ? "Conectando…" : conn.status === "needs_reauthorization" ? "Volver a autorizar" : "Conectar Gmail"}
      </Button> : <Link href="/panel-control" className="mail-button-link" data-testid="link-configure-gmail"><Settings2 /> Configurar Gmail</Link>}
    </div>
    {conn?.status === "needs_reauthorization" && <div className="mail-connection__notice" role="status" data-testid="status-gmail-reauthorization">Google requiere renovar el acceso. Vuelve a autorizar la cuenta desde Panel de control.</div>}
    {conn?.status === "needs_configuration" && <div className="mail-connection__notice" role="status" data-testid="status-gmail-configuration">La integración Gmail aún no está configurada por superadministración.</div>}
  </section>;
}

function CoordinatorMailInbox() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<"all" | CoordinatorMailCaseStatus>("all");
  const [search, setSearch] = useState("");
  const params = { page, ...(status !== "all" ? { status } : {}), ...(search.trim() ? { search: search.trim() } : {}) };
  const query = useGetCoordinatorMailWorkspace(params, { query: { queryKey: getGetCoordinatorMailWorkspaceQueryKey(params), refetchInterval: 300_000 } });
  const cases = query.data?.items ?? [];
  const totalPages = Math.max(1, Math.ceil((query.data?.total ?? 0) / (query.data?.pageSize ?? PAGE_SIZE)));
  return <WorkspaceShell>
    <header className="mail-page-head">
      <div><p className="mail-eyebrow">Coordina ADG / privado</p><h1 data-testid="heading-mail-inbox">Asuntos de correo</h1>
        <p>Un lugar para seguir cada conversación sin perder el contexto.</p></div>
      <div className="mail-page-head__count" data-testid="text-mail-total"><strong>{query.data?.total ?? "—"}</strong><span>asuntos</span></div>
    </header>
    <ConnectionPanel />
    <KnowledgeCoveragePanel />
    <section className="mail-list-area" aria-label="Bandeja de asuntos">
      <div className="mail-list-toolbar">
        <label className="mail-search"><Search aria-hidden="true" /><span className="sr-only">Buscar asuntos</span>
          <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Buscar por asunto o remitente" data-testid="input-mail-search" /></label>
        <label className="mail-filter"><span className="sr-only">Filtrar por estado</span><ChevronDown aria-hidden="true" />
          <select value={status} onChange={(event) => { setStatus(event.target.value as "all" | CoordinatorMailCaseStatus); setPage(1); }} data-testid="select-mail-status">
            <option value="all">Todos los estados</option><option value="open">Abiertos</option><option value="waiting">En espera</option><option value="closed">Cerrados</option>
          </select></label>
      </div>
      {query.isLoading && <div className="mail-skeleton-list" role="status" data-testid="loading-mail-list">{[1, 2, 3].map((n) => <Skeleton key={n} className="h-24 rounded-xl" />)}</div>}
      {query.isError && <div className="mail-error-state" role="alert" data-testid="status-mail-load-error"><CircleAlert /><div><strong>No se pudo cargar la bandeja</strong><p>Comprueba tu conexión e inténtalo de nuevo.</p></div><Button variant="outline" onClick={() => void query.refetch()} data-testid="button-retry-mail-list">Reintentar</Button></div>}
      {!query.isLoading && !query.isError && cases.length === 0 && <div className="mail-empty mail-empty--inline" data-testid="empty-mail-list"><Inbox /><h2>{search || status !== "all" ? "No hay resultados" : "Todavía no hay asuntos"}</h2><p>{search || status !== "all" ? "Prueba con otros términos o estados." : "Cuando Gmail sincronice mensajes, las conversaciones aparecerán aquí."}</p></div>}
      {!query.isLoading && !query.isError && cases.length > 0 && <div className="mail-case-list" data-testid="list-mail-cases">
        {cases.map((item) => <CaseRow key={item.id} item={item} />)}
      </div>}
      <nav className="mail-pagination" aria-label="Paginación de asuntos" data-testid="pagination-mail">
        <span data-testid="text-mail-page">Página {page} de {totalPages}</span>
        <div><Button variant="outline" size="sm" disabled={page <= 1 || query.isFetching} onClick={() => setPage((p) => Math.max(1, p - 1))} data-testid="button-mail-previous"><ArrowLeft /> Anterior</Button>
          <Button variant="outline" size="sm" disabled={page >= totalPages || query.isFetching} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} data-testid="button-mail-next">Siguiente <ArrowRight /></Button></div>
      </nav>
    </section>
  </WorkspaceShell>;
}

function CaseRow({ item }: { item: CoordinatorMailCase }) {
  return <Link href={`/asuntos-correo/${item.id}`} className="mail-case-row" data-testid={`link-mail-case-${item.id}`}>
    <div className="mail-case-row__main"><div className="mail-case-row__top"><h2 data-testid={`text-mail-case-title-${item.id}`}>{item.title}</h2><span className={statusClass(item.status)} data-testid={`status-mail-case-${item.id}`}>{STATUS_LABEL[item.status]}</span></div>
      <p className="mail-case-row__subject">{item.latestSubject || "Sin asunto reciente"}</p>
      <div className="mail-case-row__meta"><span>{item.latestSender || "Remitente desconocido"}</span><span aria-hidden="true">·</span><span>{item.messageCount} {item.messageCount === 1 ? "mensaje" : "mensajes"}</span>{item.linkedCaseCount > 1 && <span>{item.linkedCaseCount} casos vinculados</span>}{item.attachmentCount > 0 && <span>{item.attachmentCount} adjuntos</span>}</div></div>
    <div className="mail-case-row__date"><Clock3 aria-hidden="true" /><span>{safeDate(item.lastActivityAt, { dateStyle: "medium" })}</span></div>
  </Link>;
}

function CoordinatorMailDetail({ id }: { id: number }) {
  const [messagePage, setMessagePage] = useState(1);
  const [draftTo, setDraftTo] = useState("");
  const [draftSubject, setDraftSubject] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [baseline, setBaseline] = useState({ to: "", subject: "", body: "" });
  const [revision, setRevision] = useState(1);
  const [conflict, setConflict] = useState(false);
  const [note, setNote] = useState("");
  const [instructions, setInstructions] = useState("");
  const [aiConsent, setAiConsent] = useState(false);
  const [sendConfirm, setSendConfirm] = useState(false);
  const [error, setError] = useState("");
  const [sendUnknown, setSendUnknown] = useState(false);
  const [linkSearch, setLinkSearch] = useState("");
  const [linkPage, setLinkPage] = useState(1);
  const queryKey = getGetCoordinatorMailCaseQueryKey(id, { messagePage });
  const query = useGetCoordinatorMailCase(id, { messagePage }, { query: { queryKey, refetchInterval: 300_000 } });
  const linkSearchParams = { page: linkPage, search: linkSearch.trim() };
  const linkCandidatesQuery = useGetCoordinatorMailWorkspace(linkSearchParams, {
    query: { queryKey: getGetCoordinatorMailWorkspaceQueryKey(linkSearchParams), enabled: linkSearch.trim().length >= 2 },
  });
  const qc = useQueryClient();
  const update = useUpdateCoordinatorMailCase();
  const addCaseLink = useAddCoordinatorMailCaseLink();
  const removeCaseLink = useRemoveCoordinatorMailCaseLink();
  const addNote = useAddCoordinatorMailCaseNote();
  const generate = useGenerateCoordinatorMailReplyDraft();
  const send = useSendCoordinatorMailReply();
  const detail = query.data;
  const dirty = draftTo !== baseline.to || draftSubject !== baseline.subject || draftBody !== baseline.body;
  useEffect(() => {
    if (!detail) return;
    const server = { to: detail.draftTo, subject: detail.draftSubject, body: detail.draftBody };
    if (detail.revision === revision && server.to === baseline.to && server.subject === baseline.subject && server.body === baseline.body) return;
    if (!dirty) {
      setDraftTo(server.to); setDraftSubject(server.subject); setDraftBody(server.body);
      setBaseline(server); setRevision(detail.revision); setConflict(false);
    } else if (detail.revision !== revision) setConflict(true);
    // Dirty drafts intentionally survive background refetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.revision, detail?.draftTo, detail?.draftSubject, detail?.draftBody]);
  const saveDraft = async (override = false) => {
    if (!detail) return;
    setError("");
    try {
      const saved = await update.mutateAsync({ id, data: { revision: override ? detail.revision : revision, draftTo, draftSubject, draftBody } });
      setBaseline({ to: saved.draftTo, subject: saved.draftSubject, body: saved.draftBody });
      setDraftTo(saved.draftTo); setDraftSubject(saved.draftSubject); setDraftBody(saved.draftBody); setRevision(saved.revision); setConflict(false);
      qc.setQueryData(queryKey, (old: CoordinatorMailCaseDetail | undefined) => old ? { ...old, ...saved, messages: old.messages, notes: old.notes } : saved);
      await qc.invalidateQueries({ queryKey: getGetCoordinatorMailWorkspaceQueryKey() });
    } catch (e) {
      setError("No se pudo guardar el borrador. Puede que otra persona haya actualizado este asunto; tu texto sigue aquí.");
      if ((e as { status?: number })?.status === 409) setConflict(true);
    }
  };
  const updateStatus = async (status: CoordinatorMailCaseStatus) => {
    if (!detail) return;
    try {
      const saved = await update.mutateAsync({ id, data: { revision: detail.revision, status } });
      qc.setQueryData(queryKey, (old: CoordinatorMailCaseDetail | undefined) => old ? { ...old, ...saved, messages: old.messages, notes: old.notes } : saved);
      await qc.invalidateQueries({ queryKey: getGetCoordinatorMailWorkspaceQueryKey() });
    } catch { setError("No se pudo actualizar el estado del asunto."); }
  };
  const updateDueDate = async (value: string) => {
    if (!detail) return;
    try {
      const saved = await update.mutateAsync({ id, data: { revision: detail.revision, dueAt: value ? new Date(`${value}T23:59:00`).toISOString() : null } });
      qc.setQueryData(queryKey, (old: CoordinatorMailCaseDetail | undefined) => old ? { ...old, ...saved, messages: old.messages, notes: old.notes } : saved);
    } catch { setError("No se pudo guardar el vencimiento."); }
  };
  const submitNote = async (event: FormEvent) => {
    event.preventDefault();
    if (!note.trim()) return;
    try {
      const saved = await addNote.mutateAsync({ id, data: { content: note.trim() } });
      qc.setQueryData(queryKey, (old: CoordinatorMailCaseDetail | undefined) => old ? { ...old, ...saved, messages: old.messages } : saved); setNote("");
    } catch { setError("No se pudo guardar la nota privada."); }
  };
  const generateDraft = async () => {
    if (!detail || !aiConsent) return;
    try {
      const saved = await generate.mutateAsync({ id, data: { revision: detail.revision, instructions: instructions.trim(), consent: true } });
      qc.setQueryData(queryKey, saved); setInstructions(""); setAiConsent(false);
    } catch { setError("No se pudo generar el borrador. No se ha enviado ningún correo."); }
  };
  const confirmSend = async () => {
    if (!detail) return;
    if (dirty) { setError("Guarda primero los cambios del borrador antes de enviar."); return; }
    setError(""); setSendUnknown(false);
    try {
      await send.mutateAsync({ id, data: { revision: detail.revision, confirmed: true } });
      setSendConfirm(false);
      await qc.invalidateQueries({ queryKey: queryKey });
    } catch {
      setSendUnknown(true);
      setError("No se conoce el resultado del envío. Comprueba Gmail Enviados antes de volver a intentarlo.");
    }
  };
  const linkCase = async (targetCaseId: number) => {
    setError("");
    try {
      const saved = await addCaseLink.mutateAsync({ id, data: { targetCaseId } });
      qc.setQueryData(queryKey, saved);
      await qc.invalidateQueries({ queryKey: getGetCoordinatorMailWorkspaceQueryKey() });
      setLinkSearch("");
    } catch {
      setError("No se pudo vincular el asunto. Comprueba que sigue en tu buzón y vuelve a intentarlo.");
    }
  };
  const unlinkCase = async (targetCaseId: number) => {
    if (!window.confirm("¿Desvincular este caso? Sus mensajes, adjuntos, notas y borrador se conservarán en su caso original.")) return;
    setError("");
    try {
      const saved = await removeCaseLink.mutateAsync({ id, linkedId: targetCaseId });
      qc.setQueryData(queryKey, saved);
      await qc.invalidateQueries({ queryKey: getGetCoordinatorMailWorkspaceQueryKey() });
    } catch {
      setError("No se pudo desvincular el caso. El historial original se conserva.");
    }
  };
  if (query.isLoading) return <WorkspaceShell><div className="mail-detail-skeleton" role="status" data-testid="loading-mail-detail"><Skeleton className="h-12 w-2/3" /><Skeleton className="h-56" /><Skeleton className="h-64" /></div></WorkspaceShell>;
  if (query.isError || !detail) return <WorkspaceShell><div className="mail-error-state" role="alert" data-testid="status-mail-detail-error"><CircleAlert /><div><strong>No se pudo abrir este asunto</strong><p>Vuelve a la bandeja e inténtalo de nuevo.</p></div><Link href="/asuntos-correo" className="mail-button-link"><ArrowLeft /> Volver a la bandeja</Link></div></WorkspaceShell>;
  const maxPages = Math.max(1, Math.ceil(detail.messages.total / detail.messages.pageSize));
  const timeline = [
    ...detail.messages.items.map((message) => ({ kind: "email" as const, at: new Date(message.receivedAt), item: message })),
    ...detail.notes.map((entry) => ({ kind: "note" as const, at: new Date(entry.createdAt), item: entry })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime() || a.item.id - b.item.id || a.kind.localeCompare(b.kind));
  const lastInbound = [...detail.messages.items].reverse().find((message) => message.direction === "received");
  const verifiedRecipient = draftTo.trim();
  const attachmentDownload = async (attachmentId: number, filename: string) => {
    try {
      const token = localStorage.getItem(TOKEN_KEY);
      const res = await fetch(`/api/coordinator-mail/attachments/${attachmentId}`, { credentials: "include", headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error("download");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch { setError(`No se pudo descargar «${filename}». Comprueba tu conexión y vuelve a intentarlo.`); }
  };
  return <WorkspaceShell>
    <div className="mail-detail-top"><Link href="/asuntos-correo" className="mail-back" data-testid="link-back-mail-inbox"><ArrowLeft /> Bandeja</Link><span className="mail-revision" data-testid="text-mail-revision">Revisión {detail.revision}</span></div>
    <header className="mail-detail-head" data-testid="header-mail-case">
      <div><p className="mail-eyebrow">Asunto {detail.id}{detail.linkedCaseCount > 1 ? ` · ${detail.linkedCaseCount} casos vinculados` : ""} · {detail.messageCount} mensajes</p><h1 data-testid="heading-mail-case">{detail.title}</h1><p className="mail-subject-latest">{detail.latestSubject || "Sin asunto"}</p></div>
      <span className={statusClass(detail.status)} data-testid="status-mail-case-detail">{STATUS_LABEL[detail.status]}</span>
    </header>
    {error && <div className="mail-error-state mail-error-state--compact" role="alert" data-testid="status-mail-detail-action-error"><CircleAlert /><p>{error}</p><button aria-label="Cerrar aviso" onClick={() => setError("")} data-testid="button-dismiss-mail-error"><X /></button></div>}
    {sendUnknown && <div className="mail-warning" role="alert" data-testid="notice-mail-send-unknown"><AlertTriangle /> Comprueba la carpeta Enviados de Gmail antes de repetir el envío.</div>}
    <div className="mail-detail-grid">
      <section className="mail-thread" aria-labelledby="mail-thread-title">
        <div className="mail-section-heading"><div><p className="mail-eyebrow">Historial</p><h2 id="mail-thread-title">Conversación</h2></div><span data-testid="text-mail-message-count">{detail.messages.total} mensajes</span></div>
        <div className="mail-timeline" data-testid="list-mail-timeline">
          {timeline.map((entry) => entry.kind === "email" ? <article className={`mail-message mail-message--${entry.item.direction}`} key={`m-${entry.item.id}`} data-testid={`card-mail-message-${entry.item.id}`}>
            <div className="mail-message__line"><span className="mail-message__dot" /><div className="mail-message__who"><strong>{entry.item.senderName || entry.item.senderEmail}</strong><span>{entry.item.direction === "received" ? "Recibido" : "Enviado"} · {safeDate(entry.item.receivedAt)}</span></div></div>
            <div className="mail-message__content"><p className="mail-source">Caso original: {entry.item.caseTitle}</p><div className="mail-message__recipient">De: {entry.item.senderEmail}<br />Para: {entry.item.toEmails || "—"}{entry.item.ccEmails ? <><br />CC: {entry.item.ccEmails}</> : null}</div>
              <h3>{entry.item.subject || "Sin asunto"}</h3><p className="mail-inert-body" data-testid={`text-mail-message-body-${entry.item.id}`}>{entry.item.bodyText}{entry.item.bodyTruncated ? "\n\n[Contenido recortado]" : ""}</p>
              {entry.item.attachments.length > 0 && <div className="mail-attachments"><p>Adjuntos · no se comparten con la IA</p>{entry.item.attachments.map((file) => <div className="mail-attachment-row" key={file.id}>
                <button className="mail-attachment" disabled={file.status !== "ready"} onClick={() => void attachmentDownload(file.id, file.fileName)} data-testid={`button-download-attachment-${file.id}`}><ArrowDownToLine /><span>{file.fileName}</span><small>{file.status === "ready" ? formatBytes(file.size) : "No disponible"}</small></button>
                {file.status === "ready" && isHtmlDocumentName(file.fileName) && <HtmlDocxDownloadButton
                  className="mail-attachment-docx"
                  fileName={file.fileName}
                  testId={`button-download-mail-attachment-docx-${file.id}`}
                  loadHtml={async () => {
                    const token = localStorage.getItem(TOKEN_KEY);
                    const response = await fetch(`/api/coordinator-mail/attachments/${file.id}`, {
                      credentials: "include",
                      headers: token ? { Authorization: `Bearer ${token}` } : {},
                    });
                    if (!response.ok) throw new Error("No se pudo descargar el archivo");
                    return response.blob();
                  }}
                />}
              </div>)}</div>}
            </div>
          </article> : <article className="mail-note" key={`n-${entry.item.id}`} data-testid={`card-mail-note-${entry.item.id}`}><div className="mail-message__line"><span className="mail-message__dot mail-message__dot--note" /><div className="mail-message__who"><strong>Nota privada · {entry.item.author}</strong><span>{safeDate(entry.item.createdAt)}</span></div></div><p className="mail-source">Caso original: {entry.item.caseTitle}</p><p>{entry.item.content}</p></article>)}
        </div>
        <nav className="mail-pagination mail-pagination--thread" aria-label="Paginación de mensajes" data-testid="pagination-mail-messages">
          <span data-testid="text-mail-message-page">Página {messagePage} de {maxPages}</span><div><Button variant="outline" size="sm" disabled={messagePage <= 1} onClick={() => setMessagePage((p) => Math.max(1, p - 1))} data-testid="button-mail-message-previous"><ArrowLeft /> Anterior</Button><Button variant="outline" size="sm" disabled={messagePage >= maxPages} onClick={() => setMessagePage((p) => Math.min(maxPages, p + 1))} data-testid="button-mail-message-next">Siguiente <ArrowRight /></Button></div>
        </nav>
        <form className="mail-note-form" onSubmit={(event) => void submitNote(event)} data-testid="form-mail-note"><label htmlFor="mail-note">Añadir nota privada</label><Textarea id="mail-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Apunta el siguiente paso o un contexto para el equipo…" rows={3} data-testid="input-mail-note" /><Button type="submit" disabled={!note.trim() || addNote.isPending} data-testid="button-add-mail-note"><MessageSquare /> {addNote.isPending ? "Guardando…" : "Añadir nota"}</Button></form>
      </section>
      <aside className="mail-tools" aria-label="Herramientas del asunto">
        <section className="mail-tool-card mail-case-links" data-testid="panel-mail-case-links">
          <h2>Casos enlazados</h2>
          <p className="mail-link-explainer">El historial compartido conserva mensajes, adjuntos y notas en sus casos originales. Cada borrador permanece en el caso donde se creó.</p>
          <ul>{detail.linkedCases.map((linked) => <li key={linked.id} data-testid={`mail-linked-case-${linked.id}`}>
            <Link href={`/asuntos-correo/${linked.id}`} className={linked.isCurrent ? "mail-linked-case mail-linked-case--current" : "mail-linked-case"}>{linked.title}{linked.isCurrent ? " · caso abierto" : ""}</Link>
            {!linked.isCurrent && <Button type="button" size="sm" variant="ghost" disabled={removeCaseLink.isPending} onClick={() => void unlinkCase(linked.id)} data-testid={`button-unlink-mail-case-${linked.id}`}><Unlink /> Desvincular</Button>}
          </li>)}</ul>
          <label htmlFor="mail-link-search">Vincular otro asunto</label>
          <Input id="mail-link-search" value={linkSearch} onChange={(event) => { setLinkSearch(event.target.value); setLinkPage(1); }} placeholder="Busca por asunto, remitente o texto" data-testid="input-mail-link-search" />
          <p className="mail-link-hint">Escribe al menos dos caracteres. Solo aparecen casos de tu propio buzón.</p>
          {linkSearch.trim().length >= 2 && linkCandidatesQuery.isLoading && <p role="status">Buscando asuntos…</p>}
          {linkSearch.trim().length >= 2 && linkCandidatesQuery.isError && <p className="mail-link-error" role="alert">No se pudieron buscar los asuntos.</p>}
          {linkSearch.trim().length >= 2 && linkCandidatesQuery.data && (() => {
            const linkedIds = new Set(detail.linkedCases.map((entry) => entry.id));
            const candidates = linkCandidatesQuery.data.items.filter((entry) => !linkedIds.has(entry.id));
            return candidates.length ? <>
              <ul className="mail-link-results">{candidates.map((candidate) => <li key={candidate.id}>
                <span>{candidate.title}{candidate.linkedCaseCount > 1 ? ` · ${candidate.linkedCaseCount} casos` : ""}</span>
                <Button type="button" size="sm" variant="outline" disabled={addCaseLink.isPending} onClick={() => void linkCase(candidate.id)} data-testid={`button-link-mail-case-${candidate.id}`}><Link2 /> Vincular</Button>
              </li>)}</ul>
              {linkCandidatesQuery.data.total > linkCandidatesQuery.data.pageSize && <nav className="mail-link-pagination" aria-label="Resultados de asuntos">
                <Button type="button" size="sm" variant="ghost" disabled={linkPage <= 1 || linkCandidatesQuery.isFetching} onClick={() => setLinkPage((value) => Math.max(1, value - 1))}>Anterior</Button>
                <span>{linkPage} / {Math.ceil(linkCandidatesQuery.data.total / linkCandidatesQuery.data.pageSize)}</span>
                <Button type="button" size="sm" variant="ghost" disabled={linkPage >= Math.ceil(linkCandidatesQuery.data.total / linkCandidatesQuery.data.pageSize) || linkCandidatesQuery.isFetching} onClick={() => setLinkPage((value) => value + 1)}>Siguiente</Button>
              </nav>}
            </> : <p className="mail-link-hint">No hay otros asuntos que coincidan.</p>;
          })()}
        </section>
        <section className="mail-tool-card" data-testid="panel-mail-case-settings"><h2>Seguimiento</h2><label htmlFor="mail-case-status">Estado</label><select id="mail-case-status" value={detail.status} onChange={(event) => void updateStatus(event.target.value as CoordinatorMailCaseStatus)} data-testid="select-mail-case-status"><option value="open">Abierto</option><option value="waiting">En espera</option><option value="closed">Cerrado</option></select><label htmlFor="mail-case-due">Vencimiento</label><div className="mail-date-input"><CalendarClock /><input id="mail-case-due" type="date" value={detail.dueAt ? new Date(detail.dueAt).toISOString().slice(0, 10) : ""} onChange={(event) => void updateDueDate(event.target.value)} data-testid="input-mail-case-due" /></div></section>
        <section className="mail-tool-card mail-reply" data-testid="panel-mail-reply"><div className="mail-tool-heading"><div><p className="mail-eyebrow">Respuesta</p><h2>Borrador revisable</h2></div><span className={dirty ? "mail-save-indicator mail-save-indicator--dirty" : "mail-save-indicator"} data-testid="status-mail-draft-save">{dirty ? "Sin guardar" : "Guardado"}</span></div>
          <div className="mail-forward-warning" role="note" data-testid="notice-forwarded-email"><AlertTriangle /> Si este email fue reenviado, quien lo reenvió puede no ser la persona destinataria de tu respuesta.</div>
          <label htmlFor="mail-draft-to">Destinatario</label><Input id="mail-draft-to" type="email" value={draftTo} onChange={(event) => setDraftTo(event.target.value)} placeholder="nombre@dominio.es" data-testid="input-mail-draft-to" />
          <div className="mail-recipient-check" data-testid="status-mail-recipient-check"><Check /> Se responderá a <strong>{verifiedRecipient || "—"}</strong>. Comprueba que es la persona correcta.</div>
          <label htmlFor="mail-draft-subject">Asunto</label><Input id="mail-draft-subject" value={draftSubject} onChange={(event) => setDraftSubject(event.target.value)} data-testid="input-mail-draft-subject" />
          <label htmlFor="mail-draft-body">Mensaje</label><Textarea id="mail-draft-body" value={draftBody} onChange={(event) => setDraftBody(event.target.value)} rows={9} data-testid="input-mail-draft-body" />
          <Button className="mail-full-button" variant="outline" onClick={() => void saveDraft()} disabled={!dirty || update.isPending} data-testid="button-save-mail-draft">{update.isPending ? "Guardando…" : "Guardar borrador"}</Button>
          <KnowledgeCoveragePanel />
          {conflict && <div className="mail-conflict" role="alert" data-testid="status-mail-revision-conflict"><strong>Hay una revisión más reciente.</strong><p>Tu borrador local se conserva. Elige qué versión guardar.</p><div><Button size="sm" onClick={() => void saveDraft(true)} data-testid="button-overwrite-mail-draft">Guardar mi versión</Button><Button size="sm" variant="ghost" onClick={() => { setDraftTo(detail.draftTo); setDraftSubject(detail.draftSubject); setDraftBody(detail.draftBody); setBaseline({ to: detail.draftTo, subject: detail.draftSubject, body: detail.draftBody }); setRevision(detail.revision); setConflict(false); }} data-testid="button-load-server-mail-draft">Cargar servidor</Button></div></div>}
          <div className="mail-ai-box"><div className="mail-ai-title"><Sparkles /><strong>Asistencia para redactar</strong></div><p>Con tu autorización, la IA busca información pertinente en todos tus correos importados y en los materiales de plataforma y espacios de Nextcloud a los que ya tienes acceso. No se solicita una conexión individual a Nextcloud. Los archivos que no puedan leerse se omiten y se advierte en el historial.</p><Textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} rows={2} placeholder="Indicaciones para el borrador (opcional)" data-testid="input-mail-ai-instructions" /><label className="mail-consent"><Checkbox checked={aiConsent} onCheckedChange={(value) => setAiConsent(value === true)} data-testid="checkbox-mail-ai-consent" />Autorizo enviar los mensajes y materiales pertinentes a los proveedores de IA configurados para generar este borrador.</label><Button className="mail-full-button" variant="secondary" onClick={() => void generateDraft()} disabled={!aiConsent || generate.isPending || detail.aiStatus === "queued" || detail.aiStatus === "processing"} data-testid="button-generate-mail-draft"><Sparkles /> {generate.isPending ? "Preparando…" : "Generar borrador"}</Button><span className="mail-ai-status" data-testid="status-mail-ai">{detail.aiStatus === "idle" ? "No se ha solicitado generación." : `Estado: ${detail.aiStatus}${detail.aiError ? " · No disponible" : ""}`}</span></div>
          {sendConfirm ? <div className="mail-send-confirm" role="alertdialog" aria-labelledby="mail-send-confirm-title" data-testid="dialog-confirm-mail-send"><h3 id="mail-send-confirm-title">Revisa antes de enviar</h3><p><strong>Para:</strong> {draftTo}</p><p><strong>Asunto:</strong> {draftSubject}</p><p className="mail-confirm-body">{draftBody}</p><div className="mail-send-confirm__actions"><Button variant="outline" onClick={() => setSendConfirm(false)} data-testid="button-cancel-mail-send">Volver a revisar</Button><Button onClick={() => void confirmSend()} disabled={send.isPending || dirty || !draftTo.includes("@")} data-testid="button-confirm-mail-send"><Send /> {send.isPending ? "Enviando…" : "Confirmar envío"}</Button></div></div> : <Button className="mail-full-button mail-send-button" onClick={() => { if (dirty) { setError("Guarda el borrador antes de enviarlo."); return; } setSendConfirm(true); }} disabled={!draftTo.trim() || send.isPending || detail.status === "closed"} data-testid="button-review-mail-send"><Send /> Revisar y enviar</Button>}
          <p className="mail-send-footnote" data-testid="text-mail-send-policy">La IA nunca envía. El envío solo ocurre tras revisar y confirmar explícitamente.</p>
        </section>
      </aside>
    </div>
  </WorkspaceShell>;
}

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function CoordinatorGmailAdminSettings() {
  const qc = useQueryClient();
  const settingsQuery = useGetCoordinatorMailAdminSettings();
  const update = useUpdateCoordinatorMailAdminSettings();
  const startOAuth = useStartCoordinatorGmailOAuth();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [redirectUri, setRedirectUri] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const settings = settingsQuery.data;
  useEffect(() => { if (settings?.clientId) setClientId(settings.clientId); if (settings?.redirectUri) setRedirectUri(settings.redirectUri); }, [settings?.clientId, settings?.redirectUri]);
  const save = async (event: FormEvent) => {
    event.preventDefault(); setMessage(""); setError("");
    try {
      const saved = await update.mutateAsync({ data: { clientId: clientId.trim(), redirectUri: redirectUri.trim(), ...(clientSecret.trim() ? { clientSecret: clientSecret.trim() } : {}) } });
      qc.setQueryData(settingsQuery.queryKey, saved); setClientSecret(""); setMessage("Configuración de Gmail guardada.");
    } catch { setError("No se pudo guardar la configuración. Revisa los campos e inténtalo de nuevo."); }
  };
  const connect = async () => {
    setError("");
    try { const result = await startOAuth.mutateAsync(); window.location.assign(result.authorizationUrl); }
    catch { setError("No se pudo iniciar la autorización de Google. Comprueba la configuración OAuth."); }
  };
  const { user } = useAuth();
  if (user?.role !== "superadmin") return <div className="mail-admin-denied" data-testid="status-mail-admin-access-denied"><ShieldCheck /> Solo superadministración puede configurar OAuth de Gmail.</div>;
  return <section className="mail-admin-card" data-testid="panel-gmail-oauth-settings">
    <div className="mail-admin-header"><div className="mail-connection__mark"><Mail /></div><div><p className="mail-eyebrow">Integración propia</p><h2>Gmail para asuntos de correo</h2><p>La conexión OAuth de esta aplicación es independiente de Replit.</p></div></div>
    {settingsQuery.isLoading ? <div role="status" data-testid="loading-gmail-oauth-settings"><Skeleton className="h-10" /><Skeleton className="h-10" /></div> : settingsQuery.isError ? <div className="mail-safe-error" role="alert" data-testid="status-gmail-oauth-load-error">No se pudo consultar la configuración de OAuth.</div> : <form onSubmit={(event) => void save(event)} className="mail-admin-form">
      <label htmlFor="gmail-client-id">ID de cliente OAuth</label><Input id="gmail-client-id" value={clientId} onChange={(event) => setClientId(event.target.value)} required autoComplete="off" data-testid="input-gmail-client-id" />
      <label htmlFor="gmail-client-secret">Secreto de cliente OAuth</label><Input id="gmail-client-secret" type="password" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} autoComplete="new-password" placeholder={settings?.clientSecretConfigured ? "Configurado · escribe solo para reemplazarlo" : "Secreto de cliente"} data-testid="input-gmail-client-secret" />
      <p className="mail-admin-hint">El secreto nunca se precarga ni se devuelve. Déjalo vacío para conservarlo.</p>
      <label htmlFor="gmail-redirect-uri">URI de redirección autorizada</label><Input id="gmail-redirect-uri" value={redirectUri} onChange={(event) => setRedirectUri(event.target.value)} required autoComplete="url" data-testid="input-gmail-redirect-uri" />
      <p className="mail-admin-hint">Copia esta URI exacta en Google Cloud Console como URI de redirección OAuth autorizada.</p>
      <div className="mail-google-guide" data-testid="guide-google-oauth"><h3>Crear credenciales en Google Cloud</h3><ol><li>En Google Cloud Console, crea o selecciona un proyecto.</li><li>Activa <strong>Gmail API</strong> en APIs y servicios.</li><li>Configura la pantalla de consentimiento OAuth y crea un ID de cliente de tipo aplicación web.</li><li>Añade arriba la URI exacta mostrada como URI de redirección autorizada.</li><li>Guarda aquí el ID y el secreto. La primera sincronización importa todo el historial en segundo plano; después se sincroniza aproximadamente cada 5 minutos.</li></ol></div>
      {message && <p className="mail-success" role="status" data-testid="status-gmail-oauth-saved">{message}</p>}
      {error && <p className="mail-safe-error" role="alert" data-testid="status-gmail-oauth-error">{error}</p>}
      <div className="mail-admin-actions"><Button type="submit" disabled={update.isPending || !clientId.trim() || !redirectUri.trim()} data-testid="button-save-gmail-oauth">{update.isPending ? "Guardando…" : "Guardar configuración"}</Button><Button type="button" variant="outline" onClick={() => void connect()} disabled={!settings?.ready || startOAuth.isPending} data-testid="button-connect-gmail-oauth">{startOAuth.isPending ? "Abriendo Google…" : "Autorizar Gmail"}</Button></div>
    </form>}
  </section>;
}
