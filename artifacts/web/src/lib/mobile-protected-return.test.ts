// @vitest-environment node
import { describe, expect, it } from "vitest";
import { protectedReturnPath } from "../../../movil/lib/protected-return-path";

describe("internal notice return paths", () => {
  it.each([
    ["/eventos", { aviso: "15" }, "/eventos?aviso=15"],
    ["/eventos", { calendario: "16" }, "/eventos?calendario=16"],
    ["/mis-certificados", { aviso: "17" }, "/mis-certificados?aviso=17"],
    ["/acta/42", { id: "42" }, "/acta/42"],
    ["/chat/8", { id: "8" }, "/chat/8"],
    ["/asistencia", { token: "abcdefgh" }, "/asistencia?token=abcdefgh"],
  ])("retains %s and only its supported parameters", (path, params, expected) => {
    expect(protectedReturnPath(path, params)).toBe(expected);
  });
  it.each(["//evil.invalid", "https://evil.invalid", "/login", "/recuperar", "/../login"])("rejects %s", (path) => {
    expect(protectedReturnPath(path, { aviso: "1" })).toBeNull();
  });
  it("does not preserve arbitrary redirects, unsafe identifiers or URLs", () => {
    expect(protectedReturnPath("/eventos", { aviso: "2147483648", next: "https://evil.invalid", path: "//evil.invalid" })).toBe("/eventos");
  });
});
