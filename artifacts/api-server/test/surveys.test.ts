import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq, isNotNull, and } from "drizzle-orm";
import { db, surveyAnswersTable } from "@workspace/db";
import app from "../src/app";
import {
  createUser,
  createProvince,
  cleanup,
  authHeader,
  trackSurvey,
} from "./helpers";

afterAll(async () => {
  await cleanup();
});

// Create an open survey via the API as a superadmin and return its detail
// (including question ids) for use in response tests.
async function createOpenSurvey(opts?: {
  anonymous?: boolean;
  provinceId?: number | null;
}) {
  const admin = await createUser({ role: "superadmin" });
  const create = await request(app)
    .post("/api/surveys")
    .set(authHeader(admin.token))
    .send({
      title: "Encuesta",
      type: "survey",
      anonymous: opts?.anonymous ?? false,
      provinceId: opts?.provinceId ?? null,
      questions: [
        {
          text: "¿Color favorito?",
          type: "single",
          options: ["rojo", "azul", "verde"],
          order: 0,
        },
        {
          text: "¿Qué hobbies?",
          type: "multiple",
          options: ["leer", "correr", "cocinar"],
          order: 1,
        },
        { text: "Comentarios", type: "text", options: [], order: 2 },
      ],
    });
  expect(create.status).toBe(201);
  trackSurvey(create.body.id);

  const detail = await request(app)
    .get(`/api/surveys/${create.body.id}`)
    .set(authHeader(admin.token));
  expect(detail.status).toBe(200);
  return { admin, surveyId: create.body.id as number, detail: detail.body };
}

function questionIds(detail: {
  questions: { id: number; type: string }[];
}): { single: number; multiple: number; text: number } {
  const single = detail.questions.find((q) => q.type === "single")!.id;
  const multiple = detail.questions.find((q) => q.type === "multiple")!.id;
  const text = detail.questions.find((q) => q.type === "text")!.id;
  return { single, multiple, text };
}

describe("survey creation", () => {
  it("rejects a survey with no questions", async () => {
    const admin = await createUser({ role: "superadmin" });
    const res = await request(app)
      .post("/api/surveys")
      .set(authHeader(admin.token))
      .send({ title: "Vacía", type: "survey", anonymous: false, questions: [] });
    expect(res.status).toBe(400);
  });

  it("forbids non-managers from creating surveys", async () => {
    const teacher = await createUser({ role: "teacher" });
    const res = await request(app)
      .post("/api/surveys")
      .set(authHeader(teacher.token))
      .send({
        title: "No",
        type: "survey",
        anonymous: false,
        questions: [
          { text: "q", type: "single", options: ["a", "b"], order: 0 },
        ],
      });
    expect(res.status).toBe(403);
  });
});

