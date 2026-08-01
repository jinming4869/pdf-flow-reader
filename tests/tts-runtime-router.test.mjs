import assert from "node:assert/strict";
import test from "node:test";

import {
  createTtsRuntimeRouter,
  resolveTtsLanguage,
  splitMixedTtsSegments,
  voiceForTtsLanguage,
} from "../tts-runtime-router.mjs";
import { createPcm16Wav, parsePcmWav } from "../wav-pcm.mjs";

test("language router distinguishes Chinese, Japanese, mixed, and English text", () => {
  assert.equal(resolveTtsLanguage("cjk", "页面缓缓流动"), "zh");
  assert.equal(resolveTtsLanguage("cjk", "ページがゆっくり流れます"), "ja");
  assert.equal(resolveTtsLanguage("mixed", "PDF 阅读与 OCR"), "zh");
  assert.equal(resolveTtsLanguage("latin", "PDF reading and OCR"), "en");
  assert.equal(resolveTtsLanguage("ja", "東京"), "ja");
});

test("language-specific voices cannot leak across runtimes", () => {
  assert.equal(voiceForTtsLanguage("zh", "af_heart"), "zf_xiaobei");
  assert.equal(voiceForTtsLanguage("ja", "zf_xiaobei"), "jf_alpha");
  assert.equal(voiceForTtsLanguage("en", "jf_alpha"), "af_heart");
  assert.equal(voiceForTtsLanguage("en", "bf_emma"), "bf_emma");
});

test("mixed CJK text sends Latin fragments to the English runtime", () => {
  assert.deepEqual(splitMixedTtsSegments("在2026年，PDF Reader结合OCR阅读。", "zh"), [
    { text: "在2026年，", language: "zh" },
    { text: "PDF Reader", language: "en" },
    { text: "结合", language: "zh" },
    { text: "OCR", language: "en" },
    { text: "阅读。", language: "zh" },
  ]);
});

test("runtime router delegates CJK and English independently and returns actual metadata", async () => {
  const calls = [];
  let englishClosed = 0;
  let multilingualClosed = 0;
  const englishRuntime = {
    status: () => "english-ready",
    async synthesize(payload) {
      calls.push(["en", payload]);
      return { audio: Buffer.from("en"), sampleRate: 24_000, durationMs: 1 };
    },
    close() { englishClosed += 1; },
  };
  const multilingualRuntime = {
    status: () => "cjk-ready",
    async synthesize(payload) {
      calls.push(["cjk", payload]);
      return {
        audio: Buffer.from(payload.language),
        sampleRate: 24_000,
        durationMs: 2,
        language: payload.language,
        voice: payload.voice,
        model: "kokoro-v1.0.int8.onnx",
        dtype: "int8",
      };
    },
    close() { multilingualClosed += 1; },
  };
  const router = createTtsRuntimeRouter({ englishRuntime, multilingualRuntime });

  const chinese = await router.synthesize({ text: "希声", language: "cjk", voice: "af_heart", speed: 1.25 });
  const japanese = await router.synthesize({ text: "静かな声です", language: "cjk", voice: "zf_xiaobei", speed: 1.5 });
  const english = await router.synthesize({ text: "quiet voice", language: "latin", voice: "af_heart", speed: 1 });

  assert.deepEqual(calls.map(([runtime, payload]) => [runtime, payload.language, payload.voice]), [
    ["cjk", "zh", "zf_xiaobei"],
    ["cjk", "ja", "jf_alpha"],
    ["en", "en", "af_heart"],
  ]);
  assert.equal(chinese.model, "kokoro-v1.0.int8.onnx");
  assert.equal(japanese.voice, "jf_alpha");
  assert.equal(english.model, "onnx-community/Kokoro-82M-ONNX");
  assert.deepEqual(router.status(), { english: "english-ready", multilingual: "cjk-ready" });

  router.close();
  router.close();
  assert.equal(englishClosed, 1);
  assert.equal(multilingualClosed, 1);
});

test("runtime router synthesizes and joins mixed Chinese-English PCM audio", async (t) => {
  const calls = [];
  const englishRuntime = {
    async synthesize(payload) {
      calls.push(["en", payload.text]);
      return { audio: createPcm16Wav(Buffer.from([2, 0])), sampleRate: 24_000 };
    },
    close() {},
  };
  const multilingualRuntime = {
    async synthesize(payload) {
      calls.push(["cjk", payload.text]);
      return {
        audio: createPcm16Wav(Buffer.from([1, 0])),
        sampleRate: 24_000,
        language: payload.language,
        voice: payload.voice,
        phonemeCount: 2,
      };
    },
    close() {},
  };
  const router = createTtsRuntimeRouter({ englishRuntime, multilingualRuntime });
  t.after(() => router.close());

  const result = await router.synthesize({
    text: "阅读 PDF 文档。",
    language: "zh",
    speed: 1,
  });
  assert.deepEqual(calls, [
    ["cjk", "阅读 "],
    ["en", "PDF"],
    ["cjk", " 文档。"],
  ]);
  assert.equal(result.language, "zh");
  assert.equal(result.voice, "zf_xiaobei");
  assert.deepEqual([...parsePcmWav(result.audio).data], [1, 0, 2, 0, 1, 0]);
});
