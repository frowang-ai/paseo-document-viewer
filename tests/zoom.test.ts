import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { HTML_BRIDGE } from "../server/html-bridge";
import { nextHtmlZoom } from "../shared/zoom";

test("HTML keyboard zoom and reset remain inside the document", () => {
  const events = new Map<string, (event: unknown) => void>();
  const style: { zoom?: string } = {};
  let prevented = 0;
  runInNewContext(HTML_BRIDGE, {
    parent: { postMessage: () => {} },
    document: {
      documentElement: { style },
      addEventListener: (name: string, callback: (event: unknown) => void) =>
        events.set(name, callback),
    },
    addEventListener: () => {},
  });
  const key = (value: string, tagName = "DIV") =>
    events.get("keydown")?.({
      ctrlKey: true,
      key: value,
      target: { tagName },
      preventDefault: () => prevented++,
    });
  key("+");
  assert.equal(style.zoom, "1.1");
  key("0");
  assert.equal(style.zoom, "1");
  key("+", "INPUT");
  assert.equal(style.zoom, "1");
  assert.equal(prevented, 2);
});

test("HTML zoom changes the document without reloading it and reports the actual scale", () => {
  const events = new Map<string, (event: unknown) => void>();
  const messages: unknown[] = [];
  const style: { zoom?: string } = {};
  const parent = { postMessage: (value: unknown) => messages.push(value) };
  const document = { documentElement: { style }, addEventListener: () => {} };
  runInNewContext(HTML_BRIDGE, {
    parent,
    document,
    addEventListener: (name: string, callback: (event: unknown) => void) =>
      events.set(name, callback),
  });
  events.get("message")?.({ source: {}, data: { channel: "paseo-doc-zoom", scale: 2 } });
  assert.equal(style.zoom, undefined);
  events.get("message")?.({ source: parent, data: { channel: "paseo-doc-zoom", scale: 1.5 } });
  assert.equal(style.zoom, "1.5");
  events.get("message")?.({ source: parent, data: { channel: "paseo-doc-zoom", scale: 0.1 } });
  assert.equal(style.zoom, "0.5");
  events.get("message")?.({ source: parent, data: { channel: "paseo-doc-zoom", scale: 10 } });
  assert.equal(style.zoom, "3");
  events.get("message")?.({ source: parent, data: { channel: "paseo-doc-zoom", scale: NaN } });
  assert.equal(style.zoom, "3");
  assert.equal(messages.length, 3);
  assert.equal(nextHtmlZoom(1.1, 0.1), 1.2);
  assert.equal(nextHtmlZoom(3, 0.1), 3);
  assert.equal(nextHtmlZoom(0.5, -0.1), 0.5);
});

test("a restored HTML tab keeps its own scale and scroll position", () => {
  const events = new Map<string, (event: unknown) => void>();
  const style: { zoom?: string } = {};
  const moves: number[][] = [];
  const parent = { postMessage: () => {} };
  runInNewContext(HTML_BRIDGE, {
    parent,
    document: { documentElement: { style }, addEventListener: () => {} },
    addEventListener: (name: string, callback: (event: unknown) => void) =>
      events.set(name, callback),
    requestAnimationFrame: (callback: () => void) => callback(),
    innerWidth: 1000,
    innerHeight: 800,
    scrollTo: (x: number, y: number) => moves.push([x, y]),
  });
  events.get("message")?.({
    source: parent,
    data: { channel: "paseo-doc-restore", view: { htmlZoom: 1.6, scrollX: 20, scrollY: 700 } },
  });
  assert.equal(style.zoom, "1.6");
  assert.deepEqual(moves, [[20, 700]]);
  events.get("message")?.({
    source: {},
    data: { channel: "paseo-doc-restore", view: { htmlZoom: 3, scrollX: 0, scrollY: 0 } },
  });
  assert.equal(style.zoom, "1.6");
  assert.equal(moves.length, 1);
});

test("HTML restores reading position after a retained tab becomes visible", () => {
  const events = new Map<string, (event?: unknown) => void>();
  const moves: number[][] = [];
  const parent = { postMessage() {} };
  const context = {
    parent,
    document: { documentElement: { style: {} }, addEventListener() {} },
    addEventListener: (name: string, callback: (event?: unknown) => void) =>
      events.set(name, callback),
    requestAnimationFrame: (callback: () => void) => callback(),
    innerWidth: 0,
    innerHeight: 0,
    scrollTo: (x: number, y: number) => moves.push([x, y]),
  };
  runInNewContext(HTML_BRIDGE, context);
  events.get("message")?.({
    source: parent,
    data: { channel: "paseo-doc-restore", view: { htmlZoom: 1.5, scrollX: 0, scrollY: 300 } },
  });
  assert.equal(moves.length, 0);
  context.innerWidth = 1000;
  context.innerHeight = 800;
  events.get("resize")?.();
  assert.deepEqual(moves, [[0, 300]]);
  events.get("resize")?.();
  assert.equal(moves.length, 1);
});
