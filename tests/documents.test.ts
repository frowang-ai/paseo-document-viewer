import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Script } from "node:vm";
import { PDF_VIEWER_HTML } from "../server/assets.generated";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { load } from "cheerio";
import { prepareHtml, safeFile } from "../server/html";
import { chunk, clearDocuments, list, pdfAsset, prepare } from "../server/documents";
import { isDocument, treePath, documentLink } from "../shared/documents";

test("HTML source links open the sibling PDF and preserve its page anchor", () => {
  assert.deepEqual(documentLink("2026/머신러닝/lesson.html", "lecture.pdf#page=20"), {
    path: "2026/머신러닝/lecture.pdf",
    page: 20,
  });
  for (const href of [
    "javascript:evil.pdf",
    "https://example.com/a.pdf",
    "file:///private.pdf",
    "../../../private.pdf",
    "lecture.pdf#page=-1",
    "lecture.html#page=1",
  ])
    assert.equal(documentLink("2026/lesson.html", href), null);
});

test("PDF runtime remains valid JavaScript after template assembly", async () => {
  const $ = load(PDF_VIEWER_HTML);
  assert.doesNotThrow(() => new Script($("script").last().text()));
});

test("HTML: separate CSS, image, JavaScript and LaTeX become a self-contained preview", async () => {
  const root = await mkdtemp(join(tmpdir(), "paseo-doc-test-"));
  try {
    await mkdir(join(root, "page.assets"));
    await writeFile(
      join(root, "page.assets", "page.css"),
      'body{margin:0;color:rgb(1,2,3)}.pic{background:url("pic.png")}',
    );
    await writeFile(join(root, "page.assets", "pic.png"), Buffer.from([137, 80, 78, 71]));
    await writeFile(join(root, "page.assets", "page.js"), 'document.body.dataset.ready="yes";');
    const file = join(root, "page.html");
    await writeFile(
      file,
      '<!doctype html><link rel="stylesheet" href="page.assets/page.css"><p>$\\boldsymbol{\\theta}$</p><pre>$unprocessed$</pre><img src="page.assets/pic.png"><script src="page.assets/page.js"></script>',
    );
    const result = await prepareHtml(file);
    const $ = load(result.html);
    assert.equal(result.warnings.length, 0);
    assert.match($("style").text(), /color:rgb\(1,2,3\)/);
    assert.match($("img").attr("src") ?? "", /^data:image\/png;base64,/);
    assert.match($("script").text(), /dataset.ready/);
    assert.equal($("link[rel=stylesheet],script[src]").length, 0);
    assert.equal($("mjx-container svg").length, 1);
    assert.equal($("pre").text(), "$unprocessed$");
    assert.match(result.html, /^<!doctype html><meta http-equiv="Content-Security-Policy"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("HTML: remote, traversing and symlink assets are not embedded", async () => {
  const root = await mkdtemp(join(tmpdir(), "paseo-doc-boundary-"));
  try {
    await mkdir(join(root, "doc"));
    await writeFile(join(root, "private.js"), "PRIVATE_SENTINEL");
    await symlink(join(root, "private.js"), join(root, "doc", "link.js"));
    const file = join(root, "doc", "page.html");
    await writeFile(
      file,
      '<base href="https://invalid.example/"><meta http-equiv="refresh" content="0;url=https://invalid.example"><script src="../private.js"></script><script src="link.js"></script><img src="https://invalid.example/x.png"><iframe src="https://invalid.example"></iframe><p>ok</p>',
    );
    const result = await prepareHtml(file);
    const $ = load(result.html);
    assert.doesNotMatch(result.html, /PRIVATE_SENTINEL/);
    assert.equal($("base,iframe,script[src]").length, 0);
    assert.ok(result.warnings.length > 0);
    await assert.rejects(safeFile(join(root, "doc"), "../private.js"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("file click path: nested rows and siblings resolve the actual relative path", () => {
  const rows = [
    { name: "2025", indent: 8 },
    { name: "old.pdf", indent: 24 },
    { name: "2026", indent: 8 },
    { name: "머신러닝", indent: 24 },
    { name: "강의교안", indent: 40 },
    { name: "week.html", indent: 56 },
    { name: "week.pdf", indent: 56 },
  ];
  assert.equal(treePath(rows, 6), "2026/머신러닝/강의교안/week.pdf");
  assert.equal(treePath([{ name: "../private", indent: 8 }], 0), null);
  assert.ok(isDocument("PAGE.PDF"));
  assert.ok(isDocument("page.htm"));
  assert.ok(!isDocument("page.pdf.exe"));
});
test("document RPC: listing, PDF preparation, scoped chunks and expiration cleanup", async () => {
  const root = await mkdtemp(join(tmpdir(), "paseo-doc-rpc-"));
  const context = {
    paseo: { workspaces: { ref: () => ({ refresh: async () => ({ workspaceDirectory: root }) }) } },
  } as unknown as PluginHandlerContext;
  try {
    await writeFile(join(root, "one.pdf"), "%PDF-1.4\nfixture");
    await writeFile(join(root, "skip.txt"), "skip");
    const found = await list({ workspaceId: "workspace", path: "." }, context);
    assert.deepEqual(
      found.entries.map((e) => e.name),
      ["one.pdf"],
    );
    const doc = await prepare({ workspaceId: "workspace", path: "one.pdf", page: 20 }, context);
    assert.equal(doc.kind, "pdf");
    assert.throws(() => chunk({ workspaceId: "other", id: doc.id, offset: 0 }));
    assert.throws(() => chunk({ workspaceId: "workspace", id: doc.id, offset: doc.bytes }));
    const pieces: Buffer[] = [];
    let offset = 0;
    while (offset < doc.bytes) {
      const part = chunk({ workspaceId: "workspace", id: doc.id, offset });
      pieces.push(Buffer.from(part.base64, "base64"));
      offset = part.next;
    }
    assert.equal(Buffer.concat(pieces).length, doc.bytes);
    assert.match(Buffer.concat(pieces).toString(), /page:20/);
    await assert.rejects(pdfAsset({ kind: "cmaps", name: "../package.json" }));
    clearDocuments();
    assert.throws(() => chunk({ workspaceId: "workspace", id: doc.id, offset: 0 }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
