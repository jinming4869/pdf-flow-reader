import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../app.mjs", import.meta.url), "utf8");

test("reader warms the runtime family required by current page text", () => {
  assert.match(app, /createTtsWarmupRequest/);
  assert.match(app, /function currentTtsWarmupRequest\(/);
  assert.match(app, /continuousSpeechPrefetchChunks\(pageNumber, currentTtsPolicy\(\)\)/);
  assert.match(app, /ttsWarmupReadyKeys/);
  assert.match(app, /request\.runtimeKeys\.every/);
  assert.match(app, /ttsProvider\?\.preload\?\.\(\{\s*text: request\.text,\s*language: request\.language/s);
});

test("automatic speech waits for language-specific warmup without blocking empty pages", () => {
  assert.match(app, /const warmupRequest = currentTtsWarmupRequest\(pageNumber\)/);
  assert.match(app, /if \(warmupRequest && !isTtsWarmupReady\(warmupRequest\)\)/);
  assert.match(app, /ensureTtsRuntimeActive\("page-language-ready"\)/);
});
