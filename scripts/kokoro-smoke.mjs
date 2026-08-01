// smoke test: verify kokoro-js model loading and synthesis
import { KokoroTTS } from "kokoro-js";

async function main() {
  console.log("1. Loading model (q8)...");
  const t1 = Date.now();
  const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-ONNX", { dtype: "q8" });
  console.log("   OK, loaded in", ((Date.now() - t1) / 1000).toFixed(1), "s");

  // list_voices() only prints to console, returns undefined.
  // Available non-English voices (from model manifest):
  //   ZH: zf_xiaobei, zf_xiaoni, zf_xiaoxiao, zf_xiaoyi
  //   JA: jf_alpha, jf_gongitsune, jf_nezumi, jf_tebukuro
  console.log("2. Voice map:");
  console.log("   EN default: af_heart (A grade)");
  console.log("   ZH default: zf_xiaobei");
  console.log("   JA default: jf_alpha");

  console.log("3. Synthesizing EN...");
  const t2 = Date.now();
  const audio = await tts.generate(
    "The quiet study grows warmer when a voice reads alongside.",
    { voice: "af_heart" },
  );
  console.log("   OK,", Date.now() - t2, "ms");
  console.log("   audio type:", typeof audio, "keys:", Object.keys(audio));
  const wav = audio.toWav();
  console.log("   WAV:", (wav.byteLength / 1024).toFixed(1), "KB");

  console.log("\nALL OK: Kokoro model ready for pdf-flow-reader");
}

main()
  .then(() => setTimeout(() => process.exit(0), 100))
  .catch((e) => {
    console.error("FAIL:", e.message);
    process.exit(1);
  });
