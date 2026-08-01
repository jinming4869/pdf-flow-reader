import { createMultilingualTtsRuntimeClient } from "./tts-multilingual-runtime-client.mjs";
import { createTtsRuntimeClient } from "./tts-runtime-client.mjs";

const KANA_RE = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HAN_RE = /\p{Script=Han}/u;
const JAPANESE_HINTS = new Set(["ja", "ja-jp", "jpn", "japanese"]);
const CHINESE_HINTS = new Set(["zh", "zh-cn", "zh-hans", "cmn", "chinese"]);

export function resolveTtsLanguage(language, text = "") {
  const hint = String(language ?? "").trim().toLowerCase().replaceAll("_", "-");
  const value = String(text ?? "");
  if (JAPANESE_HINTS.has(hint)) return "ja";
  if (CHINESE_HINTS.has(hint)) return "zh";
  if (KANA_RE.test(value)) return "ja";
  if (HAN_RE.test(value)) return "zh";
  return "en";
}

export function voiceForTtsLanguage(language, requestedVoice = null) {
  if (language === "zh") return "zf_xiaobei";
  if (language === "ja") return "jf_alpha";
  const normalized = String(requestedVoice ?? "").trim();
  return normalized.startsWith("af_") || normalized.startsWith("am_")
    || normalized.startsWith("bf_") || normalized.startsWith("bm_")
    ? normalized
    : "af_heart";
}

export function createTtsRuntimeRouter({
  appRoot,
  englishRuntime = createTtsRuntimeClient(),
  multilingualRuntime = createMultilingualTtsRuntimeClient({ appRoot }),
} = {}) {
  let closed = false;

  return {
    async synthesize(payload = {}, options = {}) {
      if (closed) {
        const error = new Error("TTS runtime router is closed");
        error.code = "TTS_RUNTIME_CLOSED";
        throw error;
      }
      const language = resolveTtsLanguage(payload.language, payload.text);
      const routedPayload = {
        ...payload,
        language,
        voice: voiceForTtsLanguage(language, payload.voice),
      };
      const runtime = language === "en" ? englishRuntime : multilingualRuntime;
      const result = await runtime.synthesize(routedPayload, options);
      return {
        ...result,
        language: result.language ?? language,
        voice: result.voice ?? routedPayload.voice,
        speed: Number.isFinite(result.speed) ? result.speed : routedPayload.speed,
        model: result.model ?? (language === "en"
          ? "onnx-community/Kokoro-82M-ONNX"
          : "kokoro-v1.0.int8.onnx"),
        dtype: result.dtype ?? (language === "en" ? "q8" : "int8"),
      };
    },
    close() {
      if (closed) return;
      closed = true;
      englishRuntime.close?.();
      multilingualRuntime.close?.();
    },
    status() {
      if (closed) return "closed";
      return {
        english: englishRuntime.status?.() ?? "unknown",
        multilingual: multilingualRuntime.status?.() ?? "unknown",
      };
    },
  };
}
