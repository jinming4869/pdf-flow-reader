import test from "node:test";
import assert from "node:assert/strict";
import {
  createNullTtsProvider,
  createKokoroTtsProvider,
  createOpenAITtsProvider,
  createTtsWarmupRequest,
  pickTtsProvider,
} from "../tts-provider.mjs";

// ── NullTtsProvider ──

test("NullTtsProvider returns skip result", async () => {
  const p = createNullTtsProvider();
  assert.equal(p.id, "null-tts");
  assert.equal(p.mode, "local");

  const result = await p.synthesize({ text: "hello" });
  assert.equal(result.audioBuffer, null);
  assert.equal(result.durationMs, 0);
  assert.equal(result.providerMeta.skipped, true);
});

test("NullTtsProvider rejects on abort signal", async () => {
  const p = createNullTtsProvider();
  const ctrl = new AbortController();
  ctrl.abort();
  await assert.rejects(
    () => p.synthesize({ text: "hello", signal: ctrl.signal }),
    { name: "AbortError" },
  );
});

// ── pickTtsProvider ──

test("pickTtsProvider returns OpenAI when apiKey provided", () => {
  const p = pickTtsProvider({ openaiApiKey: "sk-test" });
  assert.equal(p.id, "openai-api");
  assert.equal(p.mode, "online");
});

test("pickTtsProvider returns Kokoro by default", () => {
  const p = pickTtsProvider({ kokoroEnabled: true });
  assert.equal(p.id, "kokoro-local");
  assert.equal(p.mode, "local");
});

test("pickTtsProvider returns null when kokoro disabled and no key", () => {
  const p = pickTtsProvider({ kokoroEnabled: false });
  assert.equal(p.id, "null-tts");
});

// ── createOpenAITtsProvider ──

test("OpenAI provider requires apiKey", () => {
  assert.throws(() => createOpenAITtsProvider({}), {
    message: /API Key/,
  });
});

test("OpenAI provider has correct metadata", () => {
  const p = createOpenAITtsProvider({ apiKey: "sk-test" });
  assert.equal(p.id, "openai-api");
  assert.equal(p.mode, "online");
  assert.ok(p.languages.includes("en"));
  assert.ok(p.languages.includes("zh"));
  assert.ok(p.languages.includes("ja"));
});

test("OpenAI provider cancels active controller", () => {
  const p = createOpenAITtsProvider({ apiKey: "sk-test" });
  p.cancel(); // should not throw
});

// ── createKokoroTtsProvider ──

test("Kokoro provider has correct metadata", () => {
  const p = createKokoroTtsProvider();
  assert.equal(p.id, "kokoro-local");
  assert.equal(p.mode, "local");
  assert.ok(p.languages.includes("en"));
  assert.ok(p.languages.includes("zh"));
  assert.ok(p.languages.includes("ja"));
});

test("warmup request follows the current readable text language", () => {
  assert.deepEqual(createTtsWarmupRequest([{
    text: "A quiet argument continues across the page.",
    languageHint: "latin",
    role: "body",
    priority: 1,
  }]), {
    key: "english",
    runtimeKeys: ["english"],
    language: "en",
    text: "A quiet page.",
  });
  assert.deepEqual(createTtsWarmupRequest([{
    text: "这一段讨论 PDF reading 的连续性。",
    languageHint: "mixed",
    role: "body",
    priority: 1,
  }]), {
    key: "english+multilingual",
    runtimeKeys: ["english", "multilingual"],
    language: "zh",
    text: "希声 PDF",
  });
  assert.deepEqual(createTtsWarmupRequest([
    {
      text: "An English paragraph.",
      languageHint: "latin",
      role: "body",
      priority: 1,
    },
    {
      text: "下一页转为中文。",
      languageHint: "cjk",
      role: "body",
      priority: 1,
    },
  ]), {
    key: "english+multilingual",
    runtimeKeys: ["english", "multilingual"],
    language: "zh",
    text: "希声 PDF",
  });
  assert.equal(createTtsWarmupRequest([]), null);
});

test("Kokoro provider preload warms the requested language instead of fixed Chinese", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return new Response(new ArrayBuffer(4), { status: 200 });
  };
  try {
    const p = createKokoroTtsProvider({ endpoint: "/tts/kokoro" });
    await p.preload({
      text: "A quiet page.",
      language: "en",
    });
    assert.deepEqual(calls, [{
      url: "/tts/kokoro",
      body: {
        text: "A quiet page.",
        language: "en",
        voice: "af_heart",
        speed: 1.15,
        warmup: true,
      },
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Kokoro provider cancel does not throw", () => {
  const p = createKokoroTtsProvider();
  p.cancel();
});

test("Kokoro provider cancel aborts an active local request", async () => {
  const originalFetch = globalThis.fetch;
  let requestSignal = null;
  globalThis.fetch = async (_url, options) => {
    requestSignal = options.signal;
    return await new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        reject(new DOMException("cancelled", "AbortError"));
      }, { once: true });
    });
  };
  try {
    const p = createKokoroTtsProvider({ endpoint: "/tts/kokoro" });
    const pending = p.synthesize({ text: "hello", language: "latin" });
    await Promise.resolve();
    assert.equal(requestSignal?.aborted, false);
    p.cancel();
    await assert.rejects(pending, { name: "AbortError" });
    assert.equal(requestSignal.aborted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Kokoro provider posts speed to local endpoint", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    const headers = new Headers({
      "X-TTS-Duration-Ms": "12",
      "X-TTS-Sample-Rate": "24000",
      "X-TTS-Speed": "1.22",
      "X-TTS-Language": "zh",
      "X-TTS-Voice": "zf_xiaobei",
      "X-TTS-Model": "kokoro-v1.0.int8.onnx",
      "X-TTS-Dtype": "int8",
    });
    return new Response(new ArrayBuffer(4), { status: 200, headers });
  };
  try {
    const p = createKokoroTtsProvider({ endpoint: "/tts/kokoro" });
    const result = await p.synthesize({ text: "hello", language: "latin", speed: 1.22 });
    assert.equal(calls[0].url, "/tts/kokoro");
    assert.equal(JSON.parse(calls[0].options.body).speed, 1.22);
    assert.equal(result.providerMeta.speed, 1.22);
    assert.equal(result.language, "zh");
    assert.equal(result.providerMeta.voice, "zf_xiaobei");
    assert.equal(result.providerMeta.model, "kokoro-v1.0.int8.onnx");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Kokoro provider requests the selected v1.0 Chinese voice for CJK text", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(new ArrayBuffer(4), {
      status: 200,
      headers: new Headers({ "X-TTS-Speed": "1.2", "X-TTS-Sample-Rate": "24000" }),
    });
  };
  try {
    const p = createKokoroTtsProvider({ endpoint: "/tts/kokoro" });
    await p.synthesize({ text: "希声诊断", language: "cjk", speed: 1.2 });
    assert.equal(JSON.parse(calls[0].options.body).voice, "zf_xiaobei");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Kokoro provider rejects on abort before model load", async () => {
  const p = createKokoroTtsProvider();
  const ctrl = new AbortController();
  ctrl.abort();
  await assert.rejects(
    () => p.synthesize({ text: "hello", signal: ctrl.signal }),
    { name: "AbortError" },
  );
});
