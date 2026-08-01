import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  createMultilingualTtsRuntimeClient,
  resolveMultilingualTtsResources,
} from "../tts-multilingual-runtime-client.mjs";

class FakePythonChild extends EventEmitter {
  constructor() {
    super();
    this.stdout = new PassThrough();
    this.exitCode = null;
    this.killed = false;
    this.killSignals = [];
    this.sent = [];
    this.stdin = {
      write: (line, callback) => {
        this.sent.push(JSON.parse(line));
        callback?.(null);
        return true;
      },
    };
  }

  reply(message) {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }

  kill(signal = "SIGTERM") {
    this.killed = true;
    this.exitCode = null;
    this.killSignals.push(signal);
    this.emit("exit", null, signal);
    return true;
  }
}

function createHarness(options = {}) {
  const children = [];
  const spawnCalls = [];
  const client = createMultilingualTtsRuntimeClient({
    executablePath: false,
    pythonPath: "/fake/python",
    modelsDir: "/fake/models",
    workerPath: "/fake/worker.py",
    existsImpl: () => true,
    timeoutMs: 1_000,
    spawnImpl: (...args) => {
      spawnCalls.push(args);
      const child = new FakePythonChild();
      children.push(child);
      return child;
    },
    ...options,
  });
  return { children, client, spawnCalls };
}

test("resource discovery honors explicit environment paths", () => {
  const values = new Set(["/chosen/python", "/chosen/models", "/chosen/worker.py"]);
  const result = resolveMultilingualTtsResources({
    appRoot: "/app",
    resourcesPath: "/bundle",
    env: {
      PDF_FLOW_TTS_PYTHON: "/chosen/python",
      PDF_FLOW_TTS_MODELS_DIR: "/chosen/models",
      PDF_FLOW_TTS_WORKER: "/chosen/worker.py",
    },
    existsImpl: (value) => values.has(value),
  });
  assert.deepEqual(result, {
    executablePath: null,
    pythonPath: "/chosen/python",
    modelsDir: "/chosen/models",
    workerPath: "/chosen/worker.py",
  });
});

test("Python runtime sends NDJSON and decodes WAV plus model metadata", async (t) => {
  const { children, client, spawnCalls } = createHarness();
  t.after(() => client.close());
  const pending = client.synthesize({
    text: "希声",
    language: "zh",
    voice: "zf_xiaobei",
    speed: 1.25,
  });
  assert.equal(children.length, 1);
  assert.equal(children[0].sent[0].payload.voice, "zf_xiaobei");
  assert.equal(spawnCalls[0][0], "/fake/python");
  assert.deepEqual(spawnCalls[0][1], ["-u", "/fake/worker.py"]);
  assert.equal(spawnCalls[0][2].env.PDF_FLOW_TTS_MODELS_DIR, "/fake/models");

  const requestId = children[0].sent[0].requestId;
  children[0].reply({
    type: "result",
    requestId,
    result: {
      audioBase64: Buffer.from("RIFF fake wav").toString("base64"),
      sampleRate: 24_000,
      durationMs: 12,
      language: "zh",
      voice: "zf_xiaobei",
      speed: 1.25,
      model: "kokoro-v1.0.int8.onnx",
      dtype: "int8",
      unknownPhonemeCount: 0,
    },
  });
  const result = await pending;
  assert.equal(result.audio.toString(), "RIFF fake wav");
  assert.equal(result.voice, "zf_xiaobei");
  assert.equal(result.model, "kokoro-v1.0.int8.onnx");
  assert.equal(result.unknownPhonemeCount, 0);
});

test("aborting active Python inference hard-kills the worker and rebuilds", async (t) => {
  const { children, client } = createHarness();
  t.after(() => client.close());
  const controller = new AbortController();
  const abandoned = client.synthesize(
    { text: "旧请求", language: "zh", voice: "zf_xiaobei" },
    { signal: controller.signal },
  );
  const queued = client.synthesize({ text: "新请求", language: "zh", voice: "zf_xiaobei" });
  const oldChild = children[0];
  controller.abort();
  await assert.rejects(abandoned, { name: "AbortError" });
  assert.deepEqual(oldChild.killSignals, ["SIGKILL"]);
  assert.equal(children.length, 2);

  const requestId = children[1].sent[0].requestId;
  children[1].reply({
    type: "result",
    requestId,
    result: {
      audioBase64: Buffer.from("fresh").toString("base64"),
      sampleRate: 24_000,
      durationMs: 4,
      language: "zh",
      voice: "zf_xiaobei",
      speed: 1,
    },
  });
  assert.equal((await queued).audio.toString(), "fresh");
});

test("missing local CJK resources fail lazily with an actionable code", async () => {
  const client = createMultilingualTtsRuntimeClient({
    pythonPath: "/missing/python",
    modelsDir: "/missing/models",
    workerPath: "/missing/worker.py",
    existsImpl: () => false,
  });
  await assert.rejects(
    client.synthesize({ text: "希声", language: "zh" }),
    (error) => error?.code === "TTS_RESOURCES_MISSING" && /中日文语音资源未安装/.test(error.message),
  );
  client.close();
});

test("packaged runtime launches its self-contained executable without Python arguments", async (t) => {
  const { children, client, spawnCalls } = createHarness({
    executablePath: "/bundle/tts-multilingual/worker/tts-multilingual-worker",
  });
  t.after(() => client.close());
  const pending = client.synthesize({ text: "希声", language: "zh" });
  assert.equal(spawnCalls[0][0], "/bundle/tts-multilingual/worker/tts-multilingual-worker");
  assert.deepEqual(spawnCalls[0][1], []);
  const requestId = children[0].sent[0].requestId;
  children[0].reply({
    type: "result",
    requestId,
    result: {
      audioBase64: Buffer.from("packaged").toString("base64"),
      sampleRate: 24_000,
    },
  });
  assert.equal((await pending).audio.toString(), "packaged");
});
