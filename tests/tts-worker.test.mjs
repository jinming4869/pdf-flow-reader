import assert from "node:assert/strict";
import test from "node:test";

import {
  createKokoroWorkerRuntime,
  resolveEnglishTtsModelsDir,
} from "../tts-worker.mjs";
import { parsePcmWav } from "../wav-pcm.mjs";

test("English model discovery prefers an explicitly bundled offline root", () => {
  const existing = new Set(["/bundle/models"]);
  assert.equal(resolveEnglishTtsModelsDir({
    env: { PDF_FLOW_TTS_ENGLISH_MODELS_DIR: "/bundle/models" },
    resourcesPath: "/resources",
    appRoot: "/app",
    existsImpl: (value) => existing.has(value),
  }), "/bundle/models");
});

test("English model discovery returns null instead of allowing a remote fallback", () => {
  assert.equal(resolveEnglishTtsModelsDir({
    env: {},
    resourcesPath: "/resources",
    appRoot: "/app",
    existsImpl: () => false,
  }), null);
});

test("importing the worker module does not register a process message listener", async () => {
  const before = process.listenerCount("message");
  await import(`../tts-worker.mjs?import-safety=${Date.now()}`);
  assert.equal(process.listenerCount("message"), before);
});

test("worker clears a failed model load so the next request can retry", async () => {
  let attempts = 0;
  const runtime = createKokoroWorkerRuntime({
    loadModel: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("first load failed");
      return {
        async generate() {
          return {
            sampling_rate: 22_050,
            toWav: () => Buffer.from("wav after retry"),
          };
        },
      };
    },
  });
  const messages = [];
  const send = (message) => messages.push(message);

  await runtime.handleMessage({
    type: "synthesize",
    requestId: "one",
    payload: { text: "one", voice: "af_heart", speed: 1 },
  }, send);
  assert.equal(messages[0].type, "error");
  assert.match(messages[0].error.message, /first load failed/);

  await runtime.handleMessage({
    type: "synthesize",
    requestId: "two",
    payload: { text: "two", voice: "af_heart", speed: 1 },
  }, send);
  assert.equal(attempts, 2);
  assert.equal(messages[1].type, "result");
  assert.equal(messages[1].requestId, "two");
  assert.equal(messages[1].audio.toString(), "wav after retry");
  assert.equal(messages[1].sampleRate, 22_050);
});

test("worker converts Kokoro Float32 output to PCM16 before returning it", async () => {
  const runtime = createKokoroWorkerRuntime({
    loadModel: async () => ({
      async generate() {
        return {
          audio: new Float32Array([-1, 0, 1]),
          sampling_rate: 24_000,
          toWav() { throw new Error("Float32 path should not call toWav"); },
        };
      },
    }),
  });
  const messages = [];
  await runtime.handleMessage({
    type: "synthesize",
    requestId: "pcm16",
    payload: { text: "quiet voice", voice: "af_heart", speed: 1 },
  }, (message) => messages.push(message));

  assert.equal(messages[0].type, "result");
  const parsed = parsePcmWav(messages[0].audio);
  assert.equal(parsed.sampleRate, 24_000);
  assert.equal(parsed.bitsPerSample, 16);
  assert.deepEqual([
    parsed.data.readInt16LE(0),
    parsed.data.readInt16LE(2),
    parsed.data.readInt16LE(4),
  ], [-32_768, 0, 32_767]);
});
