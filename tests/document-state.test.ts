import assert from "node:assert/strict";
import test from "node:test";
import {
  createDocumentStore,
  documentKey,
  documentPanelId,
  cleanDocumentView,
} from "../shared/document-state";

function fixture(initial: unknown = []) {
  let saved = initial;
  const storage = {
    read: () => saved,
    write: (value: unknown) => {
      saved = structuredClone(value);
    },
  };
  return {
    store: createDocumentStore(storage),
    restore: () => createDocumentStore(storage),
    saved: () => saved,
  };
}
test("two files have distinct native panel identities and reopening focuses the existing document", () => {
  const { store } = fixture();
  const html = store.open("host", "workspace", "course/a.html");
  const pdf = store.open("host", "workspace", "course/a.pdf", 2);
  assert.notEqual(documentPanelId(html.path), documentPanelId(pdf.path));
  assert.match(documentPanelId(html.path), /^[a-z][a-z0-9-]*$/);
  store.updateView(html.id, { htmlZoom: 1.7, scrollY: 800 });
  const before = store.get(html.id);
  assert.equal(store.open("host", "workspace", html.path), before);
  assert.equal(store.all().length, 2);
  assert.equal(store.get(html.id)?.view.htmlZoom, 1.7);
  assert.equal(store.get(pdf.id)?.view.page, 2);
});
test("page, zoom and scroll survive tab closure and browser reload independently", () => {
  const f = fixture(),
    a = f.store.open("h", "w", "first.pdf"),
    b = f.store.open("h", "w", "second.pdf");
  f.store.updateView(a.id, { page: 20, pdfZoom: 1.8, pdfFit: false, scrollY: 240 });
  f.store.updateView(b.id, { page: 3, pdfZoom: 0.8, pdfFit: true, scrollY: 10 });
  const restored = f.restore();
  assert.deepEqual(restored.get(a.id)?.view, f.store.get(a.id)?.view);
  assert.deepEqual(restored.get(b.id)?.view, f.store.get(b.id)?.view);
  assert.equal(restored.open("h", "w", "first.pdf").view.page, 20);
});
test("the same relative filename on different workspaces or hosts never shares reading state", () => {
  const { store } = fixture();
  const a = store.open("h1", "w1", "demo.html"),
    b = store.open("h1", "w2", "demo.html"),
    c = store.open("h2", "w1", "demo.html");
  store.updateView(a.id, { htmlZoom: 2 });
  assert.equal(store.get(b.id)?.view.htmlZoom, 1);
  assert.equal(store.get(c.id)?.view.htmlZoom, 1);
  assert.equal(store.get(documentKey("h1", "w1", "demo.html"))?.view.htmlZoom, 2);
});
test("an explicit PDF page link moves only its target tab without resetting other documents or zoom", () => {
  const { store } = fixture();
  const a = store.open("h", "w", "a.pdf"),
    b = store.open("h", "w", "b.pdf");
  store.updateView(a.id, { pdfZoom: 1.5, pdfFit: false, scrollY: 400 });
  const moved = store.open("h", "w", "a.pdf", 9);
  assert.equal(moved.view.page, 9);
  assert.equal(moved.view.pdfZoom, 1.5);
  assert.equal(moved.view.scrollY, 0);
  assert.equal(store.get(b.id)?.view.page, 1);
  store.reload(a.id);
  assert.equal(store.get(a.id)?.revision, moved.revision + 1);
  assert.equal(store.get(a.id)?.view.page, 9);
});
test("untrusted frame state and damaged or disabled storage cannot break document opening", () => {
  const safe = cleanDocumentView({
    page: -1,
    htmlZoom: Infinity,
    pdfZoom: 50,
    pdfFit: "false",
    scrollY: NaN,
  });
  assert.deepEqual(safe, cleanDocumentView(null));
  const f = fixture([
    { hostId: "h", workspaceId: "w", path: "notes.txt" },
    { hostId: "h", workspaceId: "w", path: "ok.pdf", view: { page: 2, pdfZoom: -8 } },
  ]);
  assert.equal(f.store.all().length, 1);
  assert.equal(f.store.all()[0].view.page, 2);
  assert.equal(f.store.all()[0].view.pdfZoom, 1);
  const unavailable = createDocumentStore({
    read: () => {
      throw Error("disabled");
    },
    write: () => {
      throw Error("full");
    },
  });
  assert.equal(unavailable.open("h", "w", "ok.html").view.htmlZoom, 1);
  assert.throws(() => unavailable.open("h", "w", "notes.txt"));
});
