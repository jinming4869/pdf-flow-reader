import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const html = readFileSync(new URL("index.html", root), "utf8");
const app = readFileSync(new URL("app.mjs", root), "utf8");
const styles = readFileSync(new URL("styles.css", root), "utf8");

test("reader topbar exposes an explicit return-to-shelf action", () => {
  assert.match(html, /id=["']homeButton["']/);
  assert.match(html, /返回书架/);
  assert.match(styles, /\.home-button/);
});

test("returning home persists position and disposes the active PDF", () => {
  assert.match(app, /async function returnToHome\(/);
  assert.match(app, /if \(returningHome\) return;/);
  assert.match(app, /returningHome = true;/);
  assert.match(app, /window\.clearTimeout\(persistTimer\);\s*persistTimer = 0;\s*if \(activeDocumentRecord\) persistReadingRecord\(\)/);
  assert.match(app, /\+\+loadGeneration/);
  assert.match(app, /pendingSourceAbortController\?\.abort\?\.\(\)/);
  assert.match(app, /clearTextSession\(\);\s*await disposeActiveDocument\(\)/);
  assert.match(app, /await disposeActiveDocument\(\)/);
  assert.match(app, /showEmptyState\(\)/);
  assert.match(app, /elements\.homeButton\.addEventListener\(["']click["']/);
});

test("fatal reader errors clear background text sessions but keep a recovery path", () => {
  assert.match(app, /function showError\(error\) \{\s*clearFirstPageMessageTimer\(\);\s*clearTextSession\(\);/);
  assert.doesNotMatch(app, /function showError\(error\)[\s\S]{0,500}elements\.homeButton\.hidden = true/);
});
