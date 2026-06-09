import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import * as DocumentPicker from "expo-document-picker";

import {
  getGetDocumentFormQueryKey,
  useGetDocumentForm,
  useRequestUploadUrl,
  useSubmitDocumentForm,
  type DocumentFormField,
  type SubmitDocumentFormValueInput,
} from "@workspace/api-client-react";

import { AppHeader } from "@/components/AppHeader";
import { Button, Card, EmptyState, ErrorState, Loading } from "@/components/ui";
import { useColors } from "@/hooks/useColors";

interface FileValue {
  objectPath: string;
  fileName: string;
  fileSize: number;
  contentType: string;
}

export default function FormDetailScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id: string }>();
  const formId = Number(params.id);

  const { data, isLoading, isError, refetch } = useGetDocumentForm(formId);
  const requestUpload = useRequestUploadUrl();
  const submit = useSubmitDocumentForm();

  const submission = data?.mySubmission;

  const initialTexts = useMemo(() => {
    const map: Record<number, string> = {};
    submission?.values.forEach((v) => {
      if (v.value != null) map[v.fieldId] = v.value;
    });
    return map;
  }, [submission]);

  const initialFiles = useMemo(() => {
    const map: Record<number, FileValue> = {};
    submission?.values.forEach((v) => {
      if (v.objectPath) {
        map[v.fieldId] = {
          objectPath: v.objectPath,
          fileName: v.fileName ?? "documento",
          fileSize: v.fileSize ?? 0,
          contentType: v.contentType ?? "application/octet-stream",
        };
      }
    });
    return map;
  }, [submission]);

  const [texts, setTexts] = useState<Record<number, string>>(initialTexts);
  const [files, setFiles] = useState<Record<number, FileValue>>(initialFiles);
  const [uploadingField, setUploadingField] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setText = (fieldId: number, value: string) =>
    setTexts((prev) => ({ ...prev, [fieldId]: value }));

  const pickFile = async (fieldId: number) => {
    setError(null);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const contentType = asset.mimeType ?? "application/octet-stream";
      const size = asset.size ?? 0;

      setUploadingField(fieldId);
      const { uploadURL, objectPath } = await requestUpload.mutateAsync({
        data: { name: asset.name, size, contentType },
      });
      const blob = await (await fetch(asset.uri)).blob();
      const putRes = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: blob,
      });
      if (!putRes.ok) throw new Error("upload failed");

      setFiles((prev) => ({
        ...prev,
        [fieldId]: { objectPath, fileName: asset.name, fileSize: size, contentType },
      }));
    } catch {
      setError("No se pudo subir el documento. Inténtalo de nuevo.");
    } finally {
      setUploadingField(null);
    }
  };

  const onSubmit = () => {
    const fields = data?.fields ?? [];
    const values: SubmitDocumentFormValueInput[] = [];

    for (const field of fields) {
      if (field.type === "file") {
        const file = files[field.id];
        if (field.required && !file) {
          setError("Adjunta todos los documentos obligatorios antes de enviar.");
          return;
        }
        if (file) {
          values.push({
            fieldId: field.id,
            objectPath: file.objectPath,
            fileName: file.fileName,
            fileSize: file.fileSize,
            contentType: file.contentType,
          });
        }
      } else {
        const value = (texts[field.id] ?? "").trim();
        if (field.required && !value) {
          setError("Completa todos los campos obligatorios antes de enviar.");
          return;
        }
        if (value) values.push({ fieldId: field.id, value });
      }
    }

    setError(null);
    submit.mutate(
      { id: formId, data: { values } },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: getGetDocumentFormQueryKey(formId) });
          router.back();
        },
        onError: (err) => {
          const status = (err as { status?: number } | null)?.status;
          if (status === 409) {
            setError("Este formulario ya no está abierto a entregas.");
          } else {
            setError("No se pudo enviar tu entrega. Inténtalo de nuevo.");
          }
        },
      },
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader title="Entregar" showBack />
      {isLoading ? (
        <Loading />
      ) : isError || !data ? (
        <ErrorState onRetry={refetch} />
      ) : data.status !== "open" && !submission ? (
        <EmptyState
          icon="lock"
          title="No disponible"
          message="Este formulario no está abierto a entregas."
        />
      ) : (
        <KeyboardAwareScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          bottomOffset={20}
        >
          <Text style={[styles.formTitle, { color: colors.foreground }]}>{data.title}</Text>
          {data.description ? (
            <Text style={[styles.formDesc, { color: colors.mutedForeground }]}>
              {data.description}
            </Text>
          ) : null}
          {submission ? (
            <View style={[styles.notice, { backgroundColor: colors.accent }]}>
              <Feather name="check-circle" size={16} color={colors.accentForeground} />
              <Text style={[styles.noticeText, { color: colors.accentForeground }]}>
                Ya has realizado una entrega. Puedes actualizarla.
              </Text>
            </View>
          ) : null}

          {(data.fields ?? []).map((field, idx) => (
            <Card key={field.id} style={styles.fieldCard}>
              <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
                {idx + 1}. {field.label}
                {field.required ? <Text style={{ color: colors.destructive }}> *</Text> : null}
              </Text>
              <FieldInput
                field={field}
                colors={colors}
                textValue={texts[field.id] ?? ""}
                onText={(v) => setText(field.id, v)}
                file={files[field.id]}
                uploading={uploadingField === field.id}
                onPickFile={() => void pickFile(field.id)}
              />
            </Card>
          ))}

          {error ? (
            <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text>
          ) : null}

          <Button
            label={submission ? "Actualizar entrega" : "Enviar entrega"}
            icon="upload"
            onPress={onSubmit}
            loading={submit.isPending}
            disabled={uploadingField !== null}
            style={{ marginTop: 8 }}
          />
        </KeyboardAwareScrollView>
      )}
    </View>
  );
}

