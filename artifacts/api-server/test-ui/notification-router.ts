// Load the real pure implementation at runtime, without bringing Expo Router's
// React Native global declarations into this Node + DOM test project.
// Mobile's own typecheck owns its Href compatibility.
const modulePath = "../../movil/lib/notification-route.ts";
const module = await import(modulePath);
export const notificationRoute: (data: unknown) =>
  string | { pathname: string; params: Record<string, string> } | null = module.notificationRoute;

export function notificationPath(data: unknown): string {
  const target = notificationRoute(data);
  if (!target) throw new Error("The notice has no navigation destination.");
  if (typeof target === "string") return target;
  let pathname = target.pathname;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(target.params)) {
    const segment = `[${key}]`;
    if (pathname.includes(segment)) pathname = pathname.replace(segment, encodeURIComponent(value));
    else search.set(key, value);
  }
  return pathname + (search.size ? `?${search}` : "");
}
