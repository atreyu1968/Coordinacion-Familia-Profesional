import { useContext, useEffect, useState } from "react";
import { getLmsCourseCover } from "@workspace/api-client-react";
import { AuthContext } from "@/lib/auth-context";

/** Images cannot send the app's bearer header: fetch with the authenticated client first. */
export function useLmsCourseCover(courseId: number, coverUrl?: string | null) {
  const userId = useContext(AuthContext)?.user?.id;
  const [loaded, setLoaded] = useState<{ coverUrl: string; userId: number | undefined; src: string } | null>(null);
  useEffect(() => {
    if (!coverUrl) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    void (async () => {
      try {
        // The generated route is fixed to our API; a server-provided URL never receives credentials.
        const blob = await getLmsCourseCover(courseId, { signal: controller.signal, responseType: "blob", cache: "no-store" });
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setLoaded({ coverUrl, userId, src: objectUrl });
      } catch {
        if (!controller.signal.aborted) setLoaded(null);
      }
    })();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [courseId, coverUrl, userId]);
  return loaded && loaded.coverUrl === coverUrl && loaded.userId === userId ? loaded.src : undefined;
}
