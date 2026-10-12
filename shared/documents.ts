import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const scope = { workspaceId: z.string().min(1).max(128) };
export const listDocuments = defineRpc({
  name: "documents.list",
  input: z.object({ ...scope, path: z.string().max(4096).default(".") }),
  output: z.object({
    path: z.string(),
    entries: z.array(z.object({ name: z.string(), path: z.string(), directory: z.boolean() })),
  }),
});
export const prepareDocument = defineRpc({
  name: "documents.prepare",
  input: z.object({
    ...scope,
    path: z.string().min(1).max(4096),
    page: z.number().int().positive().optional(),
  }),
  output: z.object({
    id: z.string(),
    name: z.string(),
    kind: z.enum(["html", "pdf"]),
    bytes: z.number(),
    warnings: z.array(z.string()),
  }),
});
export const readDocumentChunk = defineRpc({
  name: "documents.chunk",
  input: z.object({ ...scope, id: z.string(), offset: z.number().int().nonnegative() }),
  output: z.object({ base64: z.string(), next: z.number(), done: z.boolean() }),
});
export const readPdfAsset = defineRpc({
  name: "documents.pdf-asset",
  input: z.object({
    kind: z.enum(["cmaps", "standard_fonts", "wasm"]),
    name: z.string().regex(/^[a-zA-Z0-9_.-]{1,128}$/),
  }),
  output: z.object({ base64: z.string() }),
});

export type DocumentSelection = { path: string; page?: number; revision: number };
export function documentLink(base: string, href: string): { path: string; page?: number } | null {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|\/|#)/i.test(href)) return null;
  const [raw, fragment] = href.split("#");
  if (!raw || raw.includes("?")) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (!isDocument(decoded)) return null;
  const parts = base.split("/").slice(0, -1);
  for (const part of decoded.split("/")) {
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else if (part && part !== ".") parts.push(part);
  }
  const page = fragment && /^page=[1-9]\d*$/.test(fragment) ? Number(fragment.slice(5)) : undefined;
  if (fragment && (!page || !Number.isSafeInteger(page) || !/\.pdf$/i.test(decoded))) return null;
  return { path: parts.join("/"), ...(page ? { page } : {}) };
}
export function isDocument(path: string): boolean {
  return /\.(html?|pdf)$/i.test(path);
}
export function treePath(rows: { name: string; indent: number }[], index: number): string | null {
  const parents: { name: string; indent: number }[] = [];
  for (const row of rows.slice(0, index + 1)) {
    if (!row.name || row.name.includes("/") || row.name === ".." || !Number.isFinite(row.indent))
      return null;
    while (parents.length && parents[parents.length - 1].indent >= row.indent) parents.pop();
    parents.push(row);
  }
  return parents.map((row) => row.name).join("/") || null;
}
