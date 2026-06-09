import React, { useState } from "react";
import {
  Platform,
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
import * as Haptics from "expo-haptics";

import {
  getGetSurveyQueryKey,
  useGetSurvey,
  useSubmitSurveyResponse,
  type SurveyAnswerInput,
  type SurveyQuestion,
} from "@workspace/api-client-react";

import { AppHeader } from "@/components/AppHeader";
import { Button, Card, EmptyState, ErrorState, Loading } from "@/components/ui";
import { useColors } from "@/hooks/useColors";

export default function SurveyDetailScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id: string }>();
  const surveyId = Number(params.id);

  const { data, isLoading, isError, refetch } = useGetSurvey(surveyId);
  const submit = useSubmitSurveyResponse();
  const [answers, setAnswers] = useState<Record<number, string[]>>({});
  const [error, setError] = useState<string | null>(null);

  const setSingle = (qId: number, value: string) =>
    setAnswers((prev) => ({ ...prev, [qId]: [value] }));

  const toggleMultiple = (qId: number, value: string) =>
    setAnswers((prev) => {
      const cur = prev[qId] ?? [];
      return {
        ...prev,
        [qId]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value],
      };
    });

  const setText = (qId: number, value: string) =>
    setAnswers((prev) => ({ ...prev, [qId]: value ? [value] : [] }));

  const onSubmit = () => {
    const questions = data?.questions ?? [];
    const payload: SurveyAnswerInput[] = questions.map((q) => ({
      questionId: q.id,
      value: answers[q.id] ?? [],
    }));
    if (payload.some((a) => a.value.length === 0)) {
      setError("Responde a todas las preguntas antes de enviar.");
      return;
    }
    setError(null);
    submit.mutate(
      { id: surveyId, data: { answers: payload } },
      {
        onSuccess: () => {
          if (Platform.OS !== "web") {
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
          void queryClient.invalidateQueries({ queryKey: getGetSurveyQueryKey(surveyId) });
          router.back();
        },
        onError: () => setError("No se pudo enviar tu respuesta. Inténtalo de nuevo."),
      },
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader title="Participar" showBack />
      {isLoading ? (
        <Loading />
      ) : isError || !data ? (
        <ErrorState onRetry={refetch} />
      ) : data.hasVoted ? (
        <EmptyState
          icon="check-circle"
          title="Ya has participado"
          message="Gracias, tu respuesta ya ha sido registrada."
        />
      ) : data.status !== "open" ? (
        <EmptyState
          icon="lock"
          title="No disponible"
          message="Esta encuesta no está abierta a participación."
        />
      ) : (
        <KeyboardAwareScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          bottomOffset={20}
        >
          <Text style={[styles.surveyTitle, { color: colors.foreground }]}>{data.title}</Text>
          {data.description ? (
            <Text style={[styles.surveyDesc, { color: colors.mutedForeground }]}>
              {data.description}
            </Text>
          ) : null}

          {(data.questions ?? []).map((q, idx) => (
            <Card key={q.id} style={styles.qCard}>
              <Text style={[styles.qText, { color: colors.foreground }]}>
                {idx + 1}. {q.text}
              </Text>
              <QuestionInput
                question={q}
                colors={colors}
                selected={answers[q.id] ?? []}
                onSingle={(v) => setSingle(q.id, v)}
                onToggle={(v) => toggleMultiple(q.id, v)}
                onText={(v) => setText(q.id, v)}
              />
            </Card>
          ))}

          {error ? (
            <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text>
          ) : null}

          <Button
            label="Enviar respuesta"
            icon="send"
            onPress={onSubmit}
            loading={submit.isPending}
            style={{ marginTop: 8 }}
          />
        </KeyboardAwareScrollView>
      )}
    </View>
  );
}

function QuestionInput({
  question,
  colors,
  selected,
  onSingle,
  onToggle,
  onText,
}: {
  question: SurveyQuestion;
  colors: ReturnType<typeof useColors>;
  selected: string[];
  onSingle: (v: string) => void;
  onToggle: (v: string) => void;
  onText: (v: string) => void;
}) {
  if (question.type === "text") {
    return (
      <TextInput
        value={selected[0] ?? ""}
        onChangeText={onText}
        placeholder="Tu respuesta"
        placeholderTextColor={colors.mutedForeground}
        multiline
        style={[
          styles.textInput,
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

  const options =
    question.options && question.options.length > 0
      ? question.options
      : question.type === "scale"
        ? ["1", "2", "3", "4", "5"]
        : [];
  const multiple = question.type === "multiple";

  return (
    <View style={styles.options}>
      {options.map((opt) => {
        const active = selected.includes(opt);
        return (
          <Pressable
            key={opt}
            onPress={() => (multiple ? onToggle(opt) : onSingle(opt))}
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
              name={
                multiple
                  ? active
                    ? "check-square"
                    : "square"
                  : active
                    ? "check-circle"
                    : "circle"
              }
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

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 14, paddingBottom: 40 },
  surveyTitle: { fontSize: 22, fontFamily: "Inter_700Bold" },
  surveyDesc: { fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 21 },
  qCard: { gap: 12 },
  qText: { fontSize: 16, fontFamily: "Inter_600SemiBold", lineHeight: 22 },
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
    minHeight: 90,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    textAlignVertical: "top",
  },
  error: { fontSize: 14, fontFamily: "Inter_400Regular" },
});
