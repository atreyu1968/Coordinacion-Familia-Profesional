import { Router, type IRouter } from "express";
import {
  GetAiStatusResponse,
  AiChatBody,
  AiChatResponse,
} from "@workspace/api-zod";
import { and, isNull, desc, inArray } from "drizzle-orm";
import { db, gdcanResourcesTable } from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/auth";
import { getSettings, isDeepseekConfigured } from "../lib/settings";

const router: IRouter = Router();

// Build a grounding block from the GDCAN knowledge base (manuals + FAQs) so the
// assistant answers from the institution's own documentation rather than only
// from generic model knowledge. Links are excluded (no answerable content).
async function buildGdcanGrounding(): Promise<string> {
  const rows = await db
    .select({
      title: gdcanResourcesTable.title,
      type: gdcanResourcesTable.type,
      content: gdcanResourcesTable.content,
    })
    .from(gdcanResourcesTable)
    .where(
      and(
        isNull(gdcanResourcesTable.deletedAt),
        inArray(gdcanResourcesTable.type, ["manual", "faq"]),
      ),
    )
    .orderBy(desc(gdcanResourcesTable.createdAt))
    .limit(40);

  const snippets = rows
    .filter((r) => r.content && r.content.trim().length > 0)
    .map((r) => {
      const label = r.type === "faq" ? "FAQ" : "Manual";
      // Cap each snippet to keep the prompt within a reasonable size.
      const body = r.content!.slice(0, 1500);
      return `[${label}] ${r.title}\n${body}`;
    });

  return snippets.join("\n\n---\n\n");
}

router.get("/ai/status", requireAuth, requireRole("superadmin"), async (_req, res): Promise<void> => {
  const settings = await getSettings();
  res.json(
    GetAiStatusResponse.parse({ configured: isDeepseekConfigured(settings) }),
  );
});

router.post("/ai/chat", requireAuth, requireRole("superadmin"), async (req, res): Promise<void> => {
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

  let systemPrompt =
    parsed.data.context === "gdcan"
      ? "Eres un asistente experto en la normativa y recursos del Gobierno de Canarias (GDCAN) para la familia profesional de Administración y Gestión."
      : "Eres un asistente experto en el currículo de la familia profesional de Administración y Gestión de Formación Profesional en Canarias.";

  // Ground GDCAN answers in the institution's own manuals and FAQs so replies
  // reflect the uploaded documentation instead of generic model knowledge.
  if (parsed.data.context === "gdcan") {
    const grounding = await buildGdcanGrounding();
    if (grounding.length > 0) {
      systemPrompt +=
        "\n\nResponde basándote ÚNICAMENTE en la siguiente documentación GDCAN. " +
        "Si la respuesta no está en estos materiales, indícalo claramente y no inventes.\n\n" +
        "=== DOCUMENTACIÓN GDCAN ===\n" +
        grounding +
        "\n=== FIN DE LA DOCUMENTACIÓN ===";
    } else {
      systemPrompt +=
        "\n\nActualmente no hay manuales ni FAQs de GDCAN cargados en la plataforma. " +
        "Si te preguntan por contenido específico de GDCAN, indica que aún no se han subido materiales de referencia.";
    }
  }

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
