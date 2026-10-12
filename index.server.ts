import type { PluginServerContext } from "@getpaseo/plugin/server";
import { clearDocuments, list, prepare, chunk, pdfAsset } from "./server/documents";
import {
  listDocuments,
  prepareDocument,
  readDocumentChunk,
  readPdfAsset,
} from "./shared/documents";

export default function contribute(server: PluginServerContext) {
  server.handle(listDocuments, list);
  server.handle(prepareDocument, prepare);
  server.handle(readDocumentChunk, chunk);
  server.handle(readPdfAsset, pdfAsset);
  return clearDocuments;
}
