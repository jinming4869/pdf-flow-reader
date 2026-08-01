import assert from "node:assert/strict";
import test from "node:test";

import { createKokoroWorkerRuntime } from "../tts-worker.mjs";

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
