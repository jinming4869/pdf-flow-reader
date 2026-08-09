import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const packageJson = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
const runnerUrl = new URL("scripts/electron-integration-smoke.cjs", root);
const preloadUrl = new URL("scripts/electron-integration-preload.cjs", root);

test("Electron integration smoke has an explicit local entrypoint", () => {
  assert.equal(
    packageJson.scripts["test:electron:smoke"],
    "electron scripts/electron-integration-smoke.cjs",
  );
  assert.equal(existsSync(runnerUrl), true);
  assert.equal(existsSync(preloadUrl), true);
});

test("integration-only Electron files never enter the production package", () => {
  const packaged = new Set(packageJson.build.files);
  assert.equal(packaged.has("scripts/electron-integration-smoke.cjs"), false);
  assert.equal(packaged.has("scripts/electron-integration-preload.cjs"), false);
});

test("smoke runner preserves the desktop security boundary and required probes", () => {
  const runner = readFileSync(runnerUrl, "utf8");
  const preload = readFileSync(preloadUrl, "utf8");

  assert.match(runner, /contextIsolation:\s*true/);
  assert.match(runner, /nodeIntegration:\s*false/);
  assert.match(runner, /sandbox:\s*true/);
  assert.match(runner, /PointerEvent/);
  assert.match(runner, /restartPersistence/);
  assert.match(runner, /canvas\.page-canvas/);
  assert.match(preload, /contextBridge\.exposeInMainWorld/);
  assert.match(preload, /ipcRenderer\.invoke/);
});
