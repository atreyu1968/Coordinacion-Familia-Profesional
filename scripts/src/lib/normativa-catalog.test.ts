import { test } from "node:test";
import assert from "node:assert/strict";
import { isUneditedNormativaIndex, loadNormativaCatalog, normativaIndexContent, normativaSectionContent } from "./normativa-catalog";

test("catálogo con fecha, ocho secciones y 70 fuentes oficiales únicas", () => {
  const catalog = loadNormativaCatalog();
  assert.equal(catalog.family, "Administración y Gestión");
  assert.equal(catalog.reviewedAt, "2026-10-27");
  assert.equal(catalog.sections.length, 8);
  const references = catalog.sections.flatMap((section) => section.references);
  assert.equal(references.length, 70);
  assert.equal(new Set(references.map((reference) => reference.url)).size, references.length);
  assert.match(catalog.notice, /no inventario exhaustivo/);
  assert.match(catalog.notice, /no se actualiza automáticamente/);
});

test("Convalidaciones contiene una guía propia y referencias oficiales del curso 2026/2027", () => {
  const catalog = loadNormativaCatalog();
  const section = catalog.sections.find((item) => item.key === "convalidaciones")!;
  assert.ok(section);
  const content = normativaSectionContent(catalog, section);
  for (const term of ["Procedimiento y documentación", "Módulos idénticos", "secretaría", "IPE I",
    "Exención de FEOE", "Homologación", "1341.html", "curso-26-27.pdf", "262/2026"]) {
    assert.ok(content.includes(term), term);
  }
});

test("solo se puede refrescar el índice generado, nunca texto editado por coordinación", () => {
  const catalog = loadNormativaCatalog();
  const index = normativaIndexContent(catalog);
  assert.ok(isUneditedNormativaIndex(index, catalog));
  const oldTitles = catalog.sections.filter((section) => section.key !== "convalidaciones").map((section) => section.title);
  assert.ok(isUneditedNormativaIndex(normativaIndexContent(catalog, oldTitles, 54), catalog));
  assert.equal(isUneditedNormativaIndex(index + "\n\nNota añadida por coordinación.", catalog), false);
  assert.equal(isUneditedNormativaIndex(index.replace("Cómo aplicar", "Guía de coordinación"), catalog), false);
  assert.equal(isUneditedNormativaIndex("Contenido propio", catalog), false);
});

test("cada apartado conserva enlaces, contexto y advertencias al publicarlo", () => {
  const catalog = loadNormativaCatalog();
  for (const section of catalog.sections) {
    const content = normativaSectionContent(catalog, section);
    assert.ok(content.includes(section.description));
    assert.ok(content.includes(catalog.notice));
    assert.ok(content.includes(catalog.reviewedAt));
    for (const reference of section.references) {
      assert.ok(content.includes(reference.title));
      assert.ok(content.includes(reference.url));
      assert.ok(content.includes(reference.note));
      assert.ok(content.includes(reference.kind));
    }
  }
});

test("incluye los cinco títulos y las modificaciones de evaluación, FEOE y optativas", () => {
  const catalog = loadNormativaCatalog();
  const text = JSON.stringify(catalog);
  for (const term of ["Gestión Administrativa", "Administración y Finanzas", "Asistencia a la Dirección",
    "Servicios Administrativos", "Informática de Oficina", "4298.html", "4130.html", "703.html",
    "2508.html", "7 de abril de 2026"]) {
    assert.ok(text.includes(term), term);
  }
});
