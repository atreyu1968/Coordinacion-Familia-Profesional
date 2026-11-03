import { createHash } from "node:crypto";
import type { Module } from "./schema/modules";
import type { ModuleLearningOutcome, ModuleEvaluationCriterion } from "./schema/learningOutcomes";
import type { ProgrammingSection } from "./schema/forumCollaboration";

// Shared by the interactive initializer and deployment: stable keys must match.
export function planForumThreads(
  sections: ProgrammingSection[],
  outcomes: Pick<ModuleLearningOutcome, "id" | "code" | "description">[],
  criteria: Pick<ModuleEvaluationCriterion, "id" | "outcomeId" | "code" | "description">[],
) {
  return [
    ...sections.filter(s => s.enabled).sort((a, b) => a.order - b.order || a.key.localeCompare(b.key)).map(s => ({
      key: s.key, kind: "programming_section" as const, title: `${s.key} · ${s.title}`, content: s.prompt,
      outcomeId: null as number | null, criterionId: null as number | null,
    })),
    ...outcomes.flatMap(o => [
      { key: `MAT-RA:${o.id}`, kind: "material_ra" as const, title: `${o.code} · Materiales y actividades`,
        content: `${o.code}: ${o.description}\n\nComparte propuestas integradoras, dudas y referencias a materiales de la biblioteca existente. No adjuntes datos del alumnado ni copies archivos innecesariamente. Las propuestas no modifican el texto oficial.`,
        outcomeId: o.id, criterionId: null as number | null },
      ...criteria.filter(c => c.outcomeId === o.id).map(c => ({
        key: `MAT-CE:${c.id}`, kind: "material_ce" as const, title: `${o.code} · CE ${c.code} · Materiales y actividades`,
        content: `${o.code}: ${o.description}\n\nCE ${c.code}: ${c.description}\n\nPropón actividades, evidencias, instrumentos y enlaces a recursos de la biblioteca. Identifica su autoría y licencia. Las propuestas no modifican el texto oficial.`,
        outcomeId: o.id, criterionId: c.id,
      })),
    ]),
  ];
}

export function forumCurriculumFingerprint(
  module: Pick<Module, "id" | "code" | "name" | "cycleId" | "cycleName" | "centerId">,
  outcomes: Pick<ModuleLearningOutcome, "id" | "code" | "description" | "order">[],
  criteria: Pick<ModuleEvaluationCriterion, "id" | "outcomeId" | "code" | "description" | "order">[],
): string {
  return createHash("sha256").update(JSON.stringify({
    module: { id: module.id, code: module.code, name: module.name, cycleId: module.cycleId, cycleName: module.cycleName, centerId: module.centerId },
    outcomes: [...outcomes].sort((a, b) => a.id - b.id).map(o => ({ id: o.id, code: o.code, description: o.description, order: o.order })),
    criteria: [...criteria].sort((a, b) => a.id - b.id).map(c => ({
      id: c.id, outcomeId: c.outcomeId, code: c.code, description: c.description, order: c.order,
    })),
  })).digest("hex");
}

const titles = [
  "Identificación y contextualización del módulo",
  "Normativa y currículo de referencia",
  "Competencias, objetivos y contribución del módulo",
  "Resultados de aprendizaje y criterios de evaluación oficiales",
  "Contenidos y relación con RA/CE",
  "Unidades de trabajo y secuenciación",
  "Temporalización y distribución horaria",
  "Metodologías y organización del aprendizaje",
  "Actividades, proyectos y tareas",
  "Procedimientos e instrumentos de evaluación",
  "Criterios de calificación, pesos y reglas de superación",
  "Recuperación, refuerzo y evaluación alternativa",
  "Atención a las diferencias individuales y accesibilidad",
  "Formación en empresa u organismo equiparado, cuando proceda",
  "Recursos, materiales y equipamientos",
  "Revisión de la práctica docente, seguimiento y mejora",
];

export const defaultProgrammingSections: ProgrammingSection[] = titles.map((title, index) => ({
  key: `PD-${String(index + 1).padStart(2, "0")}`,
  title,
  enabled: true,
  order: index,
  prompt: `Objeto del debate: ${title}.\n\n¿Qué propuesta compartimos y qué fuente normativa la sustenta? Aporta referencias, experiencias y evidencias sin datos del alumnado. Señala las diferencias legítimas de cada centro como «concreción local».\n\nIdentifica acuerdos, reservas y cuestiones pendientes. La síntesis deberá citar las aportaciones y ser revisada por coordinación; ninguna respuesta implica aprobación institucional.\n\nDocumento intercentros de referencia. No sustituye la programación aprobada por cada centro.`,
}));
