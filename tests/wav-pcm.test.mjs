import assert from "node:assert/strict";
import test from "node:test";

import {
  createPcm16Wav,
  createPcm16WavFromFloat32,
  joinPcm16Wavs,
  parsePcmWav,
} from "../wav-pcm.mjs";

test("PCM16 WAV helpers preserve format and concatenate frames", () => {
  const first = createPcm16Wav(Buffer.from([1, 0, 2, 0]));
  const second = createPcm16Wav(Buffer.from([3, 0]));
  const joined = joinPcm16Wavs([first, second]);
  const parsed = parsePcmWav(joined.audio);
  assert.equal(parsed.sampleRate, 24_000);
  assert.equal(parsed.channels, 1);
  assert.equal(parsed.bitsPerSample, 16);
  assert.deepEqual([...parsed.data], [1, 0, 2, 0, 3, 0]);
});

test("WAV join rejects incompatible sample rates", () => {
  const first = createPcm16Wav(Buffer.from([1, 0]));
  const second = createPcm16Wav(Buffer.from([2, 0]), { sampleRate: 22_050 });
  assert.throws(() => joinPcm16Wavs([first, second]), { code: "TTS_WAV_FORMAT" });
});

test("Float32 samples are normalized to bounded PCM16 WAV frames", () => {
  const wav = createPcm16WavFromFloat32(new Float32Array([-2, -0.5, 0, 0.5, 2, Number.NaN]));
  const parsed = parsePcmWav(wav);
  assert.equal(parsed.bitsPerSample, 16);
  assert.deepEqual([
    parsed.data.readInt16LE(0),
    parsed.data.readInt16LE(2),
    parsed.data.readInt16LE(4),
    parsed.data.readInt16LE(6),
    parsed.data.readInt16LE(8),
    parsed.data.readInt16LE(10),
  ], [-32_768, -16_384, 0, 16_384, 32_767, 0]);
});
