import { useRef, useState, useEffect, type FormEvent } from "react";
import { AutoLinkText } from "@/components/auto-link-text";
import {
  useGetAiStatus,
  useAiChat,
  getGetAiStatusQueryKey,
  type AiMessage,
  type AiChatInputContext,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useAuth } from "@/lib/auth";
import { AiDocumentTools, type AiDocumentSeed } from "@/components/ai-document-tools";
import {
  Sparkles,
  Send,
  Bot,
  User as UserIcon,
  BookOpen,
  Landmark,
  AlertTriangle,
} from "lucide-react";

type Ctx = AiChatInputContext;

export default function AsistenteIaPage() {
  const { user } = useAuth();
  const isSuperadmin = user?.role === "superadmin";
  const { data: status, isLoading: statusLoading } = useGetAiStatus({
    query: { enabled: isSuperadmin, queryKey: getGetAiStatusQueryKey() },
  });
  const chatMut = useAiChat();

  const [context, setContext] = useState<Ctx>("curriculum");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [documentSeed, setDocumentSeed] = useState<AiDocumentSeed | null>(null);
  const [seedSequence, setSeedSequence] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const configured = status?.configured === true;

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, chatMut.isPending]);

  const sendMessage = async (
    rawText: string,
    selectedContext: Ctx = context,
  ): Promise<string | null> => {
    const text = rawText.trim();
    if (!text || chatMut.isPending || !configured) return null;
    setError(null);

    const history = messages;
    const next: AiMessage[] = [...history, { role: "user", content: text }];
    setMessages(next);
    setInput("");

    try {
      const res = await chatMut.mutateAsync({
        data: { message: text, context: selectedContext, history },
      });
      setMessages([...next, { role: "assistant", content: res.reply }]);
      return res.reply;
    } catch {
      setError(
        "El asistente no está disponible en este momento. Inténtalo más tarde.",
      );
      setMessages(history);
      setInput(text);
      return null;
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await sendMessage(input);
  };

  const saveAnswerAsDraft = (content: string, previousPrompt?: string) => {
    const title = (previousPrompt?.trim() || "Recurso redactado con IA")
      .replace(/\s+/g, " ")
      .slice(0, 180);
    const nextSequence = seedSequence + 1;
    setSeedSequence(nextSequence);
    setDocumentSeed({ id: nextSequence, title, content });
  };

  if (!isSuperadmin) {
    return (
      <div className="max-w-xl">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Acceso restringido</AlertTitle>
          <AlertDescription>
            El Asistente IA solo está disponible para el superadministrador.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
          <Sparkles className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Asistente IA</h1>
          <p className="text-sm text-muted-foreground">
            Consultas sobre el currículo de FP y la normativa del Gobierno de
            Canarias.
          </p>
        </div>
      </div>

      {!statusLoading && !configured && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Asistente pendiente de configuración</AlertTitle>
          <AlertDescription>
            El asistente de IA aún no está activo. Un administrador debe añadir
            la clave de DeepSeek desde el Panel de Control para habilitarlo.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex gap-2">
        <Button
          type="button"
          variant={context === "curriculum" ? "default" : "outline"}
          size="sm"
          className="gap-2"
          onClick={() => setContext("curriculum")}
        >
          <BookOpen className="w-4 h-4" /> Currículo
        </Button>
        <Button
          type="button"
          variant={context === "gdcan" ? "default" : "outline"}
          size="sm"
          className="gap-2"
          onClick={() => setContext("gdcan")}
        >
          <Landmark className="w-4 h-4" /> Normativa GDCAN
        </Button>
      </div>

      <Card className="flex flex-col h-[60vh]">
        <CardContent className="flex flex-col flex-1 p-0 overflow-hidden">
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground gap-2">
                <Bot className="w-10 h-10" />
                <p className="font-medium">¿En qué puedo ayudarte?</p>
                <p className="text-sm max-w-sm">
                  Pregunta sobre resultados de aprendizaje, criterios de
                  evaluación, módulos o normativa de la familia de Administración
                  y Gestión.
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
                    <AutoLinkText text={m.content} />
                    {m.role === "assistant" && (
                      <div className="mt-3 border-t border-border/70 pt-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            saveAnswerAsDraft(
                              m.content,
                              messages[i - 1]?.role === "user"
                                ? messages[i - 1].content
                                : undefined,
                            )
                          }
                        >
                          Crear recurso con esta respuesta
                        </Button>
                      </div>
                    )}
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
                configured
                  ? "Escribe tu consulta..."
                  : "Asistente no disponible"
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

      <AiDocumentTools
        seed={documentSeed}
        onSeedConsumed={() => setDocumentSeed(null)}
        askAssistant={sendMessage}
      />
    </div>
  );
}
