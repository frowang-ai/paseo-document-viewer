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
