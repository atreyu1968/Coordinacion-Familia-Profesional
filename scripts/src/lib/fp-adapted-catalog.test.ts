import { test } from "node:test";
import assert from "node:assert/strict";
import { fpaCatalogGuide, loadFpaCatalog } from "./fp-adapted-catalog";
import { loadNormativaCatalog, normativaSectionContent } from "./normativa-catalog";

test("FPA tiene dos itinerarios ADG separados del grado básico y cinco módulos profesionales diferentes", () => {
  const catalog = loadFpaCatalog();
  assert.equal(catalog.family, "Administración y Gestión");
  assert.equal(catalog.level, "FP Adaptada");
  assert.equal(catalog.itineraries.length, 2);
  assert.deepEqual(catalog.itineraries.map((item) => item.certificateCode), ["ADGG0408", "ADGG0508"]);
  assert.equal(new Set(catalog.itineraries.flatMap((item) => item.modules.map((module) => module.code))).size, 5);
  assert.equal(catalog.itineraries.filter((item) => item.modules.some((module) => module.code === "MF0971_1")).length, 2);
});

test("conserva las horas oficiales, tres ámbitos generales y tutoría sin inventar códigos MF", () => {
  const catalog = loadFpaCatalog();
  assert.equal(catalog.commonModules.filter((module) => module.kind === "general").length, 3);
  assert.equal(catalog.commonModules.filter((module) => module.kind === "tutoring").length, 1);
  assert.ok(catalog.commonModules.every((module) => module.code === null));
  for (const item of catalog.itineraries) {
    const all = [...item.modules, ...catalog.commonModules];
    assert.equal(all.length, 7);
    assert.equal(item.modules.reduce((sum, module) => sum + module.hours, 0), 470);
    assert.equal(all.reduce((sum, module) => sum + module.hours, 0), 905);
    assert.equal(all.reduce((sum, module) => sum + module.weeklyHours, 0), 25);
  }
});

test("Documentación incluye todos los módulos, horas, normas y anexos de FPA", () => {
  const catalog = loadNormativaCatalog();
  const section = catalog.sections.find((item) => item.key === "fp-adaptada")!;
  assert.ok(section);
  const content = normativaSectionContent(catalog, section);
  for (const module of loadFpaCatalog().itineraries.flatMap((item) => item.modules)) {
    assert.ok(content.includes(module.code!));
    assert.ok(content.includes(module.name));
    assert.ok(content.includes(`${module.hours} horas anuales`));
  }
  assert.ok(fpaCatalogGuide().join("\n").includes("905 horas"));
  for (const term of ["Grado C", "Grado Básico", "IFE+16", "IFC+21", "80 a 120", "918.html", "1728.html",
    "anexo-3-", "anexo-4-", "tutoría"]) assert.ok(content.includes(term), term);
});
