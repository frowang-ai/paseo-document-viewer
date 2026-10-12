import { isDocument } from "./documents";

export type DocumentView = {
  page: number;
  htmlZoom: number;
  pdfZoom: number;
  pdfFit: boolean;
  scrollX: number;
  scrollY: number;
};
export type DocumentSession = {
  id: string;
  hostId: string;
  workspaceId: string;
  path: string;
  revision: number;
  view: DocumentView;
};
export const defaultDocumentView = (): DocumentView => ({
  page: 1,
  htmlZoom: 1,
  pdfZoom: 1,
  pdfFit: true,
  scrollX: 0,
  scrollY: 0,
});
export const documentKey = (host: string, workspace: string, path: string) =>
  JSON.stringify([host, workspace, path]);

/** Paseo scopes panel instances by host and workspace; this ID identifies the file. */
export function documentPanelId(path: string) {
  let first = 2166136261,
    second = 2246822507;
  for (let i = 0; i < path.length; i++) {
    first = Math.imul(first ^ path.charCodeAt(i), 16777619);
    second = Math.imul(second ^ path.charCodeAt(i), 3266489909);
  }
  return `document-${(first >>> 0).toString(36)}-${(second >>> 0).toString(36)}`;
}
export function cleanDocumentView(value: unknown, base = defaultDocumentView()): DocumentView {
  if (!value || typeof value !== "object") return base;
  const input = value as Record<string, unknown>,
    next = { ...base };
  if (Number.isSafeInteger(input.page) && Number(input.page) > 0) next.page = Number(input.page);
  for (const [key, low, high] of [
    ["htmlZoom", 0.5, 3],
    ["pdfZoom", 0.25, 4],
    ["scrollX", 0, 10_000_000],
    ["scrollY", 0, 10_000_000],
  ] as const) {
    const number = input[key];
    if (typeof number === "number" && Number.isFinite(number) && number >= low && number <= high)
      next[key] = number;
  }
  if (typeof input.pdfFit === "boolean") next.pdfFit = input.pdfFit;
  return next;
}
const validScope = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 128;
const validPath = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 4096 && isDocument(value);
export function createDocumentStore(storage: { read(): unknown; write(value: unknown): void }) {
  const sessions = new Map<string, DocumentSession>(),
    listeners = new Set<() => void>();
  try {
    const saved = storage.read();
    if (Array.isArray(saved))
      for (const record of saved.slice(-128)) {
        if (!record || typeof record !== "object") continue;
        const { hostId, workspaceId, path, view } = record;
        if (!validScope(hostId) || !validScope(workspaceId) || !validPath(path)) continue;
        const id = documentKey(hostId, workspaceId, path);
        sessions.set(id, {
          id,
          hostId,
          workspaceId,
          path,
          revision: 1,
          view: cleanDocumentView(view),
        });
      }
  } catch {
    /* Storage is optional; live tabs still work. */
  }
  const changed = () => {
    try {
      storage.write(
        [...sessions.values()]
          .slice(-128)
          .map(({ hostId, workspaceId, path, view }) => ({ hostId, workspaceId, path, view })),
      );
    } catch {
      /* Opening a file must work with full or disabled storage. */
    }
    for (const listener of listeners) listener();
  };
  return {
    all: () => [...sessions.values()],
    get: (id: string) => sessions.get(id) ?? null,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    open(hostId: string, workspaceId: string, path: string, page?: number) {
      if (!validScope(hostId) || !validScope(workspaceId) || !validPath(path))
        throw new Error("Select an HTML or PDF file.");
      const id = documentKey(hostId, workspaceId, path),
        existing = sessions.get(id);
      const targetPage = Number.isSafeInteger(page) && Number(page) > 0 ? Number(page) : undefined;
      if (existing && targetPage === undefined) return existing;
      const session = existing
        ? {
            ...existing,
            revision: existing.revision + 1,
            view: {
              ...existing.view,
              page: targetPage ?? existing.view.page,
              scrollX: 0,
              scrollY: 0,
            },
          }
        : {
            id,
            hostId,
            workspaceId,
            path,
            revision: 1,
            view: { ...defaultDocumentView(), ...(targetPage ? { page: targetPage } : {}) },
          };
      sessions.set(id, session);
      changed();
      return session;
    },
    updateView(id: string, patch: Partial<DocumentView>) {
      const existing = sessions.get(id);
      if (!existing) return;
      const view = cleanDocumentView(patch, existing.view);
      if (
        (Object.keys(view) as (keyof DocumentView)[]).every(
          (key) => view[key] === existing.view[key],
        )
      )
        return;
      sessions.set(id, { ...existing, view });
      changed();
    },
    reload(id: string) {
      const existing = sessions.get(id);
      if (!existing) return;
      sessions.set(id, { ...existing, revision: existing.revision + 1 });
      changed();
    },
  };
}
