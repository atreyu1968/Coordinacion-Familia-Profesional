export type BrowserLinkSource = string | (() => Promise<string>);

export function validateBrowserUrl(raw: string): string {
  const url = new URL(raw);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("La dirección del enlace no es válida.");
  }
  return url.href;
}
