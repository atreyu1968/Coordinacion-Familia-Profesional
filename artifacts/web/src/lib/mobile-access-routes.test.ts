// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { notificationRoute } from "../../../movil/lib/notification-route";

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../movil/app");
function routeExists(route: string) {
  return existsSync(path.join(app, `${route}.tsx`))
    || existsSync(path.join(app, route, "index.tsx"));
}
function screens(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory()
    ? screens(path.join(dir, entry.name))
    : entry.name.endsWith(".tsx") ? [path.join(dir, entry.name)] : []);
}

describe("mobile access routes", () => {
  it("every literal navigation destination has a screen", () => {
    let checked = 0;
    for (const file of screens(app)) {
      const code = readFileSync(file, "utf8");
      for (const match of code.matchAll(/(?:router\.(?:push|replace)\(\s*|pathname:\s*)["'](\/[^"']*)["']/g)) {
        expect(routeExists(match[1]), `${path.relative(app, file)} -> ${match[1]}`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(40);
  });

  it.each([
    ["collaborative_space", "/espacios-colaborativos"],
    ["lms_course", "/lms"], ["certificate", "/mis-certificados"],
    ["meeting_minutes", "/actas"], ["meeting", "/videoconferencias"],
    ["message", "/(tabs)/chat"], ["survey", "/surveys"], ["document_form", "/forms"],
    ["forum_reply", "/foros"], ["year_confirmation", "/confirmar-curso"],
    ["company_alert", "/alerts"], ["announcement", "/(tabs)/notifications"],
    ["event", "/(tabs)"], ["calendar", "/(tabs)"],
  ])("opens %s in the existing app screen", (type, route) => {
    expect(notificationRoute({ type })).toBe(route);
    expect(routeExists(route)).toBe(true);
  });

  it("preserves valid detail targets and rejects malformed identifiers", () => {
    expect(notificationRoute({ type: "message", groupId: 7 }))
      .toEqual({ pathname: "/chat/[id]", params: { id: "7" } });
    expect(notificationRoute({ type: "survey", surveyId: 8 }))
      .toEqual({ pathname: "/survey/[id]", params: { id: "8" } });
    expect(notificationRoute({ type: "document_form", documentFormId: 9 }))
      .toEqual({ pathname: "/form/[id]", params: { id: "9" } });
    expect(notificationRoute({ type: "forum_reply", threadId: 10 }))
      .toEqual({ pathname: "/foros/tema/[id]", params: { id: "10" } });
    expect(notificationRoute({ type: "message", groupId: "../../perfil" })).toBe("/(tabs)/chat");
    expect(notificationRoute(null)).toBeNull();
  });
});
