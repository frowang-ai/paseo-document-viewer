import { build } from "esbuild";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
const require = createRequire(import.meta.url);
const root = dirname(require.resolve("pdfjs-dist/package.json"));
await mkdir("assets", { recursive: true });
const result = await build({
  entryPoints: ["viewer/pdf.js"],
  bundle: true,
  format: "iife",
  target: "chrome120",
  minify: true,
  write: false,
});
const worker = (await readFile(join(root, "build/pdf.worker.mjs"))).toString("base64");
const css = await readFile(join(root, "web/pdf_viewer.css"), "utf8");
const template = await readFile("viewer/template.html", "utf8");
const html = template
  .replace("/*__PDF_CSS__*/", () => css)
  .replace("__PDF_WORKER__", () => worker)
  .replace("__PDF_RUNTIME__", () =>
    result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script"),
  );
await writeFile("assets/pdf-viewer.html", html);
const resources = {};
for (const kind of ["cmaps", "standard_fonts", "wasm"]) {
  resources[kind] = {};
  for (const name of (await readdir(join(root, kind))).sort())
    resources[kind][name] = (await readFile(join(root, kind, name))).toString("base64");
}
await writeFile(
  "server/assets.generated.ts",
  `// Generated offline resources. No installation-specific paths.\nexport const PDF_VIEWER_HTML: string = ${JSON.stringify(html)};\nexport const PDF_ASSETS: Record<string, Record<string,string>> = ${JSON.stringify(resources)};\n`,
);
console.log("Prepared offline PDF viewer.");
