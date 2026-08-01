// tts-model-manager.mjs — 本地 TTS 模型状态管理（PRD §5.6）

import { createKokoroTtsProvider } from "./tts-provider.mjs";

export const MODEL_STATUS = Object.freeze({
  UNKNOWN: "unknown",
  NOT_DOWNLOADED: "not-downloaded",
  DOWNLOADING: "downloading",
  READY: "ready",
  ERROR: "error",
});

export const KOKORO_MODEL_META = Object.freeze({
  id: "kokoro-local-hybrid-v10",
  providerId: "kokoro-local",
  name: "Kokoro 本地中英日（q8 / int8）",
  source: "Kokoro-82M q8 + Kokoro v1.0 int8",
  approxSizeMb: 201,
  languages: ["en", "zh", "ja"],
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createTtsModelManager({
  providerFactory = createKokoroTtsProvider,
  modelMeta = KOKORO_MODEL_META,
  pollMs = 150,
  onStatusChange,
} = {}) {
  let status = MODEL_STATUS.UNKNOWN;
  let provider = null;
  let error = null;
  let progress = 0;
  let activeEnsure = null;

  function emit(extra = {}) {
    onStatusChange?.({ status, progress, error, model: modelMeta, ...extra });
  }

  function setStatus(next, extra = {}) {
    status = next;
    if (Object.hasOwn(extra, "progress")) progress = extra.progress;
    if (Object.hasOwn(extra, "error")) error = extra.error;
    emit(extra);
  }

  async function preloadProvider(p) {
    if (typeof p?.preload === "function") {
      await p.preload();
      return;
    }
    // Fallback for providers without explicit preload. Kept tiny and local.
    await p?.synthesize?.({ text: "准备希声。" });
  }

  async function ensureModel() {
    if (status === MODEL_STATUS.READY && provider) return provider;
    if (activeEnsure) return activeEnsure;

    activeEnsure = (async () => {
      setStatus(MODEL_STATUS.DOWNLOADING, { progress: 5, error: null });
      try {
        const nextProvider = providerFactory();
        setStatus(MODEL_STATUS.DOWNLOADING, { progress: 45 });
        await preloadProvider(nextProvider);
        provider = nextProvider;
        setStatus(MODEL_STATUS.READY, { progress: 100, error: null });
        return provider;
      } catch (e) {
        provider = null;
        setStatus(MODEL_STATUS.ERROR, {
          progress: 0,
          error: e instanceof Error ? e.message : String(e),
        });
        return null;
      } finally {
        activeEnsure = null;
      }
    })();

    return activeEnsure;
  }

  async function waitUntilReady({ timeoutMs = 30_000 } = {}) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (status === MODEL_STATUS.READY && provider) return provider;
      if (status === MODEL_STATUS.ERROR) return null;
      await sleep(pollMs);
    }
    return null;
  }

  function markNotDownloaded() {
    provider = null;
    setStatus(MODEL_STATUS.NOT_DOWNLOADED, { progress: 0, error: null });
  }

  function reset(reason = "reset") {
    provider?.cancel?.();
    provider = null;
    activeEnsure = null;
    setStatus(MODEL_STATUS.UNKNOWN, { progress: 0, error: null, reason });
  }

  function snapshot() {
    return {
      model: modelMeta,
      status,
      progress,
      error,
      ready: status === MODEL_STATUS.READY && Boolean(provider),
      hasProvider: Boolean(provider),
    };
  }

  return {
    ensureModel,
    waitUntilReady,
    markNotDownloaded,
    reset,
    snapshot,
    getProvider: () => provider,
    getStatus: () => status,
  };
}
