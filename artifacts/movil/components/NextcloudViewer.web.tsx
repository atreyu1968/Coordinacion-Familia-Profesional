import React, { useState } from "react";
import type { NextcloudViewerProps } from "./NextcloudViewer.types";

/** Never import react-native-webview here: its browser implementation is unsupported. */
export function NextcloudViewer({ url, title, onError, requestFreshUrl }: NextcloudViewerProps) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");

  const openInBrowser = async () => {
    // Open synchronously from the click so popup blockers do not reject the tab.
    const tab = window.open("about:blank", "_blank");
    if (!tab) {
      setError("El navegador ha bloqueado la ventana. Permite las ventanas emergentes y vuelve a intentarlo.");
      return;
    }
    tab.opener = null;
    setOpening(true);
    setError("");
    try {
      // The iframe may already have consumed its single-use SSO ticket.
      // Always request another ticket, rechecking the current user's access.
      const freshUrl = new URL(await requestFreshUrl());
      if (freshUrl.protocol !== "https:") throw new Error("Invalid Nextcloud URL");
      tab.location.replace(freshUrl.href);
    } catch {
      tab.close();
      setError("No se pudo abrir Nextcloud. Comprueba tu conexión y tus permisos e inténtalo de nuevo.");
    } finally {
      setOpening(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div style={{ padding: 12, fontFamily: "Inter, sans-serif", fontSize: 13 }}>
        <span>Si el navegador bloquea la vista integrada, </span>
        <button type="button" onClick={() => void openInBrowser()} disabled={opening}
          style={{ padding: 8, cursor: "pointer" }}>
          {opening ? "Abriendo…" : "Abrir Nextcloud en otra ventana"}
        </button>
        {error && <p role="alert">{error}</p>}
      </div>
      <iframe
        title={`Archivos de ${title}`}
        src={url}
        referrerPolicy="no-referrer"
        allow="clipboard-read; clipboard-write; fullscreen"
        onError={() => onError("No se pudo cargar Nextcloud. Cierra y vuelve a abrir el espacio.")}
        style={{ flex: 1, width: "100%", minHeight: 300, border: 0 }}
      />
    </div>
  );
}
