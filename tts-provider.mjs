// ── TTS Provider 注册中心 ──
// 本地：英文 Kokoro JS + 中日文共享 Kokoro v1.0 int8
// 在线：OpenAI gpt-4o-mini-tts（高质量 fallback）
// 调试：NullTtsProvider（不发声，仅诊断）

export function createKokoroTtsProvider({ endpoint = "./tts/kokoro" } = {}) {
  const KOKORO_MODEL_ID = "onnx-community/Kokoro-82M-ONNX";
  const activeControllers = new Set();

  const VOICE_MAP = {
    en: "af_heart",
    latin: "af_heart",
    "en-us": "af_heart",
    "en-gb": "bf_emma",
    zh: "zf_xiaobei",
    cjk: "zf_xiaobei",
    mixed: "zf_xiaobei",
    ja: "jf_alpha",
    japanese: "jf_alpha",
  };

  function pickVoice(languageHint) {
    const normalized = String(languageHint ?? "").toLowerCase().trim();
    if (VOICE_MAP[normalized]) return VOICE_MAP[normalized];
    if (normalized.startsWith("en")) return "af_heart";
    if (normalized.startsWith("zh") || normalized.includes("cjk")) return "zf_xiaobei";
    if (normalized.startsWith("ja")) return "jf_alpha";
    return "af_heart";
  }

  async function postLocalTts(body, signal) {
    if (signal?.aborted) {
      throw new DOMException("TTS 已取消", "AbortError");
    }
    const controller = new AbortController();
    activeControllers.add(controller);
    const abortLinkedRequest = () => controller.abort();
    signal?.addEventListener("abort", abortLinkedRequest, { once: true });
    try {
      return await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      signal?.removeEventListener("abort", abortLinkedRequest);
      activeControllers.delete(controller);
    }
  }

  return {
    id: "kokoro-local",
    name: "Kokoro (本地 ONNX)",
    mode: "local",
    languages: ["en", "zh", "ja"],

    async preload() {
      const response = await postLocalTts({
        text: "希声",
        language: "zh",
        voice: "zf_xiaobei",
        speed: 1.15,
        warmup: true,
      });
      if (!response.ok) throw new Error(`Kokoro 本地服务不可用：HTTP ${response.status}`);
      await response.arrayBuffer().catch(() => null);
      return true;
    },

    async synthesize({
      text = "",
      language,
      speed = 1,
      documentGeneration = null,
      signal,
    } = {}) {
      if (signal?.aborted) {
        throw new DOMException("TTS 已取消", "AbortError");
      }

      const voice = pickVoice(language);
      const startTime = Date.now();
      const response = await postLocalTts({
        text,
        language,
        voice,
        speed,
        generation: documentGeneration,
      }, signal);
      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(`Kokoro 本地合成失败：HTTP ${response.status}${errorText ? ` ${errorText}` : ""}`);
      }
      const audioBuffer = await response.arrayBuffer();
      const durationMs = Number(response.headers.get("X-TTS-Duration-Ms")) || Date.now() - startTime;
      const sampleRate = Number(response.headers.get("X-TTS-Sample-Rate")) || 24000;
      const actualSpeed = Number(response.headers.get("X-TTS-Speed")) || speed;
      const actualVoice = response.headers.get("X-TTS-Voice") || voice;
      const actualLanguage = response.headers.get("X-TTS-Language") || language || "unknown";
      const actualModel = response.headers.get("X-TTS-Model") || KOKORO_MODEL_ID;
      const actualDtype = response.headers.get("X-TTS-Dtype") || "q8";

      return {
        audioBuffer,
        sampleRate,
        format: "wav",
        durationMs,
        language: actualLanguage,
        providerMeta: {
          model: actualModel,
          dtype: actualDtype,
          voice: actualVoice,
          speed: actualSpeed,
          textLength: String(text).length,
          endpoint,
        },
      };
    },

    cancel() {
      for (const controller of activeControllers) controller.abort();
      activeControllers.clear();
    },

    async dispose() {
      for (const controller of activeControllers) controller.abort();
      activeControllers.clear();
    },
  };
}

export function createNullTtsProvider() {
  return {
    id: "null-tts",
    name: "Null TTS Provider",
    mode: "local",
    languages: [],
    async synthesize({ text = "", signal } = {}) {
      if (signal?.aborted) {
        throw new DOMException("TTS 已取消", "AbortError");
      }
      return {
        audioBuffer: null,
        durationMs: 0,
        language: "unknown",
        providerMeta: {
          skipped: true,
          reason: "null-provider",
          textLength: String(text).length,
        },
      };
    },
    cancel() {},
  };
}

export function createOpenAITtsProvider({ apiKey, model = "gpt-4o-mini-tts", voice = "marin" } = {}) {
  if (!apiKey) {
    throw new Error("OpenAI TTS Provider 需要提供 API Key");
  }

  let activeController = null;

  return {
    id: "openai-api",
    name: "OpenAI TTS (在线)",
    mode: "online",
    languages: ["en", "zh", "ja", "fr", "de", "es", "ko", "ar"],

    async synthesize({ text = "", language, signal } = {}) {
      if (signal?.aborted) {
        throw new DOMException("TTS 已取消", "AbortError");
      }

      const reqController = new AbortController();
      activeController = reqController;

      const linkedAbort = () => reqController.abort();
      signal?.addEventListener("abort", linkedAbort, { once: true });

      try {
        const startTime = Date.now();
        const instructions =
          "Read calmly, softly, and clearly, like a quiet study companion. Keep the pacing restrained and do not dramatize.";

        const response = await fetch("https://api.openai.com/v1/audio/speech", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            input: text,
            voice,
            response_format: "wav",
            speed: 1.0,
            instructions,
          }),
          signal: reqController.signal,
        });

        if (!response.ok) {
          const errorBody = await response.text().catch(() => "");
          throw new Error(`OpenAI TTS HTTP ${response.status}: ${errorBody.slice(0, 200)}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const durationMs = Date.now() - startTime;

        return {
          audioBuffer: arrayBuffer,
          sampleRate: 24000,
          format: "wav",
          durationMs,
          language: language ?? "unknown",
          providerMeta: {
            model,
            voice,
            textLength: String(text).length,
            online: true,
          },
        };
      } finally {
        signal?.removeEventListener("abort", linkedAbort);
        if (activeController === reqController) activeController = null;
      }
    },

    cancel() {
      if (activeController) {
        activeController.abort();
        activeController = null;
      }
    },
  };
}

export function pickTtsProvider({ kokoroEnabled, openaiApiKey, openaiVoice } = {}) {
  if (openaiApiKey) {
    return createOpenAITtsProvider({
      apiKey: openaiApiKey,
      voice: openaiVoice ?? "marin",
    });
  }
  if (kokoroEnabled !== false) {
    return createKokoroTtsProvider();
  }
  return createNullTtsProvider();
}
