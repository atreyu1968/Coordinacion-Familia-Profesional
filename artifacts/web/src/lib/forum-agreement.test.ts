import { describe, expect, it } from "vitest";
import type { AgreementRecord, AgreementWorkspace, AgreementPosition } from "@workspace/api-client-react";
import {
  allowedStatuses, buildAgreementPayload, buildPositionPayload, draftFrom, agreementTemplateText, PUBLISHABLE_STATUSES,
  startNewVersion, summarizePositions, validateDocumentUrl, validateSourceUrl,
} from "./forum-agreement";
import { mobilePositionPayload } from "../../../movil/lib/agreement";

const rec = (o: Partial<AgreementRecord> = {}): AgreementRecord => ({
  id: 1, threadId: 5, moduleId: 2, revision: 3, version: 1, status: "propuesta", summary: "s", proposedText: "Texto",
  observations: "", closureReason: "", sources: [], sourcePostIds: [], editorIds: [7], documentUrl: null,
  fingerprint: "old", curriculumVersion: "2024", publishedPageId: null, updatedAt: "2025-01-01T00:00:00Z", ...o,
});
const pos = (o: Partial<AgreementPosition>): AgreementPosition => ({
  id: 1, version: 1, userId: 10, userName: "Ana", centerId: 1, centerName: "IES A", position: "a_favor", reason: "", updatedAt: "2025-01-01", ...o,
});
const ws = (o: Partial<AgreementWorkspace> = {}): AgreementWorkspace => ({
  moduleId: 2, threadId: 5, canEdit: true, canPublish: false, canDelegate: false, canPosition: true, fingerprint: "new",
  curriculumCurrent: true, nextcloudConfigured: true, agreement: rec(), revisions: [], positions: [], positionHistory: [],
  participants: [{ id: 10, name: "Ana", isModerator: false, centers: [{ id: 1, name: "IES A" }] }, { id: 7, name: "Mod", isModerator: true, centers: [] }],
  participation: { teachers: 1, centers: 1, eligible: 4, limited: true, warning: "" }, ...o,
});

describe("status rules", () => {
  it("restricts transitions", () => {
    expect(allowedStatuses(rec({ status: "consulta" }), false)).not.toContain("abierto");
    expect(allowedStatuses(rec({ status: "consensuado" }), false)).toEqual(["consensuado", "archivado"]);
    expect(allowedStatuses(rec(), true)).toEqual(["abierto"]);
  });
  it("allows observations on frozen version", () => {
    const w = ws({ agreement: rec({ status: "consulta" }) });
    expect(buildAgreementPayload(w, { ...draftFrom(w.agreement), observations: "nota" }).ok).toBe(true);
  });
  it("closed versions are immutable except archive", () => {
    const w = ws({ agreement: rec({ status: "consensuado" }) });
    expect(buildAgreementPayload(w, { ...draftFrom(w.agreement), observations: "x" }).ok).toBe(false);
    expect(buildAgreementPayload(w, { ...draftFrom(w.agreement), status: "archivado", observations: "x" }).ok).toBe(true);
  });
  it("forbids editing frozen text without new version", () => {
    const w = ws({ agreement: rec({ status: "consensuado" }) });
    const r = buildAgreementPayload(w, { ...draftFrom(w.agreement), proposedText: "otro" });
    expect(r.ok).toBe(false);
    const nv = buildAgreementPayload(w, { ...startNewVersion(draftFrom(w.agreement)), proposedText: "otro", reviewCurrent: true });
    expect(nv.ok && nv.payload.newVersion && nv.payload.status === "abierto" && nv.payload.fingerprint === "new").toBe(true);
  });
  it("closing consulta needs reason and a vote for consensuado", () => {
    const w = ws({ agreement: rec({ status: "consulta" }) });
    expect(buildAgreementPayload(w, { ...draftFrom(w.agreement), status: "consensuado", closureReason: "Motivo suficiente aquí" }).ok).toBe(false);
    const w2 = ws({ agreement: rec({ status: "consulta" }), positions: [pos({})] });
    expect(buildAgreementPayload(w2, { ...draftFrom(w2.agreement), status: "consensuado", closureReason: "corto" }).ok).toBe(false);
    expect(buildAgreementPayload(w2, { ...draftFrom(w2.agreement), status: "consensuado", closureReason: "Motivo suficiente aquí" }).ok).toBe(true);
  });
  it("archive keeps content and non-delegators keep editors", () => {
    const w = ws();
    const r = buildAgreementPayload(w, { ...draftFrom(w.agreement), status: "archivado", summary: "cambiado", editorIds: [] });
    expect(r.ok && r.payload.summary === "s" && r.payload.editorIds[0] === 7).toBe(true);
  });
});

describe("urls", () => {
  it("validates sources and documents", () => {
    expect(validateSourceUrl("/documentacion?page=3")).toBeNull();
    expect(validateSourceUrl("/admin")).not.toBeNull();
    expect(validateSourceUrl("https://nube.es/s/abc")).not.toBeNull();
    expect(validateSourceUrl("https://x.es/a?token=1")).not.toBeNull();
    expect(validateDocumentUrl("https://nube.es/index.php/f/123")).toBeNull();
    expect(validateDocumentUrl("https://nube.es/f/123?x=1")).not.toBeNull();
    expect(validateDocumentUrl("http://nube.es/f/1")).not.toBeNull();
  });
});

describe("positions", () => {
  it("requires own center and reason for objections", () => {
    const w = ws({ agreement: rec({ status: "consulta" }) });
    expect(buildPositionPayload(w, 10, { position: "en_contra", reason: "", centerId: 1 }).ok).toBe(false);
    expect(buildPositionPayload(w, 10, { position: "a_favor", reason: "", centerId: 2 }).ok).toBe(false);
    const ok = buildPositionPayload(w, 10, { position: "con_reservas", reason: "Cambiaría el punto 2", centerId: 1 });
    expect(ok.ok && ok.payload.version === 1 && ok.payload.revision === 3).toBe(true);
    expect(mobilePositionPayload(w, 10, { position: "en_contra", reason: "", centerId: 1 }).ok).toBe(false);
  });
  it("summarizes with objections first", () => {
    const s = summarizePositions([pos({}), pos({ id: 2, position: "con_reservas", centerId: 2 }), pos({ id: 3, position: "en_contra" })]);
    expect(s.counts).toEqual({ a_favor: 1, con_reservas: 1, en_contra: 1 });
    expect(s.centers).toBe(2);
    expect(s.objections.map((p) => p.id)).toEqual([3, 2]);
  });
  it("is consultation-only", () => {
    expect(buildPositionPayload(ws(), 10, { position: "a_favor", reason: "", centerId: 1 }).ok).toBe(false);
  });
  it("template keeps user text verbatim with legend", () => {
    const t = agreementTemplateText(ws({ agreement: rec({ proposedText: "# a*b* = `x` <y>" }) }), "Mod", "Hilo");
    expect(t).toContain("# a*b* = `x` <y>");
    expect(t).toContain("No constituye aprobación oficial");
  });
  it("never publishes normative review", () => {
    expect(PUBLISHABLE_STATUSES).toEqual(["consensuado", "sin_consenso"]);
  });
});
