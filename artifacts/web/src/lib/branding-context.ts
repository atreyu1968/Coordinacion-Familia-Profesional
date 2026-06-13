import { createContext, useContext } from "react";

export interface BrandingContextType {
  // Display name of the app (built-in default when no custom name is set).
  appName: string;
  // URL of the custom uploaded logo, or null to use the caller's built-in
  // fallback. The header and the login screen use different default assets
  // (white vs. colored), so each applies its own fallback.
  customLogoUrl: string | null;
  // URL for the favicon: the custom uploaded favicon, or the built-in default.
  faviconUrl: string;
  // True while the branding query is still loading its first result.
  isLoading: boolean;
}

// Kept in its own module (no React components) so the context identity stays
// stable across Vite HMR updates. If it lived alongside <BrandingProvider>, a
// hot update would create a new context object while the mounted provider kept
// the old one, making useBranding throw "must be used within a BrandingProvider".
export const BrandingContext = createContext<BrandingContextType | null>(null);

export function useBranding() {
  const context = useContext(BrandingContext);
  if (!context) {
    throw new Error("useBranding must be used within a BrandingProvider");
  }
  return context;
}