function FieldInput({
  field,
  colors,
  textValue,
  onText,
  file,
  uploading,
  onPickFile,
}: {
  field: DocumentFormField;
  colors: ReturnType<typeof useColors>;
  textValue: string;
  onText: (v: string) => void;
  file?: FileValue;
  uploading: boolean;
  onPickFile: () => void;
}) {
  if (field.type === "text" || field.type === "textarea") {
    const multiline = field.type === "textarea";
    return (
      <TextInput
        value={textValue}
        onChangeText={onText}
        placeholder="Tu respuesta"
        placeholderTextColor={colors.mutedForeground}
        multiline={multiline}
        style={[
          styles.textInput,
          multiline && styles.textArea,
          {
            backgroundColor: colors.background,
            borderColor: colors.border,
            color: colors.foreground,
            borderRadius: colors.radius,
          },
        ]}
      />
    );
  }

  if (field.type === "select") {
    const options = field.options ?? [];
    return (
      <View style={styles.options}>
        {options.map((opt) => {
          const active = textValue === opt;
          return (
            <Pressable
              key={opt}
              onPress={() => onText(opt)}
              style={({ pressed }) => [
                styles.option,
                {
                  borderColor: active ? colors.primary : colors.border,
                  backgroundColor: active ? colors.accent : colors.background,
                  borderRadius: colors.radius,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Feather
                name={active ? "check-circle" : "circle"}
                size={20}
                color={active ? colors.primary : colors.mutedForeground}
              />
              <Text
                style={[
                  styles.optionText,
                  { color: active ? colors.foreground : colors.mutedForeground },
                ]}
              >
                {opt}
              </Text>
            </Pressable>
          );
        })}
      </View>
    );
  }

  // file
  return (
    <View style={styles.fileWrap}>
      <Pressable
        onPress={onPickFile}
        disabled={uploading}
        style={({ pressed }) => [
          styles.fileBtn,
          {
            borderColor: colors.border,
            backgroundColor: colors.background,
            borderRadius: colors.radius,
            opacity: uploading ? 0.6 : pressed ? 0.7 : 1,
          },
        ]}
      >
        {uploading ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <Feather name="paperclip" size={18} color={colors.primary} />
        )}
        <Text style={[styles.fileBtnText, { color: colors.primary }]}>
          {uploading ? "Subiendo…" : "Seleccionar documento"}
        </Text>
      </Pressable>
      {file ? (
        <View style={styles.fileRow}>
          <Feather name="file" size={16} color={colors.mutedForeground} />
          <Text
            style={[styles.fileName, { color: colors.foreground }]}
            numberOfLines={1}
          >
            {file.fileName}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 14, paddingBottom: 40 },
  formTitle: { fontSize: 22, fontFamily: "Inter_700Bold" },
  formDesc: { fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 21 },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 10,
  },
  noticeText: { fontSize: 13, fontFamily: "Inter_500Medium", flex: 1 },
  fieldCard: { gap: 12 },
  fieldLabel: { fontSize: 16, fontFamily: "Inter_600SemiBold", lineHeight: 22 },
  options: { gap: 8 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  optionText: { fontSize: 15, fontFamily: "Inter_500Medium", flex: 1 },
  textInput: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  textArea: {
    minHeight: 90,
    textAlignVertical: "top",
  },
  fileWrap: { gap: 10 },
  fileBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  fileBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  fileRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  fileName: { fontSize: 14, fontFamily: "Inter_500Medium", flex: 1 },
  error: { fontSize: 14, fontFamily: "Inter_400Regular" },
});
