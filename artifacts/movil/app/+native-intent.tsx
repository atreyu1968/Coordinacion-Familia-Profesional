// Rewrites attendance links (https://…/asistencia/TOKEN or scheme://asistencia/TOKEN)
// to the in-app authenticated screen /asistencia?token=TOKEN. Auth guards in
// _layout still apply; a signed-out user is sent to login and returned here.
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    const match = /\/?asistencia\/([A-Za-z0-9_-]{8,200})(?:[/?#]|$)/.exec(path);
    if (match) return `/asistencia?token=${match[1]}`;
    // Shared web acta links: /eventos?evento=ID&seccion=acta -> /acta/ID
    if (/\/?eventos(?:[/?#]|$)/.test(path) && /[?&]seccion=acta(?:&|#|$)/.test(path)) {
      const ev = /[?&]evento=(\d{1,12})(?:&|#|$)/.exec(path);
      if (ev) return `/acta/${ev[1]}`;
    }
  } catch {
    // fall through to the original path
  }
  return path;
}
