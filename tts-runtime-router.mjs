import { createMultilingualTtsRuntimeClient } from "./tts-multilingual-runtime-client.mjs";
import { createTtsRuntimeClient } from "./tts-runtime-client.mjs";
import { joinPcm16Wavs } from "./wav-pcm.mjs";

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

export function splitMixedTtsSegments(text, language) {
  const value = String(text ?? "");
  if (language === "en") return value.trim() ? [{ text: value, language: "en" }] : [];
  const segments = [];
  let cursor = 0;
  const latinFragments = /[A-Za-z][A-Za-z0-9'’._/+:-]*(?:[ \t]+[A-Za-z][A-Za-z0-9'’._/+:-]*)*/gu;
  for (const match of value.matchAll(latinFragments)) {
    if (match.index > cursor) {
      const cjkText = value.slice(cursor, match.index);
      if (cjkText.trim()) segments.push({ text: cjkText, language });
    }
    if (match[0].trim()) segments.push({ text: match[0], language: "en" });
    cursor = match.index + match[0].length;
  }
  if (cursor < value.length) {
    const cjkText = value.slice(cursor);
    if (cjkText.trim()) segments.push({ text: cjkText, language });
  }
  return segments;
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
      const segments = splitMixedTtsSegments(payload.text, language);
      if (segments.length === 0) {
        const error = new Error("TTS text must not be empty");
        error.code = "TTS_EMPTY_TEXT";
        throw error;
      }

      const results = [];
      for (const segment of segments) {
        const routedPayload = {
          ...payload,
          text: segment.text,
          language: segment.language,
          voice: voiceForTtsLanguage(segment.language, payload.voice),
        };
        const runtime = segment.language === "en" ? englishRuntime : multilingualRuntime;
        results.push({
          language: segment.language,
          payload: routedPayload,
          result: await runtime.synthesize(routedPayload, options),
        });
      }

      const primaryVoice = voiceForTtsLanguage(language, payload.voice);
      if (results.length > 1) {
        const joined = joinPcm16Wavs(results.map(({ result }) => result.audio));
        return {
          audio: joined.audio,
          sampleRate: joined.sampleRate,
          durationMs: results.reduce((sum, { result }) => sum + (Number(result.durationMs) || 0), 0),
          audioSeconds: joined.audioSeconds,
          language,
          voice: primaryVoice,
          speed: Number(payload.speed),
          model: "kokoro-v1.0.int8.onnx + onnx-community/Kokoro-82M-ONNX",
          dtype: "int8 + q8",
          phonemeCount: results.reduce(
            (sum, { result }) => sum + (Number(result.phonemeCount) || 0),
            0,
          ),
          unknownPhonemeCount: results.reduce(
            (sum, { result }) => sum + (Number(result.unknownPhonemeCount) || 0),
            0,
          ),
        };
      }

      const [{ result, payload: routedPayload }] = results;
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
