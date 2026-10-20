import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { URL as NodeURL } from "node:url";
import type { DocumentView } from "../shared/document-state";

const source = (await readFile(new NodeURL("../viewer/pdf.js", import.meta.url), "utf8")).replace(
  /^import[^\n]+\n/,
  "",
);
async function viewer({ count = 20, hidden = false, page = 1, slowTextPage = 0 } = {}) {
  const listeners = new Map<string, ((event: unknown) => void)[]>();
  const messages: Record<string, unknown>[] = [];
  const scheduled = new Map<number, () => void>();
  let serial = 0;
  let onResize: (() => void) | undefined;
  class Element {
    style = { width: "", height: "", paddingBottom: "", setProperty() {} };
    dataset: Record<string, string | number> = {};
    children: Element[] = [];
    handlers = new Map<string, () => void>();
    textContent = "";
    value: string | number = "";
    clientWidth = 600;
    clientHeight = 700;
    scrollTop = 0;
    scrollLeft = 0;
    width = 0;
    height = 0;
    onclick?: () => void;
    onchange?: () => void;
    constructor(readonly id = "") {}
    get childElementCount() {
      return this.children.length;
    }
    get scrollHeight() {
      const entries = nodes.get("pages")?.children ?? [];
      return Math.max(
        this.clientHeight,
        entries.reduce((sum, entry) => sum + (parseFloat(entry.style.height) || 0) + 20, 20) +
          (parseFloat(nodes.get("pages")?.style.paddingBottom ?? "") || 0),
      );
    }
    setAttribute() {}
    addEventListener(type: string, callback: () => void) {
      this.handlers.set(type, callback);
    }
    appendChild(child: Element) {
      this.children.push(child);
    }
    replaceChildren(...children: Element[]) {
      this.children = children;
    }
    getContext() {
      return {};
    }
    scrollTo(x: number, y: number) {
      this.scrollLeft = x;
      this.scrollTop = Math.round(Math.max(0, Math.min(y, this.scrollHeight - this.clientHeight)));
      this.handlers.get("scroll")?.();
    }
    scrollBy(x: number, y: number) {
      this.scrollTo(this.scrollLeft + x, this.scrollTop + y);
    }
  }
  const nodes = new Map<string, Element>();
  const node = (id: string) => {
    const existing = nodes.get(id);
    if (existing) return existing;
    const element = new Element(id);
    nodes.set(id, element);
    return element;
  };
  node("pages");
  node("scroll").clientWidth = hidden ? 0 : 600;
  const renders: number[] = [],
    cancelledText: number[] = [];
  const pdfPages = Array.from({ length: count }, (_, i) => ({
    userUnit: 1,
    // A landscape page also exercises geometry rather than assuming A4 throughout.
    getViewport: ({ scale }: { scale: number }) => ({
      width: (i === 4 ? 842 : 595) * scale,
      height: (i === 4 ? 595 : 842) * scale,
    }),
    render: () => {
      renders.push(i + 1);
      return { promise: Promise.resolve(), cancel() {} };
    },
    getTextContent: async () => ({ items: [{ str: `fixture-${i + 1}` }] }),
    streamTextContent: () =>
      new ReadableStream({
        start(controller) {
          if (i + 1 === slowTextPage) return;
          controller.enqueue({ items: [{ str: `fixture-${i + 1}` }] });
          controller.close();
        },
        cancel() {
          cancelledText.push(i + 1);
        },
      }),
    cleanup() {},
  }));
  const parent = { postMessage: (message: Record<string, unknown>) => messages.push(message) };
  const schedule = (fn: () => void) => {
    scheduled.set(++serial, fn);
    return serial;
  };
  runInNewContext(source, {
    pdfjs: {
      GlobalWorkerOptions: {},
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: count,
          getPage: async (n: number) => pdfPages[n - 1],
        }),
        destroy() {},
      }),
      TextLayer: class {
        reader?: ReadableStreamDefaultReader<{ items: { str: string }[] }>;
        constructor(
          readonly options: {
            container: Element;
            textContentSource: ReadableStream<{ items: { str: string }[] }>;
          },
        ) {}
        async render() {
          this.reader = this.options.textContentSource.getReader();
          while (true) {
            const chunk = await this.reader.read();
            if (chunk.done) return;
            for (const item of chunk.value.items) {
              const span = new Element();
              span.textContent = item.str;
              this.options.container.appendChild(span);
            }
          }
        }
        cancel() {
          void this.reader?.cancel();
        }
      },
    },
    navigator: { language: "ko" },
    document: { getElementById: node, createElement: () => new Element() },
    window: { __PDF_DOCUMENT__: { data: "AA==", worker: "AA==", page } },
    parent,
    atob,
    Uint8Array,
    Blob,
    URL: { createObjectURL: () => "blob:fixture", revokeObjectURL() {} },
    devicePixelRatio: 1,
    setTimeout: schedule,
    clearTimeout: (id: number) => scheduled.delete(id),
    requestAnimationFrame: schedule,
    cancelAnimationFrame: (id: number) => scheduled.delete(id),
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
  const flush = async () => {
    for (let i = 0; i < 5; i++) {
      await new Promise(setImmediate);
      for (const [id, fn] of scheduled) {
        scheduled.delete(id);
        fn();
      }
    }
  };
  const restore = (view: Record<string, unknown>) => {
    for (const fn of listeners.get("message") ?? [])
      fn({ source: parent, data: { channel: "paseo-doc-restore", view } });
  };
  const key = (key: string) => {
    for (const fn of listeners.get("keydown") ?? [])
      fn({ key, target: { tagName: "MAIN" }, preventDefault() {} });
  };
  await flush();
  return {
    node,
    renders,
    cancelledText,
    messages,
    flush,
    restore,
    key,
    resize: () => onResize?.(),
    state: () => {
      const state = messages.filter((m) => m.channel === "paseo-doc-view-state").at(-1)?.view;
      assert.ok(state);
      return state as DocumentView;
    },
  };
}

