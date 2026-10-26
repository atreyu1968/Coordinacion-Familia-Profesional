import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LmsScormPlayer } from "../../../movil/components/LmsVideoPlayer.web";

afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

it("opens the PWA SCORM fullscreen and keeps the same frame when returning", async () => {
  vi.stubEnv("EXPO_PUBLIC_DOMAIN", "example.org");
  render(<LmsScormPlayer token="test-session" title="Actividad de prueba" />);
  const player = screen.getByRole("region", { name: "Reproductor SCORM" });
  const frame = screen.getByTitle("Actividad de prueba");
  expect(player.getAttribute("data-fullscreen")).toBe("true");
  expect(frame.getAttribute("src")).toBe("https://example.org/scorm-player?token=test-session");
  await waitFor(() => expect(document.body.style.overflow).toBe("hidden"));
  fireEvent.click(screen.getByRole("button", { name: "Volver al curso" }));
  expect(player.getAttribute("data-fullscreen")).toBe("false");
  expect(screen.getByTitle("Actividad de prueba")).toBe(frame);
  fireEvent.click(screen.getByRole("button", { name: "Ver SCORM a pantalla completa" }));
  expect(player.getAttribute("data-fullscreen")).toBe("true");
  expect(screen.getByTitle("Actividad de prueba")).toBe(frame);
});
