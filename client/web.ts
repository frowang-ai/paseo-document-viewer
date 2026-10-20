import { Platform } from "react-native";
import { getPaseoClient } from "@getpaseo/plugin/client";
import { isDocument, treePath } from "../shared/documents";
import type { DocumentView } from "../shared/document-state";
declare const navigator: { language: string };
export function uiLanguage() {
  return Platform.OS === "web" && navigator.language.startsWith("ko") ? "ko" : "en";
}

type WebEvent = {
  target: WebElement;
  key?: string;
  button?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  source?: unknown;
  data?: Record<string, unknown>;
  preventDefault(): void;
  stopPropagation(): void;
  stopImmediatePropagation(): void;
};
type WebElement = {
  textContent: string | null;
  style: Record<string, string>;
  srcdoc: string;
  contentWindow: { postMessage(value: unknown, target: string): void } | null;
  closest(selector: string): WebElement | null;
  querySelector(selector: string): WebElement | null;
  querySelectorAll(selector: string): ArrayLike<WebElement>;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  appendChild(child: WebElement): void;
  remove(): void;
  checkVisibility(): boolean;
};
declare const document: {
  createElement(tag: string): WebElement;
  addEventListener(type: string, listener: (event: WebEvent) => void, capture?: boolean): void;
  removeEventListener(type: string, listener: (event: WebEvent) => void, capture?: boolean): void;
};
declare const window: {
  location: { pathname: string };
  getComputedStyle(element: WebElement): { paddingLeft: string };
  addEventListener(type: string, listener: (event: WebEvent) => void): void;
  removeEventListener(type: string, listener: (event: WebEvent) => void): void;
  atob(value: string): string;
  getSelection(): { isCollapsed: boolean } | null;
  localStorage: { getItem(key: string): string | null; setItem(key: string, value: string): void };
};

export function readLastDocument(key: string): { path: string; page?: number } | null {
  if (Platform.OS !== "web") return null;
  try {
    const value = JSON.parse(window.localStorage.getItem("paseo-documents:" + key) ?? "null");
    return typeof value?.path === "string" && value.path.length <= 4096 && isDocument(value.path)
      ? {
          path: value.path,
          ...(Number.isSafeInteger(value.page) && value.page > 0 ? { page: value.page } : {}),
        }
      : null;
  } catch {
    return null;
  }
}
export function writeLastDocument(key: string, path: string, page?: number) {
  if (Platform.OS !== "web") return;
  try {
    window.localStorage.setItem("paseo-documents:" + key, JSON.stringify({ path, page }));
  } catch {}
}

export function readDocumentSessions(): unknown {
  if (Platform.OS !== "web") return [];
  try {
    return JSON.parse(window.localStorage.getItem("paseo-document-tabs:v1") ?? "[]");
  } catch {
    return [];
  }
}
export function writeDocumentSessions(value: unknown) {
  if (Platform.OS === "web")
    window.localStorage.setItem("paseo-document-tabs:v1", JSON.stringify(value));
}
export async function activeWorkspace(host: string): Promise<string> {
  if (Platform.OS !== "web") throw new Error("문서 뷰어는 데스크톱·웹에서 열 수 있습니다.");
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts[0] !== "h" || parts[1] !== host)
    throw new Error("현재 호스트의 워크스페이스를 먼저 선택하세요.");
  if (parts[2] === "workspace" && parts[3]) return parts[3];
  if (parts[2] === "agent" && parts[3]) {
    const agent = getPaseoClient(host).agents.ref(parts[3]);
    await agent.refresh();
    if (agent.workspaceId) return agent.workspaceId;
  }
  throw new Error("워크스페이스를 먼저 선택하세요.");
}

/** DOM adapter shared by Paseo 0.11.x and 0.12.x; no app internals or React fibers. */
export function captureDocumentClicks(
  host: string,
  open: (workspace: string, path: string) => void,
) {
  if (Platform.OS !== "web") return () => {};
  const capture = (event: WebEvent) => {
    if (event.key && !["Enter", " "].includes(event.key)) return;
    if (
      (event.button && event.button !== 0) ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    if (window.getSelection()?.isCollapsed === false) return;
    const row = event.target.closest('[data-testid^="file-explorer-row-"][aria-selected]');
    const tree = row?.closest('[data-testid="file-explorer-tree-scroll"]');
    if (!row || !tree || !row.checkVisibility()) return;
    const nodes = Array.from(
      tree.querySelectorAll('[data-testid^="file-explorer-row-"][aria-selected]'),
    ).filter((e) => e.checkVisibility());
    const index = nodes.indexOf(row);
    const path = treePath(
      nodes.map((e) => ({
        name: e.querySelector('[data-testid$="-name"]')?.textContent ?? "",
        indent: Number.parseFloat(window.getComputedStyle(e).paddingLeft),
      })),
      index,
    );
    if (!path || !isDocument(path)) return;
    const parts = window.location.pathname.split("/").filter(Boolean);
    if (parts[0] !== "h" || parts[1] !== host || !["workspace", "agent"].includes(parts[2])) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    void activeWorkspace(host)
      .then((workspace) => open(workspace, path))
      .catch(() => {});
  };
  document.addEventListener("click", capture, true);
  document.addEventListener("keydown", capture, true);
  return () => {
    document.removeEventListener("click", capture, true);
    document.removeEventListener("keydown", capture, true);
  };
}

export function decodeChunks(chunks: string[]): string {
  if (Platform.OS !== "web") return "";
  const parts = chunks.map((value) => Uint8Array.from(window.atob(value), (c) => c.charCodeAt(0)));
  const data = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    data.set(part, offset);
    offset += part.length;
  }
  return new TextDecoder().decode(data);
}
declare class TextDecoder {
  decode(value: Uint8Array): string;
}

