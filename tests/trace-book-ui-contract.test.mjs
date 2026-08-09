import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const html = readFileSync(new URL("index.html", root), "utf8");
const app = readFileSync(new URL("app.mjs", root), "utf8");
const styles = readFileSync(new URL("styles.css", root), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));

test("single-book trace view exposes chart, detail, correction, trash, and jump actions", () => {
  for (const id of [
    "traceBookButton",
    "bookTracePanel",
    "bookTraceClose",
    "bookTraceTitle",
    "bookTraceChart",
    "bookTraceList",
    "bookTraceImage",
    "bookTraceMeta",
    "bookTraceJump",
    "bookTraceTrash",
    "bookEmotionPad",
    "bookEmotionMarker",
    "bookEmotionWords",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), id);
  }
});

test("app delegates single-book trace behavior to an isolated controller", () => {
  assert.match(app, /createTraceBookController/);
  assert.match(app, /traceBook\.setDocument/);
  assert.match(app, /jumpToTracePage/);
  assert.doesNotMatch(app, /function\s+renderTraceChart/);
});

test("trace book controller is packaged and its visual surfaces are styled", () => {
  assert.ok(packageJson.build.files.includes("trace-book-controller.mjs"));
  assert.match(styles, /\.book-trace-panel/);
  assert.match(styles, /\.book-trace-chart/);
  assert.match(styles, /\.book-trace-point/);
  assert.match(styles, /\.book-trace-list/);
});
