import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { RpcInput } from "@getpaseo/plugin";
import { randomUUID } from "node:crypto";
import { readdir, realpath } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import { PDF_VIEWER_HTML, PDF_ASSETS } from "./assets.generated";
import {
  isDocument,
  type listDocuments,
  type prepareDocument,
  type readDocumentChunk,
  type readPdfAsset,
} from "../shared/documents";
import { boundedRead, prepareHtml, protectHtml, safeFile } from "./html";

const cache = new Map<string, { workspaceId: string; bytes: Buffer; touched: number }>();
async function rootFor(workspaceId: string, context: PluginHandlerContext): Promise<string> {
  const workspace = await context.paseo.workspaces.ref(workspaceId).refresh();
  if (!workspace?.workspaceDirectory) throw new Error("워크스페이스 폴더를 찾을 수 없습니다.");
  return realpath(workspace.workspaceDirectory);
}
export async function list(input: RpcInput<typeof listDocuments>, context: PluginHandlerContext) {
  const root = await rootFor(input.workspaceId, context);
  const folder = await safeFile(root, input.path);
  const entries = (await readdir(folder, { withFileTypes: true })).filter(
    (e) => !e.name.startsWith(".") && (e.isDirectory() || (e.isFile() && isDocument(e.name))),
  );
  entries.sort(
    (a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name),
  );
  return {
    path: relative(root, folder).split("\\").join("/") || ".",
    entries: entries.slice(0, 1000).map((e) => ({
      name: e.name,
      path: relative(root, join(folder, e.name)).split("\\").join("/"),
      directory: e.isDirectory(),
    })),
  };
}
export async function prepare(
  input: RpcInput<typeof prepareDocument>,
  context: PluginHandlerContext,
) {
  const root = await rootFor(input.workspaceId, context);
  const file = await safeFile(root, input.path);
  if (!isDocument(file)) throw new Error("HTML 또는 PDF 파일을 선택하세요.");
  const kind = extname(file).toLowerCase() === ".pdf" ? ("pdf" as const) : ("html" as const);
  let html: string;
  let warnings: string[] = [];
  if (kind === "html") ({ html, warnings } = await prepareHtml(file));
  else {
    const pdf = await boundedRead(file);
    if (!pdf.subarray(0, 1024).includes(Buffer.from("%PDF-")))
      throw new Error("유효한 PDF 파일이 아닙니다.");
    const template = PDF_VIEWER_HTML;
    html = protectHtml(
      template
        .replace("__PDF_DATA__", pdf.toString("base64"))
        .replace("__PDF_PAGE__", String(input.page ?? 1)),
    );
  }
  const bytes = Buffer.from(html);
  for (const [id, value] of cache)
    if (Date.now() - value.touched > 10 * 60 * 1000) cache.delete(id);
  while (
    cache.size >= 4 ||
    (cache.size &&
      [...cache.values()].reduce((sum, value) => sum + value.bytes.length, bytes.length) >
        96 * 1024 * 1024)
  ) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
    else break;
  }
  const id = randomUUID();
  cache.set(id, { workspaceId: input.workspaceId, bytes, touched: Date.now() });
  return { id, name: basename(file), kind, bytes: bytes.length, warnings };
}
export function chunk(input: RpcInput<typeof readDocumentChunk>) {
  const value = cache.get(input.id);
  if (
    !value ||
    value.workspaceId !== input.workspaceId ||
    Date.now() - value.touched > 10 * 60 * 1000
  )
    throw new Error("미리보기가 만료되었습니다. 새로고침하세요.");
  if (input.offset >= value.bytes.length) throw new Error("잘못된 읽기 위치입니다.");
  value.touched = Date.now();
  const next = Math.min(value.bytes.length, input.offset + 384 * 1024);
  return {
    base64: value.bytes.subarray(input.offset, next).toString("base64"),
    next,
    done: next === value.bytes.length,
  };
}
export async function pdfAsset(input: RpcInput<typeof readPdfAsset>) {
  const files = PDF_ASSETS[input.kind];
  if (!Object.hasOwn(files, input.name) || input.name.startsWith("."))
    throw new Error("지원하지 않는 PDF 리소스입니다.");
  return {
    base64: files[input.name],
  };
}
export function clearDocuments() {
  cache.clear();
}