describe("survey response validation", () => {
  it("accepts a valid full submission", async () => {
    const { surveyId, detail } = await createOpenSurvey();
    const q = questionIds(detail);
    const voter = await createUser({ role: "teacher" });

    const res = await request(app)
      .post(`/api/surveys/${surveyId}/responses`)
      .set(authHeader(voter.token))
      .send({
        answers: [
          { questionId: q.single, value: ["azul"] },
          { questionId: q.multiple, value: ["leer", "correr"] },
          { questionId: q.text, value: ["¡Bien hecho!"] },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("rejects when not every question is answered", async () => {
    const { surveyId, detail } = await createOpenSurvey();
    const q = questionIds(detail);
    const voter = await createUser({ role: "teacher" });

    const res = await request(app)
      .post(`/api/surveys/${surveyId}/responses`)
      .set(authHeader(voter.token))
      .send({ answers: [{ questionId: q.single, value: ["azul"] }] });
    expect(res.status).toBe(400);
  });

  it("rejects duplicate answers for the same question", async () => {
    const { surveyId, detail } = await createOpenSurvey();
    const q = questionIds(detail);
    const voter = await createUser({ role: "teacher" });

    const res = await request(app)
      .post(`/api/surveys/${surveyId}/responses`)
      .set(authHeader(voter.token))
      .send({
        answers: [
          { questionId: q.single, value: ["azul"] },
          { questionId: q.single, value: ["rojo"] },
          { questionId: q.text, value: ["x"] },
        ],
      });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid option for a single-choice question", async () => {
    const { surveyId, detail } = await createOpenSurvey();
    const q = questionIds(detail);
    const voter = await createUser({ role: "teacher" });

    const res = await request(app)
      .post(`/api/surveys/${surveyId}/responses`)
      .set(authHeader(voter.token))
      .send({
        answers: [
          { questionId: q.single, value: ["morado"] },
          { questionId: q.multiple, value: ["leer"] },
          { questionId: q.text, value: ["x"] },
        ],
      });
    expect(res.status).toBe(400);
  });

  it("rejects a multiple-choice answer with duplicate selections", async () => {
    const { surveyId, detail } = await createOpenSurvey();
    const q = questionIds(detail);
    const voter = await createUser({ role: "teacher" });

    const res = await request(app)
      .post(`/api/surveys/${surveyId}/responses`)
      .set(authHeader(voter.token))
      .send({
        answers: [
          { questionId: q.single, value: ["azul"] },
          { questionId: q.multiple, value: ["leer", "leer"] },
          { questionId: q.text, value: ["x"] },
        ],
      });
    expect(res.status).toBe(400);
  });

  it("rejects an empty text answer", async () => {
    const { surveyId, detail } = await createOpenSurvey();
    const q = questionIds(detail);
    const voter = await createUser({ role: "teacher" });

    const res = await request(app)
      .post(`/api/surveys/${surveyId}/responses`)
      .set(authHeader(voter.token))
      .send({
        answers: [
          { questionId: q.single, value: ["azul"] },
          { questionId: q.multiple, value: ["leer"] },
          { questionId: q.text, value: ["   "] },
        ],
      });
    expect(res.status).toBe(400);
  });

  it("prevents a user from voting twice", async () => {
    const { surveyId, detail } = await createOpenSurvey();
    const q = questionIds(detail);
    const voter = await createUser({ role: "teacher" });
    const body = {
      answers: [
        { questionId: q.single, value: ["azul"] },
        { questionId: q.multiple, value: ["leer"] },
        { questionId: q.text, value: ["ok"] },
      ],
    };

    const first = await request(app)
      .post(`/api/surveys/${surveyId}/responses`)
      .set(authHeader(voter.token))
      .send(body);
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`/api/surveys/${surveyId}/responses`)
      .set(authHeader(voter.token))
      .send(body);
    expect(second.status).toBe(409);
  });
});

describe("survey anonymity", () => {
  it("stores answers with NULL responseId and NULL createdAt when anonymous", async () => {
    const { surveyId, detail } = await createOpenSurvey({ anonymous: true });
    const q = questionIds(detail);
    const voter = await createUser({ role: "teacher" });

    await request(app)
      .post(`/api/surveys/${surveyId}/responses`)
      .set(authHeader(voter.token))
      .send({
        answers: [
          { questionId: q.single, value: ["azul"] },
          { questionId: q.multiple, value: ["leer"] },
          { questionId: q.text, value: ["secreto"] },
        ],
      });

    const linked = await db
      .select()
      .from(surveyAnswersTable)
      .where(
        and(
          eq(surveyAnswersTable.surveyId, surveyId),
          isNotNull(surveyAnswersTable.responseId),
        ),
      );
    expect(linked).toHaveLength(0);

    const answers = await db
      .select()
      .from(surveyAnswersTable)
      .where(eq(surveyAnswersTable.surveyId, surveyId));
    expect(answers.length).toBeGreaterThan(0);
    expect(answers.every((a) => a.responseId === null)).toBe(true);
    expect(answers.every((a) => a.createdAt === null)).toBe(true);
  });

  it("keeps responseId and createdAt for non-anonymous surveys", async () => {
    const { surveyId, detail } = await createOpenSurvey({ anonymous: false });
    const q = questionIds(detail);
    const voter = await createUser({ role: "teacher" });

    await request(app)
      .post(`/api/surveys/${surveyId}/responses`)
      .set(authHeader(voter.token))
      .send({
        answers: [
          { questionId: q.single, value: ["rojo"] },
          { questionId: q.multiple, value: ["correr"] },
          { questionId: q.text, value: ["auditable"] },
        ],
      });

    const answers = await db
      .select()
      .from(surveyAnswersTable)
      .where(eq(surveyAnswersTable.surveyId, surveyId));
    expect(answers.length).toBeGreaterThan(0);
    expect(answers.every((a) => a.responseId !== null)).toBe(true);
    expect(answers.every((a) => a.createdAt !== null)).toBe(true);
  });
});

describe("survey access control", () => {
  it("hides province-scoped surveys from users in other provinces", async () => {
    const provinceA = await createProvince("A");
    const provinceB = await createProvince("B");
    const { surveyId } = await createOpenSurvey({ provinceId: provinceA });

    const outsider = await createUser({
      role: "coordinator",
      provinceId: provinceB,
    });
    const res = await request(app)
      .get(`/api/surveys/${surveyId}`)
      .set(authHeader(outsider.token));
    expect(res.status).toBe(403);
  });
});

describe("survey results aggregation", () => {
  it("aggregates option counts and lists text answers", async () => {
    const { surveyId, detail, admin } = await createOpenSurvey();
    const q = questionIds(detail);

    const v1 = await createUser({ role: "teacher" });
    const v2 = await createUser({ role: "teacher" });
    await request(app)
      .post(`/api/surveys/${surveyId}/responses`)
      .set(authHeader(v1.token))
      .send({
        answers: [
          { questionId: q.single, value: ["azul"] },
          { questionId: q.multiple, value: ["leer", "correr"] },
          { questionId: q.text, value: ["comentario uno"] },
        ],
      });
    await request(app)
      .post(`/api/surveys/${surveyId}/responses`)
      .set(authHeader(v2.token))
      .send({
        answers: [
          { questionId: q.single, value: ["azul"] },
          { questionId: q.multiple, value: ["leer"] },
          { questionId: q.text, value: ["comentario dos"] },
        ],
      });

    const results = await request(app)
      .get(`/api/surveys/${surveyId}/results`)
      .set(authHeader(admin.token));
    expect(results.status).toBe(200);
    expect(results.body.totalResponses).toBe(2);

    const singleResult = results.body.questions.find(
      (r: { questionId: number }) => r.questionId === q.single,
    );
    const azul = singleResult.options.find(
      (o: { label: string }) => o.label === "azul",
    );
    expect(azul.count).toBe(2);

    const textResult = results.body.questions.find(
      (r: { questionId: number }) => r.questionId === q.text,
    );
    expect(textResult.textAnswers).toHaveLength(2);
    expect(textResult.textAnswers).toContain("comentario uno");
  });
});
