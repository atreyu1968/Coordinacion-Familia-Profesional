import { readFileSync } from "node:fs";

export interface FpaModule {
  code: string | null; name: string; kind: "professional" | "general" | "tutoring";
  hours: number; weeklyHours: number;
}
export interface FpaItinerary {
  name: string; qualificationCode: string; certificateCode: string;
  source: string; modules: FpaModule[];
}
export interface FpaCatalog {
  family: string; level: string; reviewedAt: string; resolution: string;
  totalHours: number; weeklyHours: number;
  commonModules: FpaModule[]; itineraries: FpaItinerary[];
}

export function loadFpaCatalog(): FpaCatalog {
  const catalog: FpaCatalog = JSON.parse(readFileSync(new URL("../data/fpa-adg.json", import.meta.url), "utf8"));
  const certificates = new Set<string>();
  for (const itinerary of catalog.itineraries) {
    if (certificates.has(itinerary.certificateCode)) throw new Error("Itinerario FPA duplicado.");
    certificates.add(itinerary.certificateCode);
    const modules = [...itinerary.modules, ...catalog.commonModules];
    if (new Set(modules.map((module) => module.name)).size !== modules.length
      || modules.reduce((sum, module) => sum + module.hours, 0) !== catalog.totalHours
      || modules.reduce((sum, module) => sum + module.weeklyHours, 0) !== catalog.weeklyHours) {
      throw new Error(`Distribución modular FPA inválida: ${itinerary.certificateCode}`);
    }
  }
  return catalog;
}

export function fpaCatalogGuide(catalog = loadFpaCatalog()): string[] {
  return [
    ...catalog.itineraries.flatMap((itinerary) => [
      `## ${itinerary.name}`,
      `Cualificación: ${itinerary.qualificationCode}. Certificado profesional de referencia: ${itinerary.certificateCode}.`,
      ...itinerary.modules.map((module) => `- ${module.code} · ${module.name}: ${module.hours} horas anuales y ${module.weeklyHours} horas semanales.`),
      "Subtotal de módulos profesionales: 470 horas anuales y 13 horas semanales.",
      `Anexo oficial: ${itinerary.source}`,
    ]),
    "## Ámbitos generales y tutoría comunes a ambos itinerarios",
    ...catalog.commonModules.map((module) => `- ${module.name}: ${module.hours} horas anuales y ${module.weeklyHours} horas semanales. No tiene código MF en los anexos.`),
    "Subtotal de ámbitos generales y tutoría: 435 horas anuales y 12 horas semanales.",
    `Total de cada itinerario: ${catalog.totalHours} horas y ${catalog.weeklyHours} horas lectivas semanales según los anexos III y IV.`,
    "Reproducción y archivo (MF0971_1) es común a los dos itinerarios. Hay cinco módulos profesionales diferentes, pero cada itinerario conserva su propia vinculación de módulos, ámbitos y tutoría para las asignaciones docentes.",
  ];
}
