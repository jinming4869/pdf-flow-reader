import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createReaderServer } from "../server.mjs";
import { createTtsRuntimeClient } from "../tts-runtime-client.mjs";

async function startServer(options) {
  const server = createReaderServer(options);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    server,
    origin: `http://127.0.0.1:${address.port}`,
  };
}

function waitFor(predicate, timeoutMs = 1_000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error("timed out waiting for condition"));
        return;
      }
      setTimeout(poll, 5);
    };
    poll();
  });
}

test("server delegates synthesis while heartbeat and PDF ranges remain responsive", async (t) => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "night-study tts runtime-"));
  const pdfPath = join(fixtureRoot, "fixture.pdf");
  writeFileSync(pdfPath, Buffer.from("0123456789"));
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

  let synthesisStarted = false;
  let synthesisPayload;
  let releaseSynthesis;
  const ttsRuntime = {
    status: () => "ready",
    synthesize: (payload) => {
      synthesisStarted = true;
      synthesisPayload = payload;
      return new Promise((resolve) => {
        releaseSynthesis = () => resolve({
          audio: Buffer.from("wav"),
          sampleRate: 24_000,
          durationMs: 10,
          language: "en",
          voice: "af_heart",
          model: "onnx-community/Kokoro-82M-ONNX",
          dtype: "q8",
        });
      });
    },
    close() {},
  };
  const { server, origin } = await startServer({ pdfPath, ttsRuntime });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const synthesis = fetch(`${origin}/tts/kokoro`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: "keep running",
      language: "en",
      generation: 42,
      warmup: true,
    }),
  });
  await waitFor(() => synthesisStarted);
  assert.equal(synthesisPayload.language, "en");
  assert.equal(synthesisPayload.generation, 42);
  assert.equal(synthesisPayload.warmup, true);

  const heartbeat = await fetch(`${origin}/heartbeat`);
  assert.equal(heartbeat.status, 204);
  const range = await fetch(`${origin}/document.pdf`, {
    headers: { Range: "bytes=2-5" },
  });
  assert.equal(range.status, 206);
  assert.equal(await range.text(), "2345");

  releaseSynthesis();
  const synthesisResponse = await synthesis;
  assert.equal(synthesisResponse.status, 200);
  assert.equal(synthesisResponse.headers.get("X-TTS-Language"), "en");
  assert.equal(synthesisResponse.headers.get("X-TTS-Voice"), "af_heart");
  assert.equal(synthesisResponse.headers.get("X-TTS-Model"), "onnx-community/Kokoro-82M-ONNX");
});

test("CPU-bound inference in a real child process does not block heartbeat", async (t) => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "night-study fake tts child-"));
  const workerPath = join(fixtureRoot, "fake-worker.mjs");
  writeFileSync(workerPath, `
    process.on("message", (message) => {
      if (message?.type !== "synthesize") return;
      const startedAt = Date.now();
      while (Date.now() - startedAt < 200) {}
      process.send({
        type: "result",
        requestId: message.requestId,
        audio: Buffer.from("wav"),
        sampleRate: 24000,
        durationMs: Date.now() - startedAt,
      });
    });
  `);
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

  const ttsRuntime = createTtsRuntimeClient({ workerPath, timeoutMs: 2_000 });
  const { server, origin } = await startServer({ ttsRuntime });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  let synthesisSettled = false;
  const synthesis = fetch(`${origin}/tts/kokoro`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "CPU-bound fake inference" }),
  }).then((response) => {
    synthesisSettled = true;
    return response;
  });

  await new Promise((resolve) => setTimeout(resolve, 50));
  const heartbeat = await fetch(`${origin}/heartbeat`);
  assert.equal(heartbeat.status, 204);
  assert.equal(synthesisSettled, false);
  assert.equal((await synthesis).status, 200);
});

test("HTTP disconnect aborts runtime inference and no late result is written", async (t) => {
  let runtimeSignal;
  let resolveRuntime;
  let closeCalls = 0;
  const ttsRuntime = {
    status: () => "not-loaded",
    synthesize: (_payload, { signal }) => {
      runtimeSignal = signal;
      return new Promise((resolve, reject) => {
        resolveRuntime = resolve;
        signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      });
    },
    close() {
      closeCalls += 1;
    },
  };
  const { server, origin } = await startServer({ ttsRuntime });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const controller = new AbortController();
  const request = fetch(`${origin}/tts/kokoro`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "cancel me" }),
    signal: controller.signal,
  });
  await waitFor(() => runtimeSignal);
  controller.abort();
  await assert.rejects(request, { name: "AbortError" });
  await waitFor(() => runtimeSignal.aborted);

  resolveRuntime?.({
    audio: Buffer.from("too late"),
    sampleRate: 24_000,
    durationMs: 100,
  });
  await new Promise((resolve) => setTimeout(resolve, 10));

  await new Promise((resolve) => server.close(resolve));
  assert.equal(closeCalls, 1);
});

test("server close hard-closes the TTS runtime before waiting for active responses", async () => {
  let synthesisStarted = false;
  let rejectSynthesis;
  let closeCalls = 0;
  const ttsRuntime = {
    status: () => "busy",
    synthesize: () => {
      synthesisStarted = true;
      return new Promise((_resolve, reject) => {
        rejectSynthesis = reject;
      });
    },
    close() {
      closeCalls += 1;
      const error = new Error("runtime closed");
      error.code = "TTS_RUNTIME_CLOSED";
      rejectSynthesis?.(error);
    },
  };
  const { server, origin } = await startServer({ ttsRuntime });
  const synthesis = fetch(`${origin}/tts/kokoro`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "close while active" }),
  }).catch(() => null);
  await waitFor(() => synthesisStarted);

  await Promise.race([
    new Promise((resolve) => server.close(resolve)),
    new Promise((_resolve, reject) => {
      setTimeout(() => reject(new Error("server close remained blocked by TTS")), 250);
    }),
  ]);
  await synthesis;
  assert.equal(closeCalls, 1);
});
