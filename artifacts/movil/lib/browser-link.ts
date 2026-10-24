import * as WebBrowser from "expo-web-browser";
import { validateBrowserUrl, type BrowserLinkSource } from "./browser-link.types";

export async function openBrowserLink(source: BrowserLinkSource): Promise<void> {
  const url = validateBrowserUrl(typeof source === "string" ? source : await source());
  await WebBrowser.openBrowserAsync(url);
}
