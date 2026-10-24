// Receives PDF bytes, never a URL or an authentication token.
const element = (id) => document.getElementById(id);
const status = element("status");
const canvas = element("canvas");
let pdfjs, pdf, loadingTask, rendering, page = 1, zoom = 1, revision = 0;
const send = (type, message) => window.parent.postMessage({ type, message }, window.location.origin);

function fail(error) {
  const message = error?.name === "PasswordException"
    ? "Este PDF está protegido con contraseña. Utiliza la descarga para abrirlo."
    : "No se pudo mostrar el PDF. Inténtalo de nuevo o utiliza la descarga.";
  status.textContent = message;
  send("coordina-pdf-error", message);
}

async function renderPage() {
  if (!pdf) return;
  const current = ++revision;
  rendering?.cancel();
  status.textContent = `Cargando página ${page}…`;
  try {
    const documentPage = await pdf.getPage(page);
    if (current !== revision) return;
    const original = documentPage.getViewport({ scale: 1 });
    const width = Math.max(100, element("pages").clientWidth - 24);
    const viewport = documentPage.getViewport({ scale: width / original.width * zoom });
    // Bound canvas memory on high-density phones.
    const ratio = Math.min(window.devicePixelRatio || 1, 2,
      Math.sqrt(12_000_000 / (viewport.width * viewport.height)));
    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    canvas.setAttribute("aria-label", `Página ${page} de ${pdf.numPages}`);
    element("page").value = String(page);
    element("page").max = String(pdf.numPages);
    element("total").textContent = `de ${pdf.numPages}`;
    element("zoom").textContent = `${Math.round(zoom * 100)} %`;
    element("previous").disabled = page <= 1;
    element("next").disabled = page >= pdf.numPages;
    for (const id of ["page", "less", "more", "fit"]) element(id).disabled = false;
    rendering = documentPage.render({
      canvasContext: canvas.getContext("2d"), viewport,
      transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
    });
    await rendering.promise;
    if (current === revision) {
      status.textContent = "";
      send("coordina-pdf-rendered");
    }
  } catch (error) {
    if (current === revision && error?.name !== "RenderingCancelledException") fail(error);
  }
}

async function openDocument(data) {
  if (!(data instanceof ArrayBuffer) || data.byteLength > 50 * 1024 * 1024) return;
  ++revision;
  rendering?.cancel();
  canvas.width = canvas.height = 0;
  const current = revision;
  try {
    await loadingTask?.destroy();
    if (current !== revision) return;
    status.textContent = "Abriendo documento…";
    const resources = new URL("../pdfjs/", window.location.href).href;
    loadingTask = pdfjs.getDocument({
      data: new Uint8Array(data), isEvalSupported: false, enableXfa: false,
      cMapUrl: `${resources}cmaps/`, cMapPacked: true,
      standardFontDataUrl: `${resources}standard_fonts/`,
      wasmUrl: `${resources}wasm/`, iccUrl: `${resources}iccs/`,
    });
    pdf = await loadingTask.promise;
    if (current !== revision) return;
    page = 1; zoom = 1;
    await renderPage();
  } catch (error) {
    if (current === revision) fail(error);
  }
}

element("previous").onclick = () => { if (page > 1) { page--; void renderPage(); } };
element("next").onclick = () => { if (pdf && page < pdf.numPages) { page++; void renderPage(); } };
element("page").onchange = () => {
  const value = Number(element("page").value);
  if (pdf && Number.isInteger(value) && value >= 1 && value <= pdf.numPages) {
    page = value; void renderPage();
  } else element("page").value = String(page);
};
element("more").onclick = () => { zoom = Math.min(3, zoom + .25); void renderPage(); };
element("less").onclick = () => { zoom = Math.max(.5, zoom - .25); void renderPage(); };
element("fit").onclick = () => { zoom = 1; void renderPage(); };
let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => void renderPage(), 120);
});
window.addEventListener("pagehide", () => { ++revision; void loadingTask?.destroy(); });

try {
  pdfjs = await import("../pdfjs/pdf.min.js");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("../pdfjs/pdf.worker.min.js", window.location.href).href;
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || event.origin !== window.location.origin) return;
    if (event.data?.type === "coordina-pdf-open") void openDocument(event.data.data);
  });
  status.textContent = "Esperando documento…";
  send("coordina-pdf-ready");
} catch (error) { fail(error); }
