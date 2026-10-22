import { describe, expect, it } from "vitest";
import { addCoverageOmission, newCoverageObservations, summarizeKnowledgeCoverage } from "../src/lib/aiKnowledgeCoverage";

const entry = (sourceKey: string, status: string, version = "v1", warning: string | null = null) => ({
  sourceKey, status, version, warning,
});
const candidate = (key: string, version = "v1") => ({ key, version });

describe("private AI coverage summaries", () => {
  it("counts each file state separately across all three sources", () => {
    const result = summarizeKnowledgeCoverage([
      candidate("wiki:1"), candidate("wiki-file:2"), candidate("resource:3"), candidate("chat:4"),
      candidate("mail:1"), candidate("mail-attachment:1"), candidate("nextcloud:1:abc"),
    ], [
      entry("wiki:1", "ready"), entry("wiki-file:2", "processing"), entry("resource:3", "unsupported"),
      entry("chat:4", "error"), entry("mail:1", "ready"), entry("mail-attachment:1", "pending"),
      entry("nextcloud:1:abc", "ready"),
    ], newCoverageObservations());
    expect(result[0]).toMatchObject({ id: "platform", indexed: 1, pending: 1, omitted: 1, errors: 1, status: "partial" });
    expect(result[1]).toMatchObject({ id: "gmail", indexed: 1, pending: 1, omitted: 0, errors: 0, status: "pending" });
    expect(result[2]).toMatchObject({ id: "nextcloud", indexed: 1, pending: 0, status: "ready" });
  });

  it("does not count stale versions or entries absent from the current authorized scan", () => {
    const result = summarizeKnowledgeCoverage([candidate("wiki:1", "v2"), candidate("wiki:3")], [
      entry("wiki:1", "ready"), entry("wiki:2", "ready"), entry("mail:private-other-owner", "ready"),
    ], newCoverageObservations());
    expect(result[0]).toMatchObject({ indexed: 0, pending: 2 });
    expect(result[1]).toMatchObject({ indexed: 0, pending: 0 });
    expect(JSON.stringify(result)).not.toContain("private-other-owner");
  });

  it("counts unsupported Nextcloud files even before they have an index row", () => {
    const observations = newCoverageObservations();
    addCoverageOmission(observations, "platform", "Límite de materiales alcanzado.");
    addCoverageOmission(observations, "platform", "Límite de materiales alcanzado.");
    const result = summarizeKnowledgeCoverage([
      { ...candidate("nextcloud:1:abc"), omission: "Formato no compatible." },
      { ...candidate("nextcloud:1:def"), omission: "Formato no compatible." },
    ], [], observations);
    expect(result[0].omissions).toEqual([{ reason: "Límite de materiales alcanzado.", count: 2 }]);
    expect(result[2]).toMatchObject({ omitted: 2, pending: 0, omissions: [{ reason: "Formato no compatible.", count: 2 }] });
  });

  it("preserves import/connection failures without inventing an unimported Gmail total", () => {
    const observations = newCoverageObservations();
    observations.gmail = { status: "importing", notes: ["Total sin importar desconocido."], omissions: [], pending: 2, errors: 1 };
    observations.nextcloud = { status: "disconnected", notes: ["Conexión administrativa no configurada."], omissions: [] };
    const result = summarizeKnowledgeCoverage([candidate("mail:1")], [entry("mail:1", "ready")], observations);
    expect(result[1]).toMatchObject({ status: "importing", indexed: 1, pending: 2, errors: 1 });
    expect(result[2]).toMatchObject({ status: "disconnected", indexed: 0, omitted: 0, errors: 0 });
  });

  it("never exposes raw file errors, source identifiers or truncation contents", () => {
    const result = summarizeKnowledgeCoverage([candidate("mail-attachment:secret"), candidate("wiki:secret")], [
      entry("mail-attachment:secret", "error", "v1", "Private path /secret/attachment.pdf from person@example.org"),
      entry("wiki:secret", "ready", "v1", "Private truncated body"),
    ], newCoverageObservations());
    expect(JSON.stringify(result)).not.toMatch(/secret|person@example|Private/);
    expect(result[0].notes.join(" ")).toContain("recortados");
    expect(result[1].notes.join(" ")).toContain("reintentarlo");
  });

  it("reports folder restrictions as incomplete coverage, not a made-up file count", () => {
    const observations = newCoverageObservations();
    observations.nextcloud.notes.push("Carpeta omitida por permisos avanzados; total de archivos desconocido.");
    expect(summarizeKnowledgeCoverage([], [], observations)[2]).toMatchObject({
      status: "partial", indexed: 0, omitted: 0, pending: 0,
    });
  });
});
