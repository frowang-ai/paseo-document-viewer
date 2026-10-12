import type { DocumentSelection } from "../shared/documents";
import { readLastDocument, writeLastDocument } from "./web";
const selections = new Map<string, DocumentSelection>();
const listeners = new Set<() => void>();
export const selectionKey = (host: string, workspace: string) => `${host}:${workspace}`;
export function selectDocument(key: string, path: string, page?: number) {
  selections.set(key, { path, page, revision: (selections.get(key)?.revision ?? 0) + 1 });
  writeLastDocument(key, path, page);
  for (const listener of listeners) listener();
}
export function currentDocument(key: string) {
  if (!selections.has(key)) {
    const saved = readLastDocument(key);
    if (saved) selections.set(key, { ...saved, revision: 1 });
  }
  return selections.get(key) ?? null;
}
export function subscribeDocuments(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
