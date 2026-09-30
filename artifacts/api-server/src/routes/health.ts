import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/readyz", async (req, res) => {
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      pool.query("SELECT 1"),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Database readiness query timed out")),
          2_000,
        );
        timeout.unref();
      }),
    ]);
    res.json(HealthCheckResponse.parse({ status: "ok" }));
  } catch (error) {
    req.log.warn({ err: error }, "Database readiness check failed");
    res
      .status(503)
      .json(HealthCheckResponse.parse({ status: "error" }));
  } finally {
    if (timeout) clearTimeout(timeout);
  }
});

export default router;