test("a restored PDF with fixed zoom renders when its hidden tab receives a viewport", async () => {
  const v = await viewer({ hidden: true });
  v.restore({ page: 3, pdfZoom: 1.8, pdfFit: false, scrollX: 0, scrollY: 300 });
  await v.flush();
  assert.equal(v.messages.filter((m) => m.channel === "paseo-doc-ready").length, 0);
  v.node("scroll").clientWidth = 600;
  v.resize();
  await v.flush();
  const ready = v.messages.find((m) => m.channel === "paseo-doc-ready");
  assert.ok(ready, "restoring a fixed zoom must not leave the visible PDF loading forever");
  assert.equal(ready.page, 3);
  assert.equal(ready.scale, 1.8);
  assert.equal(ready.fit, false);
  assert.equal(v.state().scrollY, 300);
  assert.ok(v.node("scroll").scrollTop > 300, "the saved offset is relative to page 3");
});

test("scrolling crosses pages, updates the page field and releases distant canvases", async () => {
  const v = await viewer();
  assert.equal(v.node("pages").children.length, 20);
  assert.ok(v.renders.length <= 3, "opening a long PDF must not paint every page");
  const page8 = v.node("pages").children[7];
  v.node("number").value = "8";
  v.node("number").onchange?.();
  await v.flush();
  assert.equal(v.state().page, 8);
  assert.ok(page8.children.length > 0);
  assert.equal(v.node("pages").children[0].children.length, 0);
  v.node("scroll").scrollBy(0, parseFloat(page8.style.height) + 20 + 100);
  await v.flush();
  assert.equal(v.state().page, 9);
  assert.equal(v.node("number").value, 9);
  assert.ok(Math.abs(v.state().scrollY - 100) < 0.001);
  assert.ok(v.node("pages").children.filter((entry) => entry.children.length).length <= 4);
  v.node("prev").onclick?.();
  await v.flush();
  assert.equal(v.state().page, 8);
  assert.equal(v.state().scrollY, 0);
});

test("zoom keeps the current page and reading position, including mixed page sizes", async () => {
  const v = await viewer();
  v.restore({ page: 5, pdfFit: false, pdfZoom: 1, scrollX: 0, scrollY: 200 });
  await v.flush();
  v.node("in").onclick?.();
  await v.flush();
  assert.equal(v.state().page, 5);
  assert.equal(v.state().pdfZoom, 1.2);
  assert.ok(Math.abs(v.state().scrollY - 240) < 0.001);
  assert.equal(parseFloat(v.node("pages").children[4].style.height), 595 * 1.2);
});

