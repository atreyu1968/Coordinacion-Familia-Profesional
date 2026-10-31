import { Router, type IRouter } from "express";
import { z } from "zod";
import { DiscoverTrainingOfferAiBody, AnalyzeTrainingOfferAiBody, ApplyTrainingOfferAiBody } from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middlewares/auth";
import { analyzeTrainingOffer, discoverTrainingOffer, OfferSyncError } from "../lib/trainingOfferAi";
import { applyTrainingOffer } from "../lib/trainingOfferImport";
import { officialOfferUrl } from "../lib/trainingOfferOfficial";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const discover = DiscoverTrainingOfferAiBody.strict();
const analyze = AnalyzeTrainingOfferAiBody.strict();
const apply = ApplyTrainingOfferAiBody.strict();
const busy = new Set<number>();

function endpoint<T>(operation: string, schema: z.ZodType<T>, run: (owner: number, data: T) => Promise<unknown>) {
  router.post(`/centers/training-offer/ai/${operation}`, requireAuth, requireRole("superadmin"), async (req, res) => {
    const input = schema.safeParse(req.body);
    if (!input.success) { res.status(400).json({ message: "Los datos de la consulta no son válidos." }); return; }
    const owner = req.user!.id;
    if (busy.has(owner)) { res.status(409).json({ message: "Ya tienes una consulta de oferta en curso. Espera a que termine." }); return; }
    busy.add(owner);
    try { res.json(await run(owner, input.data)); }
    catch (error) {
      if (error instanceof OfferSyncError) { res.status(error.status).json({ message: error.message }); return; }
      logger.warn({ operation, errorType: error instanceof Error ? error.name : "unknown" }, "Training offer AI operation failed");
      res.status(502).json({ message: "No se pudo completar la consulta oficial. No se ha modificado la oferta." });
    } finally { busy.delete(owner); }
  });
}
endpoint("discover", discover, (owner, data) => {
  try { data.sourceUrls?.forEach(officialOfferUrl); }
  catch { throw new OfferSyncError("Solo se admiten páginas y PDF oficiales de Educación del Gobierno de Canarias."); }
  return discoverTrainingOffer(owner, data.centerId, data.sourceUrls);
});
endpoint("analyze", analyze, (owner, data) => analyzeTrainingOffer(owner, data.contextToken, data.sourceUrl));
endpoint("apply", apply, (owner, data) => applyTrainingOffer(owner, data.contextToken, data.resultTokens));
export default router;
