import React, { useMemo, useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";

import {
  getListCoordinatorTasksQueryKey,
  useAnalyzeCoordinatorTaskSources,
  useCreateCoordinatorTask,
  useListCoordinatorTasks,
  useUpdateCoordinatorTask,
  type CoordinatorTask,
  type CoordinatorTaskStatus,
  type CoordinatorTaskUpdate,
} from "@workspace/api-client-react";

import { AppHeader } from "@/components/AppHeader";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { Button, Card } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

type TaskFilter = "active" | "resolved" | "suggested" | "dismissed";

const STATUS_LABEL: Record<CoordinatorTaskStatus, string> = {
  pending: "Pendiente",
  in_progress: "En proceso",
  resolved: "Resuelta",
};

const SOURCE_LABEL: Record<CoordinatorTask["sourceType"], string> = {
  manual: "Añadida manualmente",
  minutes: "Acta publicada",
  message: "Mensaje recibido",
  email: "Correo recibido",
};

function errorText(error: unknown, fallback: string): string {
  const message = (error as { data?: { message?: unknown } } | null)?.data?.message;
  return typeof message === "string" && message.trim() ? message : fallback;
}

function dateText(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("es-ES", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function TaskCard({
  task,
  onAccept,
  onDismiss,
  onSetStatus,
  onBeginResolve,
  onCancelResolve,
  onResolve,
  disabled,
  resolution,
  setResolution,
  resolving,
}: {
  task: CoordinatorTask;
  onAccept: () => void;
  onDismiss: () => void;
  onSetStatus: (status: CoordinatorTaskStatus) => void;
  onBeginResolve: () => void;
  onCancelResolve: () => void;
  onResolve: () => void;
  disabled: boolean;
  resolution: string;
  setResolution: (value: string) => void;
  resolving: boolean;
}) {
  const colors = useColors();
  const suggested = task.reviewStatus === "suggested";
  const statusColor =
    task.status === "resolved"
      ? colors.success
      : task.status === "in_progress"
        ? colors.primary
        : colors.mutedForeground;
  const date = dateText(task.sourceDate);

  return (
    <Card style={[styles.taskCard, { borderLeftColor: suggested ? colors.secondary : statusColor }]} testID={`card-task-${task.id}`}>
      <View style={styles.taskTop}>
        <View style={styles.taskTitleWrap}>
          <Text style={[styles.taskTitle, { color: colors.foreground }]} testID={`text-task-title-${task.id}`}>
            {task.title}
          </Text>
          <Text style={[styles.source, { color: colors.mutedForeground }]}>
            {SOURCE_LABEL[task.sourceType]}
            {task.sourceLabel ? ` · ${task.sourceLabel}` : ""}
            {date ? ` · ${date}` : ""}
          </Text>
        </View>
        <View style={[styles.statusPill, { backgroundColor: suggested ? colors.secondary : colors.accent }]}>
          <Text style={[styles.statusPillText, { color: suggested ? colors.secondaryForeground : statusColor }]}>
            {suggested ? "Sugerencia IA" : STATUS_LABEL[task.status]}
          </Text>
        </View>
      </View>

      {task.description ? (
        <Text style={[styles.description, { color: colors.mutedForeground }]}>{task.description}</Text>
      ) : null}

      {task.status === "resolved" && task.resolution ? (
        <View style={[styles.resolutionBox, { backgroundColor: colors.muted }]}>
          <Text style={[styles.resolutionLabel, { color: colors.foreground }]}>Resolución</Text>
          <Text style={[styles.description, { color: colors.mutedForeground }]}>{task.resolution}</Text>
        </View>
      ) : null}

      {suggested ? (
        <View style={styles.actions}>
          <Button
            label="Confirmar tarea"
            icon="check"
            onPress={onAccept}
            loading={disabled}
            testID={`button-accept-task-${task.id}`}
            style={styles.actionButton}
          />
          <Button
            label="Descartar"
            variant="ghost"
            onPress={onDismiss}
            disabled={disabled}
            testID={`button-dismiss-task-${task.id}`}
            style={styles.actionButton}
          />
        </View>
      ) : task.reviewStatus === "dismissed" ? (
        <Text style={[styles.dismissedLabel, { color: colors.mutedForeground }]}>Sugerencia descartada</Text>
      ) : task.status === "resolved" ? (
        <Button
          label="Reabrir tarea"
          variant="ghost"
          icon="rotate-ccw"
          onPress={() => onSetStatus("pending")}
          disabled={disabled}
          testID={`button-reopen-task-${task.id}`}
          style={styles.statusAction}
        />
      ) : resolving ? (
        <View style={styles.resolveForm}>
          <TextInput
            value={resolution}
            onChangeText={setResolution}
            multiline
            maxLength={4000}
            placeholder="Describe cómo se resolvió"
            placeholderTextColor={colors.mutedForeground}
            accessibilityLabel={`Resolución de ${task.title}`}
            testID={`input-resolution-${task.id}`}
            style={[
              styles.input,
              styles.resolutionInput,
              { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, borderRadius: colors.radius },
            ]}
          />
          <View style={styles.actions}>
            <Button
              label="Guardar resolución"
              icon="check"
              onPress={onResolve}
              loading={disabled}
              disabled={!resolution.trim()}
              testID={`button-save-resolution-${task.id}`}
              style={styles.actionButton}
            />
            <Button
              label="Cancelar"
              variant="ghost"
              onPress={onCancelResolve}
              disabled={disabled}
              testID={`button-cancel-resolution-${task.id}`}
              style={styles.actionButton}
            />
          </View>
        </View>
      ) : (
        <View style={styles.actions}>
          {task.status === "pending" ? (
            <Button
              label="Iniciar"
              icon="play"
              onPress={() => onSetStatus("in_progress")}
              disabled={disabled}
              testID={`button-start-task-${task.id}`}
              style={styles.actionButton}
            />
          ) : (
            <Button
              label="Volver a pendiente"
              variant="ghost"
              onPress={() => onSetStatus("pending")}
              disabled={disabled}
              testID={`button-pending-task-${task.id}`}
              style={styles.actionButton}
            />
          )}
          <Button
            label="Resolver"
            variant="secondary"
            icon="check-circle"
            onPress={onBeginResolve}
            disabled={disabled}
            testID={`button-resolve-task-${task.id}`}
            style={styles.actionButton}
          />
        </View>
      )}
    </Card>
  );
}

export default function CoordinatorTasksScreen() {
  const colors = useColors();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canManage = user?.role === "coordinator" || user?.role === "superadmin";
  const tasksQuery = useListCoordinatorTasks({
    query: {
      queryKey: getListCoordinatorTasksQueryKey(),
      enabled: canManage,
    },
  });
  const createMutation = useCreateCoordinatorTask();
  const analyzeMutation = useAnalyzeCoordinatorTaskSources();
  const updateMutation = useUpdateCoordinatorTask();
  const [filter, setFilter] = useState<TaskFilter>("active");
  const [manualOpen, setManualOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [resolutionById, setResolutionById] = useState<Record<number, string>>({});
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const [dismissedOpen, setDismissedOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysisNote, setAnalysisNote] = useState<string | null>(null);

  const allTasks = tasksQuery.data?.tasks ?? [];
  const suggestions = useMemo(
    () => allTasks.filter((task) => task.reviewStatus === "suggested"),
    [allTasks],
  );
  const dismissed = useMemo(
    () => allTasks.filter((task) => task.reviewStatus === "dismissed"),
    [allTasks],
  );
  const active = useMemo(
    () => allTasks.filter((task) => task.reviewStatus === "accepted" && task.status !== "resolved"),
    [allTasks],
  );
  const resolved = useMemo(
    () => allTasks.filter((task) => task.reviewStatus === "accepted" && task.status === "resolved"),
    [allTasks],
  );
  const displayedTasks =
    filter === "active" ? active :
      filter === "resolved" ? resolved :
        filter === "suggested" ? suggestions : dismissed;

  const refreshTasks = async () => {
    await queryClient.invalidateQueries({ queryKey: getListCoordinatorTasksQueryKey() });
  };

  const updateTask = async (task: CoordinatorTask, data: Omit<CoordinatorTaskUpdate, "revision">) => {
    setError(null);
    try {
      await updateMutation.mutateAsync({ id: task.id, data: { revision: task.revision, ...data } });
      await refreshTasks();
      setResolvingId(null);
      setResolutionById((current) => {
        const next = { ...current };
        delete next[task.id];
        return next;
      });
    } catch (e) {
      setError(errorText(e, "No se pudo actualizar la tarea."));
    }
  };

  const createTask = async () => {
    if (!title.trim()) {
      setError("Escribe un título para la tarea.");
      return;
    }
    setError(null);
    try {
      await createMutation.mutateAsync({ data: { title: title.trim(), description: description.trim() } });
      await refreshTasks();
      setTitle("");
      setDescription("");
      setManualOpen(false);
    } catch (e) {
      setError(errorText(e, "No se pudo guardar la tarea."));
    }
  };

  const analyzeSources = async () => {
    setError(null);
    setAnalysisNote(null);
    try {
      const result = await analyzeMutation.mutateAsync();
      await refreshTasks();
      const parts = [`Se revisaron ${result.scanned} fuentes`, `se añadieron ${result.suggestionsCreated} sugerencias`];
      if (result.remaining > 0) parts.push(`quedan ${result.remaining} fuentes por revisar`);
      setAnalysisNote(`${parts.join("; ")}.`);
      if (result.warnings.length) setError(result.warnings.join(" "));
    } catch (e) {
      setError(errorText(e, "No se pudieron analizar las fuentes."));
    }
  };

  const onSetResolution = (task: CoordinatorTask, value: string) => {
    setResolutionById((current) => ({ ...current, [task.id]: value }));
  };

  const onResolve = (task: CoordinatorTask) => {
    const resolution = resolutionById[task.id]?.trim() ?? "";
    if (!resolution) {
      setError("Escribe la resolución antes de cerrar la tarea.");
      return;
    }
    void updateTask(task, { status: "resolved", resolution });
  };

  const bottomPad = Platform.OS === "web" ? 100 : 36;

  if (!canManage) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <AppHeader title="Tareas pendientes" subtitle="Seguimiento de acuerdos" showBack />
        <View style={styles.centered}>
          <Feather name="lock" size={28} color={colors.mutedForeground} />
          <Text style={[styles.body, { color: colors.mutedForeground }]}>
            Este apartado es privado para la coordinación.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader title="Tareas pendientes" subtitle="Seguimiento de acuerdos" showBack />
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]}
        keyboardShouldPersistTaps="handled"
        bottomOffset={24}
      >
        <View style={styles.hero}>
          <View style={[styles.heroIcon, { backgroundColor: colors.accent }]}>
            <Feather name="check-square" size={22} color={colors.primary} />
          </View>
          <View style={styles.heroCopy}>
            <Text style={[styles.heroTitle, { color: colors.foreground }]}>Acuerdos que requieren seguimiento</Text>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              Revisa las propuestas y registra el resultado de cada tarea.
            </Text>
          </View>
        </View>

        {tasksQuery.data?.aiAvailable ? (
          <Button
            label={analyzeMutation.isPending ? "Analizando fuentes…" : "Analizar nuevas fuentes"}
            icon="zap"
            onPress={analyzeSources}
            loading={analyzeMutation.isPending}
            disabled={analyzeMutation.isPending}
            testID="button-analyze-sources"
          />
        ) : (
          <Card style={styles.notice}>
            <Feather name="alert-circle" size={18} color={colors.mutedForeground} />
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              El análisis con IA no está configurado. Puedes seguir añadiendo y gestionando tareas manualmente.
            </Text>
          </Card>
        )}

        {tasksQuery.data && !tasksQuery.data.gmailConnected ? (
          <Card style={styles.notice}>
            <Feather name="mail" size={18} color={colors.mutedForeground} />
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              No hay un buzón Gmail personal conectado. El análisis incluirá actas publicadas y mensajes a los que ya tienes acceso.
            </Text>
          </Card>
        ) : null}
        {tasksQuery.data && ["queued", "syncing", "error", "needs_reauthorization"].includes(tasksQuery.data.gmailSyncStatus) ? (
          <Card style={styles.notice}>
            <Feather name="refresh-cw" size={18} color={colors.mutedForeground} />
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              Gmail no está completamente sincronizado. Solo se analizarán los correos que ya estén guardados en la aplicación.
            </Text>
          </Card>
        ) : null}

        {analysisNote ? (
          <Card style={[styles.successNotice, { borderLeftColor: colors.success }]} testID="status-analysis-result">
            <Feather name="check-circle" size={18} color={colors.success} />
            <Text style={[styles.body, { color: colors.foreground }]}>{analysisNote}</Text>
          </Card>
        ) : null}
        {error ? (
          <Card style={[styles.errorNotice, { borderLeftColor: colors.destructive }]} testID="status-task-error">
            <Feather name="alert-circle" size={18} color={colors.destructive} />
            <Text style={[styles.body, { color: colors.destructive }]}>{error}</Text>
          </Card>
        ) : null}

        <View style={styles.summary}>
          {[
            { label: "Activas", value: active.length, color: colors.primary },
            { label: "Por revisar", value: suggestions.length, color: colors.secondaryForeground },
            { label: "Resueltas", value: resolved.length, color: colors.success },
          ].map((item) => (
            <Card key={item.label} style={styles.summaryCard}>
              <Text style={[styles.summaryValue, { color: item.color }]} testID={`text-task-count-${item.label.toLowerCase().replace(/\s/g, "-")}`}>
                {item.value}
              </Text>
              <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>{item.label}</Text>
            </Card>
          ))}
        </View>

        <View style={styles.sectionHeading}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Tareas</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={manualOpen ? "Cerrar nueva tarea" : "Añadir una tarea"}
            testID="button-toggle-manual-task"
            onPress={() => {
              setManualOpen((open) => !open);
              setError(null);
            }}
            style={[styles.addButton, { backgroundColor: colors.primary }]}
          >
            <Feather name={manualOpen ? "x" : "plus"} size={18} color={colors.primaryForeground} />
            <Text style={[styles.addButtonLabel, { color: colors.primaryForeground }]}>
              {manualOpen ? "Cerrar" : "Añadir"}
            </Text>
          </Pressable>
        </View>

        {manualOpen ? (
          <Card style={styles.formCard}>
            <Text style={[styles.formTitle, { color: colors.foreground }]}>Nueva tarea</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="¿Qué hay que hacer?"
              placeholderTextColor={colors.mutedForeground}
              maxLength={200}
              accessibilityLabel="Título de la tarea"
              testID="input-task-title"
              style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground, borderRadius: colors.radius }]}
            />
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Contexto o detalles (opcional)"
              placeholderTextColor={colors.mutedForeground}
              multiline
              maxLength={4000}
              accessibilityLabel="Descripción de la tarea"
              testID="input-task-description"
              style={[styles.input, styles.descriptionInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground, borderRadius: colors.radius }]}
            />
            <Button
              label="Guardar tarea"
              icon="check"
              onPress={createTask}
              loading={createMutation.isPending}
              disabled={createMutation.isPending || !title.trim()}
              testID="button-save-manual-task"
            />
          </Card>
        ) : null}

        <View style={styles.filterRow}>
          {([
            ["active", "Activas"],
            ["suggested", "Sugerencias"],
            ["resolved", "Resueltas"],
            ["dismissed", "Descartadas"],
          ] as const).map(([value, label]) => {
            const selected = filter === value;
            const count = value === "active" ? active.length :
              value === "suggested" ? suggestions.length :
                value === "resolved" ? resolved.length : dismissed.length;
            return (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                testID={`button-filter-${value}`}
                onPress={() => setFilter(value)}
                style={[
                  styles.filter,
                  { backgroundColor: selected ? colors.primary : colors.card, borderColor: selected ? colors.primary : colors.border },
                ]}
              >
                <Text style={[styles.filterText, { color: selected ? colors.primaryForeground : colors.mutedForeground }]}>
                  {label} · {count}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {tasksQuery.isLoading ? (
          <Card style={styles.emptyState}>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>Cargando tareas…</Text>
          </Card>
        ) : tasksQuery.isError ? (
          <Card style={styles.emptyState}>
            <Text style={[styles.body, { color: colors.destructive }]}>
              No se pudieron cargar las tareas. Comprueba la conexión e inténtalo de nuevo.
            </Text>
            <Button
              label="Reintentar"
              variant="ghost"
              onPress={() => void tasksQuery.refetch()}
              testID="button-retry-tasks"
            />
          </Card>
        ) : displayedTasks.length ? (
          <View style={styles.taskList}>
            {displayedTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onAccept={() => void updateTask(task, { reviewStatus: "accepted" })}
                onDismiss={() => void updateTask(task, { reviewStatus: "dismissed" })}
                onSetStatus={(status) => void updateTask(task, {
                  status,
                  ...(status === "pending" && task.status === "resolved" ? { resolution: null } : {}),
                })}
                onBeginResolve={() => {
                  setError(null);
                  setResolvingId(task.id);
                  onSetResolution(task, "");
                }}
                onCancelResolve={() => {
                  setResolvingId(null);
                  onSetResolution(task, "");
                }}
                onResolve={() => onResolve(task)}
                disabled={updateMutation.isPending}
                resolution={resolutionById[task.id] ?? ""}
                setResolution={(value) => onSetResolution(task, value)}
                resolving={resolvingId === task.id}
              />
            ))}
          </View>
        ) : (
          <Card style={styles.emptyState} testID="text-task-empty">
            <Feather name={filter === "suggested" ? "zap" : "check-circle"} size={24} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              {filter === "active" ? "No hay tareas activas" :
                filter === "suggested" ? "No hay sugerencias por revisar" :
                  filter === "resolved" ? "Aún no hay tareas resueltas" : "No hay sugerencias descartadas"}
            </Text>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              {filter === "active" ? "Añade una tarea o analiza las fuentes disponibles." :
                filter === "suggested" ? "Cuando la IA detecte acuerdos pendientes podrás revisarlos aquí." :
                  "Las tareas que correspondan aparecerán en esta lista."}
            </Text>
          </Card>
        )}

        <Text style={[styles.privacyNote, { color: colors.mutedForeground }]}>
          Solo se analizan actas publicadas, mensajes visibles para ti y los correos de tu propio buzón.
        </Text>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 16 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  hero: { flexDirection: "row", alignItems: "center", gap: 12 },
  heroIcon: { width: 46, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  heroCopy: { flex: 1, gap: 3 },
  heroTitle: { fontSize: 18, lineHeight: 24, fontFamily: "Inter_700Bold" },
  body: { fontSize: 13, lineHeight: 19, fontFamily: "Inter_400Regular", flexShrink: 1 },
  notice: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12 },
  successNotice: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderLeftWidth: 3 },
  errorNotice: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderLeftWidth: 3 },
  summary: { flexDirection: "row", gap: 8 },
  summaryCard: { flex: 1, alignItems: "center", paddingVertical: 12, paddingHorizontal: 6 },
  summaryValue: { fontSize: 23, fontFamily: "Inter_700Bold" },
  summaryLabel: { marginTop: 3, fontSize: 11, fontFamily: "Inter_500Medium", textAlign: "center" },
  sectionHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  addButton: { minHeight: 38, borderRadius: 10, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 6 },
  addButtonLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  formCard: { gap: 12 },
  formTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  input: { minHeight: 46, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, fontFamily: "Inter_400Regular" },
  descriptionInput: { minHeight: 78, textAlignVertical: "top" },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  filter: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 8 },
  filterText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  taskList: { gap: 12 },
  taskCard: { gap: 11, borderLeftWidth: 3 },
  taskTop: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  taskTitleWrap: { flex: 1, gap: 5 },
  taskTitle: { fontSize: 15, lineHeight: 21, fontFamily: "Inter_600SemiBold" },
  source: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_400Regular" },
  statusPill: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 20 },
  statusPillText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  description: { fontSize: 13, lineHeight: 19, fontFamily: "Inter_400Regular" },
  resolutionBox: { gap: 4, padding: 10, borderRadius: 9 },
  resolutionLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  actionButton: { flexGrow: 1 },
  statusAction: { alignSelf: "flex-start" },
  resolveForm: { gap: 8 },
  resolutionInput: { minHeight: 74, textAlignVertical: "top" },
  dismissedLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  emptyState: { alignItems: "center", gap: 10, paddingVertical: 24, paddingHorizontal: 18 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  privacyNote: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 2 },
});
