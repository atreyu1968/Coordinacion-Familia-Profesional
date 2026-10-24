import { validateBrowserUrl, type BrowserLinkSource } from "./browser-link.types";

export async function openBrowserLink(source: BrowserLinkSource): Promise<void> {
  // Reserve the tab during the user gesture, before requesting protected URLs.
  const tab = window.open("about:blank", "_blank");
  if (!tab) throw new Error("El navegador ha bloqueado la ventana. Permite las ventanas emergentes y vuelve a intentarlo.");
  tab.opener = null;
  try {
    const url = validateBrowserUrl(typeof source === "string" ? source : await source());
    tab.location.replace(url);
  } catch (error) {
    tab.close();
    throw error;
  }
}
