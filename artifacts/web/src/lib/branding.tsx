import React, { useEffect, useMemo } from "react";
import { useGetBranding, getGetBrandingQueryKey } from "@workspace/api-client-react";
import { BrandingContext } from "./branding-context";

// Re-exported for convenience so consumers can import from "@/lib/branding".
export { useBranding } from "./branding-context";

const DEFAULT_APP_NAME = "Coordina ADG";
const DEFAULT_FAVICON = "/favicon.png";

// Branding images are served by the API at the same origin under /api. They are
// public routes (the login screen renders the logo before authentication).
function brandingAssetUrl(kind: "logo" | "favicon", version: string): string {
  return `/api/settings/branding/${kind}?v=${encodeURIComponent(version)}`;
}

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useGetBranding({
    query: { queryKey: getGetBrandingQueryKey() },
  });

  const value = useMemo(() => {
    const version = data?.version ?? "0";
    return {
      appName: data?.appName?.trim() || DEFAULT_APP_NAME,
      customLogoUrl: data?.hasLogo ? brandingAssetUrl("logo", version) : null,
      faviconUrl: data?.hasFavicon
        ? brandingAssetUrl("favicon", version)
        : DEFAULT_FAVICON,
      isLoading,
    };
  }, [data, isLoading]);

  // Reflect the app name in the document title.
  useEffect(() => {
    document.title = value.appName;
  }, [value.appName]);

  // Reflect the favicon in the <link rel="icon"> element.
  useEffect(() => {
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = value.faviconUrl;
  }, [value.faviconUrl]);

  return (
    <BrandingContext.Provider value={value}>
      {children}
    </BrandingContext.Provider>
  );
}
