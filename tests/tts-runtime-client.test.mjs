import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createTtsRuntimeClient } from "../tts-runtime-client.mjs";

test("Electron package includes the TTS runtime and worker entrypoints", () => {
  const packageJson = JSON.parse(readFileSync(
    new URL("../package.json", import.meta.url),
    "utf8",
  ));
  assert.ok(packageJson.build.files.includes("tts-runtime-client.mjs"));
  assert.ok(packageJson.build.files.includes("tts-multilingual-runtime-client.mjs"));
  assert.ok(packageJson.build.files.includes("tts-runtime-router.mjs"));
  assert.ok(packageJson.build.files.includes("tts-worker.mjs"));
  assert.ok(packageJson.build.files.includes("wav-pcm.mjs"));
  assert.ok(packageJson.build.files.includes("tts-kokoro-vocab.json"));
  assert.ok(packageJson.build.files.includes("tts_multilingual_worker.py"));
  assert.ok(packageJson.build.files.includes("tts-aesthetic-walk.mjs"));
  assert.ok(packageJson.build.files.includes("tts-point-gesture.mjs"));
  assert.ok(packageJson.build.files.includes("tts-point-sentence.mjs"));
  assert.ok(packageJson.build.files.includes("tts-point-session.mjs"));
  assert.deepEqual(packageJson.build.extraResources.map((entry) => entry.to), [
    "tts-multilingual",
    "tts-english",
  ]);
  assert.ok(packageJson.build.files.includes("!build/runtime/**/*"));
  assert.ok(packageJson.build.files.includes("!build/tts-multilingual-pyinstaller/**/*"));
  assert.ok(!packageJson.build.files.includes("docs/**/*"));
  assert.equal(packageJson.build.afterPack, "scripts/after-pack.cjs");
});

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.connected = true;
    this.killed = false;
    this.sent = [];
    this.killSignals = [];
  }

  send(message) {
    this.sent.push(message);
  }

  kill(signal = "SIGTERM") {
    this.killed = true;
    this.connected = false;
    this.killSignals.push(signal);
    this.emit("exit", null, signal);
    return true;
  }

  reply(message) {
    this.emit("message", message);
  }
}

function createHarness(options = {}) {
  const children = [];
  const forkCalls = [];
  const client = createTtsRuntimeClient({
    timeoutMs: 1_000,
    forkImpl: (...args) => {
      forkCalls.push(args);
      const child = new FakeChild();
      children.push(child);
      return child;
    },
    ...options,
  });
  return { children, client, forkCalls };
}

test("runtime client sends one synthesis at a time and correlates results by requestId", async (t) => {
  const { children, client, forkCalls } = createHarness();
  t.after(() => client.close());

  const first = client.synthesize({ text: "first", voice: "af_heart", speed: 1 });
  const second = client.synthesize({ text: "second", voice: "af_heart", speed: 1.2 });
  assert.equal(children.length, 1);
  assert.equal(children[0].sent.length, 1);
  assert.equal(children[0].sent[0].type, "synthesize");
  assert.equal(children[0].sent[0].payload.text, "first");
  assert.equal(forkCalls[0][2].serialization, "advanced");
  assert.equal(forkCalls[0][2].env.ELECTRON_RUN_AS_NODE, "1");
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === "path");
  assert.ok(pathKey);
  assert.equal(forkCalls[0][2].env[pathKey], process.env[pathKey]);

  const firstId = children[0].sent[0].requestId;
  children[0].reply({
    type: "result",
    requestId: firstId,
    audio: Buffer.from("first wav"),
    sampleRate: 24_000,
    durationMs: 12,
  });
  assert.equal((await first).audio.toString(), "first wav");

  assert.equal(children[0].sent.length, 2);
  assert.equal(children[0].sent[1].payload.text, "second");
  const secondId = children[0].sent[1].requestId;
  children[0].reply({
    type: "result",
    requestId: secondId,
    audio: Buffer.from("second wav"),
    sampleRate: 24_000,
    durationMs: 10,
  });
  assert.equal((await second).audio.toString(), "second wav");
});

