import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const modulePath = fileURLToPath(import.meta.url);

async function loadKokoroModel() {
  const { KokoroTTS } = await import("kokoro-js");
  return KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-ONNX", { dtype: "q8" });
}

function wavBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  return Buffer.from(value ?? []);
}

function serializedError(error) {
  return {
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
    code: error?.code,
    stack: error instanceof Error ? error.stack : undefined,
  };
}

export function createKokoroWorkerRuntime({ loadModel = loadKokoroModel } = {}) {
  let modelPromise = null;
  let workTail = Promise.resolve();

  async function getModel() {
    if (!modelPromise) {
      const pending = Promise.resolve().then(() => loadModel());
      modelPromise = pending;
      try {
        return await pending;
      } catch (error) {
        if (modelPromise === pending) modelPromise = null;
        throw error;
      }
    }
    return modelPromise;
  }

  async function processMessage(message, send) {
    if (!message || message.type !== "synthesize" || !message.requestId) return;
    const startedAt = Date.now();
    try {
      const model = await getModel();
      const audio = await model.generate(message.payload?.text ?? "", {
        voice: message.payload?.voice,
        speed: message.payload?.speed,
      });
      send({
        type: "result",
        requestId: message.requestId,
        audio: wavBuffer(audio.toWav()),
        sampleRate: Number(audio.sampling_rate) || 24_000,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      send({
        type: "error",
        requestId: message.requestId,
        error: serializedError(error),
      });
    }
  }

  return {
    handleMessage(message, send) {
      const work = workTail.then(
        () => processMessage(message, send),
        () => processMessage(message, send),
      );
      workTail = work.catch(() => {});
      return work;
    },
  };
}

export function startKokoroWorker({
  processRef = process,
  runtime = createKokoroWorkerRuntime(),
} = {}) {
  const send = (message) => {
    if (processRef.connected === false || typeof processRef.send !== "function") return;
    processRef.send(message);
  };
  processRef.on("message", (message) => {
    void runtime.handleMessage(message, send);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
  startKokoroWorker();
}
