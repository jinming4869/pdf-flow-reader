import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("../electron-main.mjs", import.meta.url), "utf8");

test("packaged headless smoke is explicit, isolated, and disabled by default", () => {
  assert.match(main, /NIGHT_STUDY_HEADLESS_SMOKE/);
  assert.match(main, /NIGHT_STUDY_SMOKE_USER_DATA/);
  assert.match(main, /headlessSmokeMode\s*=\s*process\.env\.NIGHT_STUDY_HEADLESS_SMOKE\s*===\s*["']1["']/);
  assert.match(main, /HEADLESS_SMOKE_RESULT/);
  assert.match(main, /traceLassoButton/);
  assert.match(main, /canvas\.page-canvas/);
  assert.match(main, /if\s*\(!headlessSmokeMode\)\s*mainWindow\?\.show/);
});
