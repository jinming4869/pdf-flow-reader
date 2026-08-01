function wavError(message) {
  const error = new Error(message);
  error.code = "TTS_WAV_FORMAT";
  return error;
}

export function parsePcmWav(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value ?? []);
  if (buffer.length < 44
    || buffer.toString("ascii", 0, 4) !== "RIFF"
    || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw wavError("TTS audio is not a RIFF/WAVE file");
  }

  let format = null;
  const dataChunks = [];
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > buffer.length) throw wavError(`Truncated WAV ${id} chunk`);
    if (id === "fmt ") {
      if (size < 16) throw wavError("WAV fmt chunk is too short");
      format = {
        audioFormat: buffer.readUInt16LE(start),
        channels: buffer.readUInt16LE(start + 2),
        sampleRate: buffer.readUInt32LE(start + 4),
        byteRate: buffer.readUInt32LE(start + 8),
        blockAlign: buffer.readUInt16LE(start + 12),
        bitsPerSample: buffer.readUInt16LE(start + 14),
      };
    } else if (id === "data") {
      dataChunks.push(buffer.subarray(start, end));
    }
    offset = end + (size % 2);
  }
  if (!format || dataChunks.length === 0) throw wavError("WAV fmt or data chunk is missing");
  if (format.audioFormat !== 1 || format.bitsPerSample !== 16) {
    throw wavError("Only PCM16 WAV audio can be joined");
  }
  const data = Buffer.concat(dataChunks);
  return {
    ...format,
    data,
    audioSeconds: data.length / format.byteRate,
  };
}

export function createPcm16Wav(dataValue, {
  sampleRate = 24_000,
  channels = 1,
} = {}) {
  const data = Buffer.isBuffer(dataValue) ? dataValue : Buffer.from(dataValue ?? []);
  const bitsPerSample = 16;
  const blockAlign = channels * (bitsPerSample / 8);
  if (data.length % blockAlign !== 0) throw wavError("PCM data is not frame-aligned");
  const output = Buffer.alloc(44 + data.length);
  output.write("RIFF", 0, "ascii");
  output.writeUInt32LE(output.length - 8, 4);
  output.write("WAVE", 8, "ascii");
  output.write("fmt ", 12, "ascii");
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(channels, 22);
  output.writeUInt32LE(sampleRate, 24);
  output.writeUInt32LE(sampleRate * blockAlign, 28);
  output.writeUInt16LE(blockAlign, 32);
  output.writeUInt16LE(bitsPerSample, 34);
  output.write("data", 36, "ascii");
  output.writeUInt32LE(data.length, 40);
  data.copy(output, 44);
  return output;
}

export function createPcm16WavFromFloat32(samplesValue, options = {}) {
  const samples = samplesValue instanceof Float32Array
    ? samplesValue
    : Float32Array.from(samplesValue ?? []);
  const data = Buffer.alloc(samples.length * 2);
  for (let index = 0; index < samples.length; index += 1) {
    const finite = Number.isFinite(samples[index]) ? samples[index] : 0;
    const clamped = Math.max(-1, Math.min(1, finite));
    const pcm = clamped < 0
      ? Math.round(clamped * 32_768)
      : Math.round(clamped * 32_767);
    data.writeInt16LE(pcm, index * 2);
  }
  return createPcm16Wav(data, options);
}

export function joinPcm16Wavs(values) {
  const parsed = values.map(parsePcmWav);
  if (parsed.length === 0) throw wavError("No WAV audio was supplied");
  const first = parsed[0];
  for (const item of parsed.slice(1)) {
    if (item.channels !== first.channels
      || item.sampleRate !== first.sampleRate
      || item.bitsPerSample !== first.bitsPerSample) {
      throw wavError("TTS WAV segments use incompatible PCM formats");
    }
  }
  return {
    audio: createPcm16Wav(Buffer.concat(parsed.map((item) => item.data)), {
      sampleRate: first.sampleRate,
      channels: first.channels,
    }),
    sampleRate: first.sampleRate,
    audioSeconds: parsed.reduce((sum, item) => sum + item.audioSeconds, 0),
  };
}
