import { Router, type IRouter } from "express";
import {
  GetAiStatusResponse,
  AiChatBody,
  AiChatResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { getSettings, isDeepseekConfigured } from "../lib/settings";

const router: IRouter = Router();

router.get("/ai/status", requireAuth, async (_req, res): Promise<void> => {
  const settings = await getSettings();
  res.json(
    GetAiStatusResponse.parse({ configured: isDeepseekConfigured(settings) }),
  );
});

router.post("/ai/chat", requireAuth, async (req, res): Promise<void> => {
  const parsed = AiChatBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.message });
    return;
  }

  const settings = await getSettings();
  if (!isDeepseekConfigured(settings)) {
    res.status(503).json({
      message:
        "El asistente de IA está pendiente de configuración. Un administrador debe añadir la clave de DeepSeek.",
      code: "ai_not_configured",
    });
    return;
  }

  const systemPrompt =
    parsed.data.context === "gdcan"
      ? "Eres un asistente experto en la normativa y recursos del Gobierno de Canarias (GDCAN) para la familia profesional de Administración y Gestión."
      : "Eres un asistente experto en el currículo de la familia profesional de Administración y Gestión de Formación Profesional en Canarias.";

  const messages = [
    { role: "system", content: systemPrompt },
    ...(parsed.data.history ?? []).map((m) => ({
      role: m.role,
      content: m.content,
    })),
    { role: "user", content: parsed.data.message },
  ];

  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.deepseekApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "deepseek-chat", messages }),
    });

    if (!response.ok) {
      res
        .status(503)
        .json({ message: "El asistente de IA no está disponible ahora mismo" });
      return;
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const reply = data.choices?.[0]?.message?.content ?? "";
    res.json(AiChatResponse.parse({ reply }));
  } catch {
    res
      .status(503)
      .json({ message: "El asistente de IA no está disponible ahora mismo" });
  }
});

export default router;