export function mountDocument(
  host: unknown,
  html: string,
  name: string,
  kind: string,
  asset: (kind: "cmaps" | "standard_fonts" | "wasm", name: string) => Promise<{ base64: string }>,
  open: (href: string) => void,
  onZoom: (scale: number) => void,
  initialView?: DocumentView,
  onView?: (view: Partial<DocumentView>) => void,
) {
  if (Platform.OS !== "web" || !host) return () => {};
  const frame = document.createElement("iframe");
  frame.setAttribute("title", name);
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.setAttribute("data-testid", "document-preview");
  frame.setAttribute("data-kind", kind);
  frame.style.width = "100%";
  frame.style.height = "100%";
  frame.style.flex = "1";
  frame.style.border = "0";
  frame.style.backgroundColor = "white";
  frame.srcdoc = html;
  let alive = true;
  let requests = 0;
  const restore = () =>
    frame.contentWindow?.postMessage({ channel: "paseo-doc-restore", view: initialView }, "*");
  const message = (event: WebEvent) => {
    if (event.source !== frame.contentWindow || !event.data) return;
    const data = event.data;
    if (data.channel === "paseo-doc-initialized") {
      restore();
      return;
    }
    if (data.channel === "paseo-doc-view-state" && data.view && typeof data.view === "object") {
      onView?.(data.view as Partial<DocumentView>);
      return;
    }
    if (
      data.channel === "paseo-doc-zoom-state" &&
      typeof data.scale === "number" &&
      Number.isFinite(data.scale) &&
      data.scale >= 0.5 &&
      data.scale <= 3
    ) {
      frame.setAttribute("data-applied-zoom", String(data.scale));
      onZoom(data.scale);
      return;
    }
    if (
      data.channel === "paseo-doc-open" &&
      typeof data.href === "string" &&
      data.href.length <= 4096
    ) {
      open(data.href);
      return;
    }
    if (data.channel === "paseo-doc-html-ready") {
      for (const field of ["images", "total", "math"])
        if (typeof data[field] === "number")
          frame.setAttribute("data-" + field, String(data[field]));
      frame.setAttribute("data-ready", "true");
      restore();
      frame.contentWindow?.postMessage(
        {
          channel: "paseo-doc-zoom",
          scale: Number(frame.getAttribute("data-requested-zoom") ?? 1),
        },
        "*",
      );
      for (const field of ["margin", "background"])
        if (typeof data[field] === "string" && data[field].length < 100)
          frame.setAttribute("data-body-" + field, data[field]);
      return;
    }
    if (
      data.channel === "paseo-doc-ready" &&
      typeof data.page === "number" &&
      typeof data.pages === "number"
    ) {
      frame.setAttribute("data-page", String(data.page));
      frame.setAttribute("data-pages", String(data.pages));
      if (typeof data.scale === "number") frame.setAttribute("data-pdf-zoom", String(data.scale));
      for (const field of ["scrollHeight", "scrollViewport", "scrollTop"])
        if (typeof data[field] === "number")
          frame.setAttribute(`data-${field.toLowerCase()}`, String(data[field]));
      onView?.({
        page: Number(data.page),
        pdfZoom: Number(data.scale),
        pdfFit: typeof data.fit === "boolean" ? data.fit : undefined,
      });
      if (typeof data.textItems === "number")
        frame.setAttribute("data-text-items", String(data.textItems));
      return;
    }
    if (
      data.channel !== "paseo-doc-pdf" ||
      !["cmaps", "standard_fonts", "wasm"].includes(String(data.kind)) ||
      typeof data.name !== "string" ||
      typeof data.id !== "number" ||
      requests >= 128
    )
      return;
    requests++;
    void asset(data.kind as "cmaps" | "standard_fonts" | "wasm", data.name)
      .then((result) => {
        if (alive)
          frame.contentWindow?.postMessage(
            { channel: "paseo-doc-pdf-result", id: data.id, ...result },
            "*",
          );
      })
      .catch(() => {
        if (alive)
          frame.contentWindow?.postMessage(
            {
              channel: "paseo-doc-pdf-result",
              id: data.id,
              error: "PDF 리소스를 읽지 못했습니다.",
            },
            "*",
          );
      })
      .finally(() => {
        requests--;
      });
  };
  window.addEventListener("message", message);
  (host as WebElement).appendChild(frame);
  return () => {
    alive = false;
    window.removeEventListener("message", message);
    frame.remove();
  };
}

export function updateHtmlZoom(host: unknown, scale: number) {
  if (Platform.OS !== "web" || !host) return;
  const frame = (host as WebElement).querySelector('iframe[data-kind="html"]');
  if (!frame) return;
  frame.setAttribute("data-requested-zoom", String(scale));
  frame.contentWindow?.postMessage({ channel: "paseo-doc-zoom", scale }, "*");
}
