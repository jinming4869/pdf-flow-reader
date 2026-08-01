import { join, resolve } from "node:path";

import { createMultilingualTtsRuntimeClient } from "../tts-multilingual-runtime-client.mjs";
import { createTtsRuntimeClient } from "../tts-runtime-client.mjs";
import { createTtsRuntimeRouter } from "../tts-runtime-router.mjs";
import { parsePcmWav } from "../wav-pcm.mjs";

function parseResourcesPath(argv) {
  const index = argv.indexOf("--resources");
  const value = index >= 0 ? argv[index + 1] : null;
  if (!value) throw new Error("Usage: node scripts/packaged-release-smoke.mjs --resources <path>");
  return resolve(value);
}

function verifyAudio(result) {
  const wav = parsePcmWav(result.audio);
  if (wav.sampleRate !== 24_000 || wav.channels !== 1 || wav.data.length < 1_000) {
    throw new Error(`Invalid packaged ${result.language} audio`);
  }
  return {
    language: result.language,
    voice: result.voice,
    bytes: result.audio.length,
    seconds: Number(wav.audioSeconds.toFixed(2)),
    model: result.model,
  };
}

async function main() {
  const resources = parseResourcesPath(process.argv.slice(2));
  process.env.PDF_FLOW_TTS_ENGLISH_MODELS_DIR = join(resources, "tts-english", "models");
  const english = createTtsRuntimeClient({ workerPath: join(resources, "app", "tts-worker.mjs") });
  const cjk = createMultilingualTtsRuntimeClient({ resourcesPath: resources });
  const router = createTtsRuntimeRouter({ englishRuntime: english, multilingualRuntime: cjk });
  try {
    for (const payload of [
      { text: "让 PDF 阅读像亲吻纸质书一样好玩。", language: "zh", speed: 1 },
      { text: "PDFを静かに読みます。", language: "ja", speed: 1 },
      { text: "A quiet voice reads beside you.", language: "en", speed: 1 },
    ]) {
      console.log(JSON.stringify(verifyAudio(await router.synthesize(payload))));
    }
  } finally {
    router.close();
  }

  const cancelClient = createMultilingualTtsRuntimeClient({ resourcesPath: resources });
  try {
    const controller = new AbortController();
    const abandoned = cancelClient.synthesize(
      { text: "旧请求需要立即停止。".repeat(80), language: "zh" },
      { signal: controller.signal },
    );
    setTimeout(() => controller.abort(), 30);
    await abandoned.then(
      () => { throw new Error("Cancelled request unexpectedly completed"); },
      (error) => { if (error.name !== "AbortError") throw error; },
    );
    const fresh = await cancelClient.synthesize({ text: "新请求已经重建。", language: "zh" });
    verifyAudio(fresh);
    console.log(JSON.stringify({ hardCancel: "passed", rebuiltBytes: fresh.audio.length }));
  } finally {
    cancelClient.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
