/**
 * Dynamic app branding for the mobile (Expo) app.
 *
 * The superadmin can set a custom app name, logo and favicon from the web
 * control panel; the values live in the API (`/settings/branding`) and we apply
 * them here. When nothing is configured the app falls back to the built-in
 * defaults (bundled logo assets / "Coordina ADG").
 */
import { useGetBranding } from "@workspace/api-client-react";

const DEFAULT_APP_NAME = "Coordina ADG";

function brandingApiBase(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  return `https://${domain}/api/settings/branding`;
}

export interface BrandingAssets {
  appName: string;
  /** Remote logo URL when a custom logo is set, otherwise null (use bundled asset). */
  logoUri: string | null;
  /** Remote favicon URL when a custom favicon is set, otherwise null. */
  faviconUri: string | null;
}

/**
 * Read the current branding and build absolute asset URLs. The `?v=` version
 * busts the image cache whenever the branding row changes.
 */
export function useBrandingAssets(): BrandingAssets {
  const { data } = useGetBranding();
  const base = brandingApiBase();
  const v = data?.version ? encodeURIComponent(data.version) : "";
  return {
    appName: data?.appName || DEFAULT_APP_NAME,
    logoUri: data?.hasLogo ? `${base}/logo?v=${v}` : null,
    faviconUri: data?.hasFavicon ? `${base}/favicon?v=${v}` : null,
  };
}
