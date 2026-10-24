import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import {
  useGetCollabStatus,
  useListCollaborativeSpaces,
  useListModules,
  useOpenCollaborativeSpace,
  useOpenModuleSpace,
  type CollaborativeSpace,
  type Module,
} from "@workspace/api-client-react";

import { AppHeader } from "@/components/AppHeader";
import { NextcloudViewer } from "@/components/NextcloudViewer";
import { Card, ErrorState, Loading } from "@/components/ui";
import { useColors } from "@/hooks/useColors";

type ActiveSpace = {
  title: string;
  url: string;
  nextcloudUrl: string;
  requestFreshUrl: () => Promise<string>;
};

export default function CollaborativeSpacesScreen() {
  const colors = useColors();
  const status = useGetCollabStatus();
  const modules = useListModules({});
  const spaces = useListCollaborativeSpaces();
  const openModule = useOpenModuleSpace();
  const openSpace = useOpenCollaborativeSpace();
  const [active, setActive] = useState<ActiveSpace | null>(null);
  const [openError, setOpenError] = useState("");
  const [viewerError, setViewerError] = useState("");

  const startModuleSpace = async (module: Module) => {
    setOpenError("");
    setViewerError("");
    try {
      const access = await openModule.mutateAsync({ moduleId: module.id });
      setActive({
        title: module.code ? `${module.code} · ${module.name}` : module.name,
        url: access.url,
        nextcloudUrl: access.nextcloudUrl,
        requestFreshUrl: async () => (await openModule.mutateAsync({ moduleId: module.id })).url,
      });
    } catch (error) {
      setOpenError(getErrorMessage(error, "No se pudo abrir el espacio del módulo."));
    }
  };

  const startIndependentSpace = async (space: CollaborativeSpace) => {
    setOpenError("");
    setViewerError("");
    try {
      const access = await openSpace.mutateAsync({ id: space.id });
      setActive({
        title: space.name, url: access.url, nextcloudUrl: access.nextcloudUrl,
        requestFreshUrl: async () => (await openSpace.mutateAsync({ id: space.id })).url,
      });
    } catch (error) {
      setOpenError(getErrorMessage(error, "No se pudo abrir el espacio colaborativo."));
    }
  };

  if (active) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <AppHeader
          title={active.title}
          subtitle="Archivos protegidos por tu sesión de Nextcloud"
          right={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cerrar espacio colaborativo"
              onPress={() => setActive(null)}
              hitSlop={12}
              style={({ pressed }) => ({ padding: 6, opacity: pressed ? 0.5 : 1 })}
            >
              <Feather name="x" size={22} color="#ffffff" />
            </Pressable>
          }
        />
        {viewerError ? (
          <View style={styles.center}>
            <Feather name="lock" size={30} color={colors.destructive} />
            <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive, textAlign: "center" }]}>
              {viewerError}
            </Text>
          </View>
        ) : (
          <NextcloudViewer
            url={active.url}
            nextcloudUrl={active.nextcloudUrl}
            title={active.title}
            requestFreshUrl={active.requestFreshUrl}
            onError={setViewerError}
          />
        )}
      </View>
    );
  }

  const loading = status.isLoading || modules.isLoading || spaces.isLoading;
  const failed = status.isError || modules.isError || spaces.isError;
  const configured = status.data?.configured;
  const busy = openModule.isPending || openSpace.isPending;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader
        title="Espacios colaborativos"
        subtitle="PDF y otros archivos de Nextcloud"
        showBack
      />
      {loading ? (
        <Loading />
      ) : failed ? (
        <ErrorState onRetry={() => {
          void status.refetch();
          void modules.refetch();
          void spaces.refetch();
        }} />
      ) : !configured ? (
        <View style={styles.center}>
          <Feather name="cloud-off" size={30} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            Nextcloud no está configurado
          </Text>
          <Text style={[styles.note, { color: colors.mutedForeground }]}>
            Los archivos colaborativos no están disponibles ahora.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          <Text style={[styles.note, { color: colors.mutedForeground }]}>
            Los archivos se abren dentro de Nextcloud. Cada PDF se sirve con tu sesión y sus permisos actuales; Coordina ADG no guarda una copia descargada.
          </Text>
          {openError ? (
            <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive }]}>
              {openError}
            </Text>
          ) : null}
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Módulos</Text>
          {modules.data?.length ? modules.data.map((module) => (
            <SpaceRow
              key={`module-${module.id}`}
              title={module.code ? `${module.code} · ${module.name}` : module.name}
              subtitle={module.cycleName ?? undefined}
              colors={colors}
              disabled={busy}
              onPress={() => void startModuleSpace(module)}
            />
          )) : (
            <Text style={[styles.note, { color: colors.mutedForeground }]}>
              No tienes módulos disponibles.
            </Text>
          )}

          <Text style={[styles.sectionTitle, { color: colors.foreground, marginTop: 12 }]}>
            Otros espacios
          </Text>
          {spaces.data?.length ? spaces.data.map((space) => (
            <SpaceRow
              key={`space-${space.id}`}
              title={space.name}
              subtitle={space.description || undefined}
              colors={colors}
              disabled={busy}
              onPress={() => void startIndependentSpace(space)}
            />
          )) : (
            <Text style={[styles.note, { color: colors.mutedForeground }]}>
              No formas parte de otros espacios.
            </Text>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function SpaceRow({
  title,
  subtitle,
  colors,
  disabled,
  onPress,
}: {
  title: string;
  subtitle?: string;
  colors: ReturnType<typeof useColors>;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Card style={styles.card}>
      <View style={styles.cardText}>
        <Text style={[styles.cardTitle, { color: colors.foreground }]} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.note, { color: colors.mutedForeground }]} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Abrir ${title}`}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [
          styles.openButton,
          { backgroundColor: colors.primary, borderRadius: colors.radius, opacity: pressed || disabled ? 0.6 : 1 },
        ]}
      >
        {disabled
          ? <ActivityIndicator size="small" color={colors.primaryForeground} />
          : <Feather name="folder" size={17} color={colors.primaryForeground} />}
        <Text style={[styles.openLabel, { color: colors.primaryForeground }]}>Abrir</Text>
      </Pressable>
    </Card>
  );
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "data" in error) {
    const message = (error as { data?: { message?: unknown } }).data?.message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: 16, gap: 12, paddingBottom: 48 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 9 },
  card: { flexDirection: "row", alignItems: "center", gap: 12 },
  cardText: { flex: 1, gap: 4 },
  cardTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  sectionTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", marginTop: 5 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  note: { fontSize: 13, lineHeight: 19, fontFamily: "Inter_400Regular" },
  error: { fontSize: 13, lineHeight: 19, fontFamily: "Inter_500Medium" },
  openButton: {
    minWidth: 84,
    minHeight: 42,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  openLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
