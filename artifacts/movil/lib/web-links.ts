// Web app pages live on the same deployment domain as the API (web preview path "/").
export function webAppUrl(path: string): string | null {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) return null;
  return `https://${domain}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Web forum for a module; the web page reads the `module` query param (useModuleParam). */
export const webForumModuleUrl = (moduleId: number) => webAppUrl(`/foros?module=${moduleId}`);

/** Existing web module detail route; ModuleOutcomes renders `ra-{id}` / `ce-{id}` anchors. */
export function webOutcomeUrl(
  moduleId: number,
  kind: string,
  outcomeId: number | null,
  criterionId: number | null,
): string | null {
  if (kind === "material_ce" && criterionId != null) return webAppUrl(`/academica/modulo/${moduleId}#ce-${criterionId}`);
  if (kind === "material_ra" && outcomeId != null) return webAppUrl(`/academica/modulo/${moduleId}#ra-${outcomeId}`);
  return null;
}
