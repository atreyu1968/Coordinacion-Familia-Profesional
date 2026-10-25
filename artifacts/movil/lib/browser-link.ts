import * as WebBrowser from "expo-web-browser";
import { validateBrowserUrl, type BrowserLinkSource } from "./browser-link.types";
import { beginExternalBrowserOpen } from "./external-browser-resume";

export async function openBrowserLink(source: BrowserLinkSource): Promise<void> {
  const url = validateBrowserUrl(typeof source === "string" ? source : await source());
  const finishTracking = beginExternalBrowserOpen();
  let opened = false;
  try {
    const browserPromise = WebBrowser.openBrowserAsync(url);
    opened = true;
    await browserPromise;
  } finally {
    finishTracking(opened);
  }
}
