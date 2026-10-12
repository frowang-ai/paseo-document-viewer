import { writeFile } from "node:fs/promises";
const pages = [
  [
    "Document viewer",
    "HTML and PDF in one Paseo workspace tab.",
    "Use the toolbar to move between pages, zoom,",
    "fit the page width, select text and search.",
  ],
  [
    "Local documents",
    "This is the second page of the bundled demo.",
    "Search for local documents to find this page.",
    "The PDF is generated from public example content.",
  ],
];
const objects = [];
const add = (s) => {
  objects.push(s);
  return objects.length;
};
add("<< /Type /Catalog /Pages 2 0 R >>");
add("");
add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
const pageIds = [];
for (const lines of pages) {
  const text = lines
    .map((s, i) => `${i ? "0 -36 Td" : "60 750 Td"} /F1 ${i ? 17 : 32} Tf (${s}) Tj`)
    .join("\n");
  const stream = `BT\n${text}\nET`;
  const content = add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  pageIds.push(
    add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${content} 0 R >>`,
    ),
  );
}
objects[1] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((n) => `${n} 0 R`).join(" ")}] >>`;
let pdf = "%PDF-1.4\n";
const offsets = [0];
objects.forEach((s, i) => {
  offsets.push(Buffer.byteLength(pdf));
  pdf += `${i + 1} 0 obj\n${s}\nendobj\n`;
});
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
  .slice(1)
  .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
  .join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
await writeFile("examples/demo.pdf", pdf);