test("search and keyboard navigation still reach other pages in the continuous document", async () => {
  const v = await viewer();
  v.node("search").value = "fixture-12";
  await v.node("find").onclick?.();
  await v.flush();
  assert.equal(v.state().page, 12);
  const beforeScroll = v.node("scroll").scrollTop;
  v.key("PageDown");
  await v.flush();
  assert.equal(v.node("scroll").scrollTop - beforeScroll, v.node("scroll").clientHeight * 0.9);
  const afterScroll = v.state().page;
  v.key("ArrowRight");
  await v.flush();
  assert.equal(v.state().page, afterScroll + 1);
  v.key("ArrowLeft");
  await v.flush();
  assert.equal(v.state().page, afterScroll);
});

test("short final pages and their preceding pages remain individually reachable", async () => {
  for (const count of [2, 6]) {
    const v = await viewer({ count });
    v.restore({ page: count, pdfFit: false, pdfZoom: 0.25, scrollX: 0, scrollY: 0 });
    await v.flush();
    assert.equal(v.state().page, count);
    assert.ok(v.node("pages").children[count - 1].children.length > 0);
    v.node("prev").onclick?.();
    await v.flush();
    assert.equal(v.state().page, count - 1);
    v.node("next").onclick?.();
    await v.flush();
    assert.equal(v.state().page, count);
    v.node("number").value = String(count - 1);
    v.node("number").onchange?.();
    await v.flush();
    assert.equal(v.state().page, count - 1);
    v.node("next").onclick?.();
    await v.flush();
    v.node("scroll").clientHeight = 1000;
    // A real browser clamps the old scroll position before delivering resize.
    v.node("scroll").scrollTo(0, v.node("scroll").scrollTop);
    v.resize();
    await v.flush();
    assert.equal(v.state().page, count);
    assert.equal(v.state().scrollY, 0);
  }
});

test("restoring fitted positions rescales the page offset in visible and hidden tabs", async () => {
  for (const hidden of [false, true]) {
    const v = await viewer({ hidden });
    v.restore({ page: 7, pdfFit: true, pdfZoom: 1.8, scrollX: 0, scrollY: 850 });
    v.node("scroll").clientWidth = 600;
    v.resize();
    await v.flush();
    assert.equal(v.state().page, 7);
    assert.ok(Math.abs(v.state().scrollY - (850 * (560 / 842)) / 1.8) <= 1);
    v.node("scroll").clientWidth = 450;
    v.resize();
    await v.flush();
    assert.equal(v.state().page, 7);
    assert.ok(Math.abs(v.state().scrollY - (850 * (410 / 842)) / 1.8) <= 1);
  }
});

test("slow text cannot block adjacent pages, and is cancelled after a distant jump", async () => {
  const v = await viewer({ slowTextPage: 1 });
  assert.ok(v.renders.includes(1));
  v.node("next").onclick?.();
  await v.flush();
  assert.equal(v.state().page, 2);
  assert.ok(v.renders.includes(2));
  assert.equal(v.node("pages").children[0].children[1].childElementCount, 0);
  assert.equal(v.cancelledText.length, 0, "page 1 is still cached with its text stream pending");
  let ready = v.messages.filter((m) => m.channel === "paseo-doc-ready").at(-1);
  assert.equal(ready?.page, 2);
  assert.ok(Number(ready?.textItems) > 0, "page 2 must finish while page 1's text remains pending");
  v.node("number").value = "12";
  v.node("number").onchange?.();
  await v.flush();
  assert.ok(v.cancelledText.includes(1));
  assert.ok(v.renders.includes(12), "page 12 must paint before page 1 has produced any text");
  ready = v.messages.filter((m) => m.channel === "paseo-doc-ready").at(-1);
  assert.equal(ready?.page, 12);
  assert.equal(v.state().page, 12);
});

test("fit width includes the widest page in a mixed-orientation document", async () => {
  const v = await viewer();
  v.restore({ page: 5, pdfFit: false, pdfZoom: 2, scrollX: 0, scrollY: 100 });
  await v.flush();
  v.node("fit").onclick?.();
  await v.flush();
  assert.equal(v.state().page, 5);
  for (const page of v.node("pages").children)
    assert.ok(parseFloat(page.style.width) <= v.node("scroll").clientWidth - 40);
  assert.equal(v.state().pdfZoom, 560 / 842);
});
