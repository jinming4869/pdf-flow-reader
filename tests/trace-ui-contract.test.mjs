import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const html = readFileSync(new URL("index.html", root), "utf8");
const app = readFileSync(new URL("app.mjs", root), "utf8");
const styles = readFileSync(new URL("styles.css", root), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));

test("reader exposes one explicit ribbon-lasso surface and a minimal saved-trace panel", () => {
  for (const id of [
    "traceLassoButton",
    "traceStatus",
    "tracePanel",
    "tracePreview",
    "traceSummary",
    "traceReturnButton",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), id);
  }
  assert.match(html, /title=["'][^"']*L[^"']*["']/);
  assert.match(html, /回到书流/);
});

test("app connects the isolated trace controller without embedding geometry logic", () => {
  assert.match(app, /createTraceCaptureController/);
  assert.match(app, /createTraceClient/);
  assert.match(app, /createDocumentId/);
  assert.match(app, /pdf\.fingerprints/);
  assert.match(app, /traceCapture\.snapshot\(\)\.scrollHold/);
  assert.doesNotMatch(app, /function\s+prepareLassoPath/);
  assert.doesNotMatch(app, /function\s+renderLassoCrop/);
});

test("trace controller is packaged and served while browser mode has a hidden entry", () => {
  assert.ok(packageJson.build.files.includes("trace-capture-controller.mjs"));
  assert.match(styles, /\.trace-lasso-button/);
  assert.match(styles, /\.trace-lasso-layer/);
  assert.match(styles, /\.trace-panel/);
  assert.match(styles, /\.viewport\.is-trace-frozen/);
  assert.match(app, /traceClient\.available/);
});
