import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CourseMarkdown } from "./course-markdown";

afterEach(cleanup);

describe("course lesson formatting", () => {
  it("formats the imported course text instead of showing Markdown markers", () => {
    render(<CourseMarkdown text={"# VERI*FACTU, facturación electrónica e IGIC — 30 horas\n\nFormación del profesorado.\n\n**Itinerario propuesto por unidad (5 h):** lectura y ejemplos.\n\n**Uso seguro:** solo datos ficticios.\n\n**Fechas normativas:** una **previsión** de aplazamiento."} />);
    expect(screen.getByRole("heading", { name: /VERI\*FACTU/, level: 2 })).toBeTruthy();
    expect(screen.getByText("Itinerario propuesto por unidad (5 h):").tagName).toBe("STRONG");
    expect(screen.getByText("Uso seguro:").tagName).toBe("STRONG");
    expect(screen.getByText("previsión").tagName).toBe("STRONG");
    expect(document.body.textContent).not.toContain("**");
    expect(document.body.textContent).not.toContain("# VERI");
  });

  it("renders lists, nested emphasis, quoted text and code", () => {
    render(<CourseMarkdown text={"## Objetivos\n\n- Una **actividad**\n- Una *lectura*\n\n1. Primer paso\n2. Segundo paso\n\n> Aviso importante\n\n```text\nx < y\n```"} />);
    expect(screen.getAllByRole("list")).toHaveLength(2);
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByText("lectura").tagName).toBe("EM");
    expect(screen.getByText("Aviso importante").closest("blockquote")).toBeTruthy();
    expect(screen.getByText("x < y").closest("pre")).toBeTruthy();
  });

  it("renders tables with horizontal scrolling rather than literal pipes", () => {
    render(<CourseMarkdown text={"| Unidad | Horas |\n| :--- | ---: |\n| **Facturación** | 5 |\n| IGIC | 5 |"} />);
    const region = screen.getByRole("region", { name: "Tabla de la lección" });
    expect(region.className).toContain("overflow-x-auto");
    expect(region.tabIndex).toBe(0);
    expect(within(region).getByRole("table")).toBeTruthy();
    expect(screen.getAllByRole("columnheader")).toHaveLength(2);
    expect(screen.getAllByRole("cell")).toHaveLength(4);
    expect(screen.getByText("Facturación").tagName).toBe("STRONG");
  });

  it("preserves clickable explicit and automatic web links", () => {
    render(<CourseMarkdown text={"Consulta [la AEAT](https://sede.agenciatributaria.gob.es) o https://www.boe.es."} />);
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "la AEAT" }).getAttribute("href"))
      .toBe("https://sede.agenciatributaria.gob.es");
    expect(screen.getByRole("link", { name: "https://www.boe.es" }).getAttribute("rel"))
      .toContain("noopener");
  });

  it("never inserts executable HTML or dangerous link protocols", () => {
    render(<CourseMarkdown text={'<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[malo](javascript:alert%281%29)\n\n**Contenido válido**'} />);
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("[onerror]")).toBeNull();
    expect(document.querySelector("a[href^='javascript:']")).toBeNull();
    expect(screen.getByText("Contenido válido").tagName).toBe("STRONG");
  });

  it("keeps ordinary text readable without requiring Markdown", () => {
    render(<CourseMarkdown text={"Primera línea\nSegunda línea\n\nOtro párrafo."} />);
    expect(screen.getByText(/Primera línea/).className).toContain("whitespace-pre-wrap");
    expect(screen.getByText("Otro párrafo.").tagName).toBe("P");
  });
});
