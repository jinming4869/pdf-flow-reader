import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createReaderServer } from "../server.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = dirname(dirname(scriptPath));
const outputRoot = resolve(repoRoot, "output", "speech", "integration-v10");
const manifestPath = resolve(repoRoot, "tmp", "speech", "integration-v10", "manifest.json");
const samples = [
  ...[1, 1.25, 1.5, 1.85].map((speed) => ({
    id: `zh-v10-http-${String(speed).replace(".", "")}`,
    text: "在二零二六年的测试里，PDF Reader 与 OCR 会陪着我们安静地阅读。",
    language: "mixed",
    voice: "zf_xiaobei",
    speed,
    expectedLanguage: "zh",
    expectedVoice: "zf_xiaobei",
  })),
  {
    id: "ja-v10-http-125",
    text: "ページはゆっくり流れ、静かな声が読者に寄り添います。",
    language: "cjk",
    voice: "zf_xiaobei",
    speed: 1.25,
    expectedLanguage: "ja",
    expectedVoice: "jf_alpha",
  },
];

function header(response, name) {
  return response.headers.get(name) ?? "";
}

async function waitForMultilingualBusy(origin, timeoutMs = 2_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const response = await fetch(`${origin}/tts/kokoro`);
    const status = (await response.json()).status;
    if (status?.multilingual === "busy") return true;
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  return false;
}

async function verifyHardCancellation(origin) {
  const controller = new AbortController();
  const request = fetch(`${origin}/tts/kokoro`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: "这是一段用于验证硬取消的长文本。".repeat(400),
      language: "zh",
      voice: "zf_xiaobei",
      speed: 1,
    }),
    signal: controller.signal,
  });
  const observedBusy = await waitForMultilingualBusy(origin);
  if (!observedBusy) throw new Error("hard-cancel check never observed an active CJK inference");
  controller.abort();
  try {
    await request;
  } catch (error) {
    if (error?.name === "AbortError") return { observedBusy: true, aborted: true };
    throw error;
  }
  throw new Error("hard-cancel check completed instead of aborting");
}

async function main() {
  mkdirSync(outputRoot, { recursive: true });
  mkdirSync(dirname(manifestPath), { recursive: true });
  const server = createReaderServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  const records = [];
  let cancelCheck = null;
  try {
    for (const [index, sample] of samples.entries()) {
      const response = await fetch(`${origin}/tts/kokoro`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sample),
      });
      if (!response.ok) {
        throw new Error(`${sample.id}: HTTP ${response.status} ${await response.text()}`);
      }
      const audio = Buffer.from(await response.arrayBuffer());
      if (audio.subarray(0, 4).toString("ascii") !== "RIFF") {
        throw new Error(`${sample.id}: response is not a RIFF WAV`);
      }
      const actualLanguage = header(response, "X-TTS-Language");
      const actualVoice = header(response, "X-TTS-Voice");
      if (actualLanguage !== sample.expectedLanguage || actualVoice !== sample.expectedVoice) {
        throw new Error(
          `${sample.id}: expected ${sample.expectedLanguage}/${sample.expectedVoice}, got ${actualLanguage}/${actualVoice}`,
        );
      }
      const outputPath = join(outputRoot, `${sample.id}.wav`);
      writeFileSync(outputPath, audio);
      records.push({
        id: sample.id,
        outputPath,
        byteLength: audio.byteLength,
        language: actualLanguage,
        voice: actualVoice,
        model: header(response, "X-TTS-Model"),
        dtype: header(response, "X-TTS-Dtype"),
        speed: Number(header(response, "X-TTS-Speed")),
        sampleRate: Number(header(response, "X-TTS-Sample-Rate")),
        durationMs: Number(header(response, "X-TTS-Duration-Ms")),
        unknownPhonemeCount: Number(header(response, "X-TTS-Unknown-Phonemes")),
      });
      if (index === 0) cancelCheck = await verifyHardCancellation(origin);
    }
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
  const manifest = { cancelCheck, samples: records };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
