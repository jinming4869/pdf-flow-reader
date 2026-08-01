import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const modulePath = fileURLToPath(import.meta.url);
const defaultAppRoot = dirname(modulePath);
const defaultWorkerPath = join(defaultAppRoot, "tts_multilingual_worker.py");

function abortError(message = "TTS request aborted") {
  const error = new Error(message);
  error.name = "AbortError";
  error.code = "ABORT_ERR";
  return error;
}

function runtimeError(message, code) {
  const error = new Error(message);
  if (code) error.code = code;
  return error;
}

function errorFromWorker(value) {
  const error = runtimeError(value?.message || "Multilingual TTS worker failed", value?.code);
  error.name = value?.name || "Error";
  return error;
}

function firstExisting(candidates, existsImpl) {
  return candidates.find((candidate) => candidate && existsImpl(candidate))
    ?? candidates.find(Boolean)
    ?? null;
}

export function resolveMultilingualTtsResources({
  appRoot = defaultAppRoot,
  resourcesPath = typeof process.resourcesPath === "string" ? process.resourcesPath : null,
  env = process.env,
  platform = process.platform,
  existsImpl = existsSync,
} = {}) {
  const pythonRelative = platform === "win32"
    ? join("python", "python.exe")
    : join("python", "bin", "python3");
  const devPythonRelative = platform === "win32"
    ? join("experiments", "tts-multilingual-poc", ".venv", "Scripts", "python.exe")
    : join("experiments", "tts-multilingual-poc", ".venv", "bin", "python");
  const packagedRoots = [
    resourcesPath ? join(resourcesPath, "tts-multilingual") : null,
    join(appRoot, "resources", "tts-multilingual"),
  ].filter(Boolean);

  return {
    pythonPath: firstExisting([
      env.PDF_FLOW_TTS_PYTHON,
      ...packagedRoots.map((root) => join(root, pythonRelative)),
      join(appRoot, devPythonRelative),
    ], existsImpl),
    modelsDir: firstExisting([
      env.PDF_FLOW_TTS_MODELS_DIR,
      ...packagedRoots.map((root) => join(root, "models")),
      join(appRoot, "experiments", "tts-multilingual-poc", "models"),
    ], existsImpl),
    workerPath: firstExisting([
      env.PDF_FLOW_TTS_WORKER,
      resourcesPath ? join(resourcesPath, "app", "tts_multilingual_worker.py") : null,
      defaultWorkerPath,
    ], existsImpl),
  };
}

