// @vitest-environment node
import { describe, expect, it } from "vitest";
import { notificationTargetPath } from "@workspace/api-client-react";
import { notificationRoute } from "../../../movil/lib/notification-route";

describe("persisted internal notification targets", () => {
  it.each([
    ["event", "/eventos?evento=9", "/eventos?aviso=9"],
    ["calendar", "/eventos?calendario=9", "/eventos?calendario=9"],
    ["course", "/autodirigido?curso=9", "/lms/9"],
    ["chat", "/chat?grupo=9", "/chat/9"],
    ["certificate_event", "/mis-certificados?aviso=9", "/mis-certificados?aviso=9"],
    ["minutes", "/actas?aviso=9", "/acta/9"],
    ["survey", "/encuestas?aviso=9", "/survey/9"],
    ["form", "/formularios?aviso=9", "/form/9"],
    ["forum", "/foros?tema=9", "/foros/tema/9"],
    ["space", "/espacio?aviso=9", "/espacios-colaborativos?aviso=9"],
    ["meeting", "/videoconferencias?aviso=9", "/videoconferencias?aviso=9"],
    ["announcement", "/anuncios?aviso=9", "/?aviso=9"],
    ["company_alert", "/fct?aviso=9", "/alerts?aviso=9"],
  ])("maps %s to allowlisted routes in both clients", (kind, web, mobile) => {
    const target = { kind, id: 9 };
    expect(notificationTargetPath(target, "web")).toBe(web);
    expect(notificationTargetPath(target, "mobile")).toBe(mobile);
    expect(notificationRoute({ type: "event", target, path: "https://external.invalid" })).toBe(mobile);
  });
  it.each([0, -1, 1.5, 2147483648, NaN, Infinity, "9", "../login", null])("rejects invalid id %s", (id) => {
    expect(notificationTargetPath({ kind: "event", id }, "web")).toBeNull();
    expect(notificationRoute({ type: "event", target: { kind: "event", id } })).toBe("/eventos");
  });
  it.each([null, undefined, "https://external.invalid", { kind: "//evil.invalid", id: 1 }])("never treats %s as a URL", (target) => {
    expect(notificationTargetPath(target, "web")).toBeNull();
  });
});