test("replacing active inference cancels once and only then starts the queued latest request", async (t) => {
  const { children, client } = createHarness();
  t.after(() => client.close());
  const controller = new AbortController();

  const abandoned = client.synthesize(
    { text: "never finish", voice: "af_heart", speed: 1 },
    { signal: controller.signal },
  );
  const oldChild = children[0];
  const abandonedId = oldChild.sent[0].requestId;
  const next = client.synthesize({ text: "latest", voice: "af_heart", speed: 1 });
  assert.equal(children.length, 1);
  assert.equal(oldChild.sent.length, 1);

  controller.abort();

  await assert.rejects(abandoned, { name: "AbortError" });
  assert.deepEqual(oldChild.killSignals, ["SIGKILL"]);
  assert.equal(children.length, 2);
  const nextChild = children[1];
  assert.equal(nextChild.sent[0].payload.text, "latest");
  const nextId = nextChild.sent[0].requestId;

  oldChild.reply({
    type: "result",
    requestId: abandonedId,
    audio: Buffer.from("late"),
    sampleRate: 24_000,
    durationMs: 99,
  });
  nextChild.reply({
    type: "result",
    requestId: nextId,
    audio: Buffer.from("fresh"),
    sampleRate: 24_000,
    durationMs: 8,
  });
  assert.equal((await next).audio.toString(), "fresh");
});

test("aborting a queued request does not interrupt the active child", async (t) => {
  const { children, client } = createHarness();
  t.after(() => client.close());
  const queuedController = new AbortController();
  const active = client.synthesize({ text: "active", voice: "af_heart", speed: 1 });
  const queued = client.synthesize(
    { text: "queued", voice: "af_heart", speed: 1 },
    { signal: queuedController.signal },
  );

  queuedController.abort();
  await assert.rejects(queued, { name: "AbortError" });
  assert.equal(children[0].killed, false);

  const activeId = children[0].sent[0].requestId;
  children[0].reply({
    type: "result",
    requestId: activeId,
    audio: Buffer.from("active"),
    sampleRate: 24_000,
    durationMs: 5,
  });
  assert.equal((await active).audio.toString(), "active");
  assert.equal(children[0].sent.length, 1);
});

test("timed out inference is hard-cancelled and reports a timeout error", async (t) => {
  const { children, client } = createHarness({ timeoutMs: 15 });
  t.after(() => client.close());

  await assert.rejects(
    client.synthesize({ text: "slow", voice: "af_heart", speed: 1 }),
    (error) => error?.code === "TTS_TIMEOUT",
  );
  assert.deepEqual(children[0].killSignals, ["SIGKILL"]);
});

test("a worker error rejects only its request and later requests can retry", async (t) => {
  const { children, client } = createHarness();
  t.after(() => client.close());

  const first = client.synthesize({ text: "load fails", voice: "af_heart", speed: 1 });
  const firstId = children[0].sent[0].requestId;
  children[0].reply({
    type: "error",
    requestId: firstId,
    error: { name: "Error", message: "model load failed", code: "MODEL_LOAD_FAILED" },
  });
  await assert.rejects(first, /model load failed/);

  const retry = client.synthesize({ text: "try again", voice: "af_heart", speed: 1 });
  const retryId = children[0].sent[1].requestId;
  children[0].reply({
    type: "result",
    requestId: retryId,
    audio: Buffer.from("ok"),
    sampleRate: 24_000,
    durationMs: 4,
  });
  assert.equal((await retry).audio.toString(), "ok");
});

test("a crashed worker rejects its active request and queued work resumes in a fresh child", async (t) => {
  const { children, client } = createHarness();
  t.after(() => client.close());

  const crashed = client.synthesize({ text: "crash now", voice: "af_heart", speed: 1 });
  const queued = client.synthesize({ text: "resume later", voice: "af_heart", speed: 1 });
  children[0].connected = false;
  children[0].emit("exit", 9, null);

  await assert.rejects(
    crashed,
    (error) => error?.code === "TTS_WORKER_EXIT",
  );
  assert.equal(children.length, 2);
  assert.equal(children[1].sent[0].payload.text, "resume later");

  const queuedId = children[1].sent[0].requestId;
  children[1].reply({
    type: "result",
    requestId: queuedId,
    audio: Buffer.from("fresh after crash"),
    sampleRate: 24_000,
    durationMs: 6,
  });
  assert.equal((await queued).audio.toString(), "fresh after crash");
});

test("runtime client rejects excess queued work with backpressure", async () => {
  const { client } = createHarness({ maxQueueSize: 1 });
  const active = client.synthesize({ text: "active" });
  const queued = client.synthesize({ text: "queued" });

  await assert.rejects(
    client.synthesize({ text: "overflow" }),
    (error) => error?.code === "TTS_BACKPRESSURE",
  );

  client.close();
  await assert.rejects(active, (error) => error?.code === "TTS_RUNTIME_CLOSED");
  await assert.rejects(queued, (error) => error?.code === "TTS_RUNTIME_CLOSED");
});
