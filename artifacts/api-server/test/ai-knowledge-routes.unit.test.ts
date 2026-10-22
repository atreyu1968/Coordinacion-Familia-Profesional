import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const knowledge = vi.hoisted(() => ({
  getAiKnowledgeCoverage: vi.fn(), synchronizeAiKnowledge: vi.fn(),
}));
vi.mock("../src/lib/aiKnowledge", () => ({
  ...knowledge, getAiKnowledgeContext: vi.fn(), processOneAiKnowledgeJob: vi.fn(),
}));
vi.mock("../src/middlewares/auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!req.headers["x-test-user"]) return res.status(401).json({ message: "No autenticado" });
    req.user = { id: Number(req.headers["x-test-user"]), role: req.headers["x-test-role"] ?? "coordinator" };
    next();
  },
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ message: "Sin permisos" });
    next();
  },
}));
import aiRouter from "../src/routes/ai";

const app = express().use(express.json()).use("/api", aiRouter);
const coverage = { checkedAt: new Date().toISOString(), lastIndexedAt: null, sources: [] };
beforeEach(() => {
  vi.clearAllMocks();
  knowledge.getAiKnowledgeCoverage.mockResolvedValue(coverage);
  knowledge.synchronizeAiKnowledge.mockResolvedValue({});
});

describe("AI coverage route boundaries", () => {
  it("uses only the session owner, ignores requested users, and never starts extraction on GET", async () => {
    const result = await request(app).get("/api/ai/knowledge?userId=999").set("x-test-user", "17");
    expect(result.status).toBe(200);
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(knowledge.getAiKnowledgeCoverage).toHaveBeenCalledWith(17);
    expect(knowledge.synchronizeAiKnowledge).not.toHaveBeenCalled();
  });
  it("requires explicit processing consent and refreshes only the current user's index", async () => {
    for (const consent of [false, undefined, "true"]) {
      expect((await request(app).post("/api/ai/knowledge").set("x-test-user", "17").send({ consent })).status).toBe(400);
    }
    expect(knowledge.synchronizeAiKnowledge).not.toHaveBeenCalled();
    const result = await request(app).post("/api/ai/knowledge").set("x-test-user", "17").send({ consent: true, userId: 999 });
    expect(result.status).toBe(200);
    expect(knowledge.synchronizeAiKnowledge).toHaveBeenCalledWith(17, true);
    expect(knowledge.getAiKnowledgeCoverage).toHaveBeenCalledWith(17);
  });
  it("installs authentication and coordinator role guards on both methods", async () => {
    for (const method of ["get", "post"] as const) {
      expect((await request(app)[method]("/api/ai/knowledge")).status).toBe(401);
      expect((await request(app)[method]("/api/ai/knowledge").set("x-test-user", "17").set("x-test-role", "teacher")).status).toBe(403);
    }
    expect(knowledge.getAiKnowledgeCoverage).not.toHaveBeenCalled();
  });
  it("returns a safe failure instead of private exception details", async () => {
    knowledge.getAiKnowledgeCoverage.mockRejectedValue(new Error("private-person@example.org /private/file"));
    const result = await request(app).get("/api/ai/knowledge").set("x-test-user", "17");
    expect(result.status).toBe(503);
    expect(JSON.stringify(result.body)).not.toMatch(/private-person|private\/file/);
  });
});
