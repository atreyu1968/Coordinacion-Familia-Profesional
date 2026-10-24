// Build output, not vendored source: recreated from the locked dependency.
const fs = require("node:fs");
const path = require("node:path");
const source = path.dirname(require.resolve("pdfjs-dist/package.json"));
const output = path.resolve(__dirname, "../public/pdfjs");
fs.mkdirSync(output, { recursive: true });
for (const name of ["pdf", "pdf.worker"]) {
  // .js has the correct MIME type even on nginx installations without .mjs.
  fs.copyFileSync(path.join(source, `legacy/build/${name}.min.mjs`), path.join(output, `${name}.min.js`));
}
for (const directory of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  fs.cpSync(path.join(source, directory), path.join(output, directory), { recursive: true });
}
fs.copyFileSync(path.join(source, "LICENSE"), path.join(output, "LICENSE"));
console.log("Local PDF.js viewer assets prepared.");
