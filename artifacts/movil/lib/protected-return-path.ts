/** Capture an internal router location, not a caller-supplied redirect URL. */
export function protectedReturnPath(
  pathname: string,
  params: Record<string, unknown>,
): string | null {
  if (!/^\/[A-Za-z0-9/_-]*$/.test(pathname) || pathname.startsWith("//") ||
    pathname === "/login" || pathname === "/recuperar") return null;
  const query = new URLSearchParams();
  for (const key of ["aviso", "calendario"]) {
    const value = params[key];
    if (typeof value === "string" && /^[1-9]\d*$/.test(value) && Number(value) <= 2147483647) {
      query.set(key, value);
    }
  }
  if (pathname === "/asistencia" && typeof params.token === "string" && /^[A-Za-z0-9_-]{8,200}$/.test(params.token)) {
    query.set("token", params.token);
  }
  return pathname + (query.size ? `?${query}` : "");
}