export function createMultilingualTtsRuntimeClient({
  spawnImpl = spawn,
  appRoot = defaultAppRoot,
  resourcesPath,
  env = process.env,
  platform = process.platform,
  existsImpl = existsSync,
  pythonPath,
  modelsDir,
  workerPath,
  timeoutMs = 120_000,
  maxQueueSize = 8,
  createShadowDir = () => mkdtempSync(join(tmpdir(), "pdf-flow-reader-espeak-")),
  removeShadowDir = (path) => rmSync(path, { recursive: true, force: true }),
} = {}) {
  const discovered = resolveMultilingualTtsResources({
    appRoot,
    resourcesPath,
    env,
    platform,
    existsImpl,
  });
  const resources = {
    pythonPath: pythonPath ?? discovered.pythonPath,
    modelsDir: modelsDir ?? discovered.modelsDir,
    workerPath: workerPath ?? discovered.workerPath,
  };
  let child = null;
  let childReader = null;
  let childGeneration = 0;
  let active = null;
  let nextRequestId = 1;
  let closed = false;
  const queue = [];
  const childShadowDirs = new Map();

  function cleanupChildResources(processChild) {
    const shadowDir = childShadowDirs.get(processChild);
    if (!shadowDir) return;
    childShadowDirs.delete(processChild);
    try {
      removeShadowDir(shadowDir);
    } catch {
      // The OS temp directory remains recoverable and can be cleaned later.
    }
  }

  function assertResources() {
    const missing = Object.entries(resources)
      .filter(([, value]) => !value || !existsImpl(value))
      .map(([name, value]) => `${name}: ${value || "未配置"}`);
    if (missing.length) {
      throw runtimeError(
        `中日文语音资源未安装（${missing.join("；")}）。请先准备 v1.0 int8 模型与 Python runtime。`,
        "TTS_RESOURCES_MISSING",
      );
    }
  }

  function cleanupItem(item) {
    if (item.timer) {
      clearTimeout(item.timer);
      item.timer = null;
    }
    item.signal?.removeEventListener("abort", item.onAbort);
  }

  function rejectItem(item, error) {
    cleanupItem(item);
    item.reject(error);
  }

  function terminateCurrentChild() {
    const doomed = child;
    child = null;
    childGeneration += 1;
    childReader?.close();
    childReader = null;
    if (!doomed || doomed.killed) return;
    try {
      doomed.kill("SIGKILL");
    } catch {
      // The worker may already have exited.
    } finally {
      // SIGKILL prevents Python's finally blocks from running. The parent
      // owns this exact mkdtemp directory, so clean it synchronously here.
      cleanupChildResources(doomed);
    }
  }

  function finishActive(error, result) {
    const item = active;
    if (!item) return;
    active = null;
    cleanupItem(item);
    if (error) item.reject(error);
    else item.resolve(result);
    drain();
  }

  function failChild(processChild, generation, error) {
    cleanupChildResources(processChild);
    if (child !== processChild || childGeneration !== generation) return;
    child = null;
    childGeneration += 1;
    childReader?.close();
    childReader = null;
    if (active) finishActive(error);
    else drain();
  }

  function handleLine(processChild, generation, line) {
    if (child !== processChild || childGeneration !== generation) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      try {
        processChild.kill("SIGKILL");
      } catch {
        // The malformed worker may already have exited.
      } finally {
        cleanupChildResources(processChild);
      }
      failChild(
        processChild,
        generation,
        runtimeError("Multilingual TTS worker emitted invalid JSON", "TTS_PROTOCOL_ERROR"),
      );
      return;
    }
    if (!active || message?.requestId !== active.requestId) return;
    if (message.type === "result") {
      const result = message.result ?? {};
      const audio = Buffer.from(String(result.audioBase64 ?? ""), "base64");
      if (!audio.byteLength) {
        finishActive(runtimeError("Multilingual TTS worker returned empty audio", "TTS_EMPTY_AUDIO"));
        return;
      }
      finishActive(null, {
        audio,
        sampleRate: Number(result.sampleRate) || 24_000,
        durationMs: Number(result.durationMs) || 0,
        language: result.language,
        voice: result.voice,
        speed: Number(result.speed),
        model: result.model,
        dtype: result.dtype,
        audioSeconds: Number(result.audioSeconds) || 0,
        phonemeCount: Number(result.phonemeCount) || 0,
        unknownPhonemeCount: Number(result.unknownPhonemeCount) || 0,
      });
    } else if (message.type === "error") {
      finishActive(errorFromWorker(message.error));
    }
  }

  function ensureChild() {
    if (child && !child.killed && child.exitCode === null) return child;
    assertResources();
    const shadowDir = createShadowDir();
    let processChild;
    try {
      processChild = spawnImpl(
        resources.pythonPath,
        ["-u", resources.workerPath],
        {
          env: {
            ...env,
            PDF_FLOW_TTS_MODELS_DIR: resources.modelsDir,
            PDF_FLOW_TTS_ESPEAK_SHADOW_DIR: shadowDir,
            PYTHONUNBUFFERED: "1",
          },
          stdio: ["pipe", "pipe", "inherit"],
        },
      );
    } catch (error) {
      removeShadowDir(shadowDir);
      throw error;
    }
    childShadowDirs.set(processChild, shadowDir);
    child = processChild;
    const generation = ++childGeneration;
    const reader = createInterface({ input: processChild.stdout, crlfDelay: Infinity });
    childReader = reader;
    reader.on("line", (line) => handleLine(processChild, generation, line));
    processChild.once("error", (error) => failChild(processChild, generation, error));
    processChild.once("exit", (code, signal) => {
      failChild(
        processChild,
        generation,
        runtimeError(
          `Multilingual TTS worker exited before completing the request (${signal || (code ?? "unknown")})`,
          "TTS_WORKER_EXIT",
        ),
      );
    });
    return processChild;
  }

  function abortItem(item) {
    if (active === item) {
      active = null;
      rejectItem(item, abortError());
      terminateCurrentChild();
      drain();
      return;
    }
    const index = queue.indexOf(item);
    if (index >= 0) {
      queue.splice(index, 1);
      rejectItem(item, abortError());
    }
  }

  function drain() {
    if (closed || active || queue.length === 0) return;
    const item = queue.shift();
    if (item.signal?.aborted) {
      rejectItem(item, abortError());
      drain();
      return;
    }

    active = item;
    item.timer = setTimeout(() => {
      if (active !== item) return;
      active = null;
      rejectItem(item, runtimeError("Multilingual TTS inference timed out", "TTS_TIMEOUT"));
      terminateCurrentChild();
      drain();
    }, Math.max(1, timeoutMs));
    item.timer.unref?.();

    try {
      const processChild = ensureChild();
      processChild.stdin.write(`${JSON.stringify({
        type: "synthesize",
        requestId: item.requestId,
        payload: item.payload,
      })}\n`, (error) => {
        if (!error || active !== item || child !== processChild) return;
        active = null;
        terminateCurrentChild();
        rejectItem(item, error);
        drain();
      });
    } catch (error) {
      active = null;
      terminateCurrentChild();
      rejectItem(item, error);
      drain();
    }
  }

  function synthesize(payload, { signal } = {}) {
    if (closed) {
      return Promise.reject(runtimeError("Multilingual TTS runtime is closed", "TTS_RUNTIME_CLOSED"));
    }
    if (signal?.aborted) return Promise.reject(abortError());
    if (active && queue.length >= Math.max(0, maxQueueSize)) {
      return Promise.reject(runtimeError("Multilingual TTS queue is full", "TTS_BACKPRESSURE"));
    }

    return new Promise((resolve, reject) => {
      const item = {
        requestId: String(nextRequestId++),
        payload,
        signal,
        resolve,
        reject,
        timer: null,
        onAbort: null,
      };
      item.onAbort = () => abortItem(item);
      signal?.addEventListener("abort", item.onAbort, { once: true });
      queue.push(item);
      drain();
    });
  }

  function close() {
    if (closed) return;
    closed = true;
    const error = runtimeError("Multilingual TTS runtime is closed", "TTS_RUNTIME_CLOSED");
    if (active) {
      const item = active;
      active = null;
      rejectItem(item, error);
    }
    while (queue.length) rejectItem(queue.shift(), error);
    terminateCurrentChild();
  }

  return {
    synthesize,
    close,
    resources: { ...resources },
    status() {
      if (closed) return "closed";
      if (active) return "busy";
      return child ? "loading-or-ready" : "not-loaded";
    },
  };
}
