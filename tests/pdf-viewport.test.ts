import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { URL as NodeURL } from "node:url";

test("a restored PDF with fixed zoom renders when its hidden tab receives a viewport", async () => {
  const source = (await readFile(new NodeURL("../viewer/pdf.js", import.meta.url), "utf8")).replace(
    /^import[^\n]+\n/,
    "",
  );
  const listeners = new Map<string, ((event: unknown) => void)[]>();
  const messages: Record<string, unknown>[] = [];
  let onResize: (() => void) | undefined;
  const nodes = new Map<string, Record<string, unknown>>();
  const node = (id: string) => {
    if (!nodes.has(id))
      nodes.set(id, {
        style: { setProperty() {} },
        textContent: "",
        value: "",
        childElementCount: 0,
        clientWidth: 600,
        clientHeight: 700,
        scrollHeight: 2000,
        scrollTop: 0,
        scrollLeft: 0,
        dataset: {},
        setAttribute() {},
        addEventListener() {},
        replaceChildren() {},
        getContext: () => ({}),
        scrollTo(x: number, y: number) {
          this.scrollLeft = x;
          this.scrollTop = y;
        },
      });
    return nodes.get(id) as Record<string, unknown>;
  };
  node("scroll").clientWidth = 0;
  const page = {
    userUnit: 1,
    getViewport: ({ scale }: { scale: number }) => ({ width: 595 * scale, height: 842 * scale }),
    render: () => ({ promise: Promise.resolve(), cancel() {} }),
    getTextContent: async () => ({ items: [{ str: "fixture" }] }),
  };
  const parent = { postMessage: (message: Record<string, unknown>) => messages.push(message) };
  runInNewContext(source, {
    pdfjs: {
      GlobalWorkerOptions: {},
      getDocument: () => ({
        promise: Promise.resolve({ numPages: 2, getPage: async () => page }),
        destroy() {},
      }),
      TextLayer: class {
        async render() {
          node("text").childElementCount = 1;
        }
        cancel() {}
      },
    },
    navigator: { language: "ko" },
    document: {
      getElementById: node,
      querySelector: (selector: string) => node(selector === "canvas" ? "canvas" : "text"),
    },
    window: { __PDF_DOCUMENT__: { data: "AA==", worker: "AA==", page: 1 } },
    parent,
    atob,
    Uint8Array,
    Blob,
    URL: { createObjectURL: () => "blob:fixture", revokeObjectURL() {} },
    devicePixelRatio: 1,
    setTimeout,
    clearTimeout,
    addEventListener: (type: string, fn: (event: unknown) => void) =>
      listeners.set(type, [...(listeners.get(type) ?? []), fn]),
    ResizeObserver: class {
      constructor(callback: () => void) {
        onResize = callback;
      }
      observe() {}
      disconnect() {}
    },
  });
  for (const fn of listeners.get("message") ?? [])
    fn({
      source: parent,
      data: {
        channel: "paseo-doc-restore",
        view: { page: 1, pdfZoom: 1.8, pdfFit: false, scrollX: 0, scrollY: 300 },
      },
    });
  await new Promise(setImmediate);
  assert.equal(messages.filter((m) => m.channel === "paseo-doc-ready").length, 0);
  node("scroll").clientWidth = 600;
  onResize?.();
  await new Promise(setImmediate);
  const ready = messages.find((m) => m.channel === "paseo-doc-ready");
  assert.ok(ready, "restoring an absolute zoom must not leave the visible PDF loading forever");
  assert.equal(ready.page, 1);
  assert.equal(ready.scale, 1.8);
  assert.equal(ready.fit, false);
  assert.equal(node("scroll").scrollTop, 300);
});
