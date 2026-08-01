import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULT_WORKER_PATH = fileURLToPath(new URL("./tts-worker.mjs", import.meta.url));

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
  const error = runtimeError(value?.message || "TTS worker failed", value?.code);
  error.name = value?.name || "Error";
  if (value?.stack) error.stack = value.stack;
  return error;
}

export function createTtsRuntimeClient({
  forkImpl = fork,
  workerPath = DEFAULT_WORKER_PATH,
  timeoutMs = 120_000,
  maxQueueSize = 8,
} = {}) {
  let child = null;
  let childGeneration = 0;
  let active = null;
  let nextRequestId = 1;
  let closed = false;
  const queue = [];

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
    if (!doomed || doomed.killed) return;
    try {
      doomed.kill("SIGKILL");
    } catch {
      // The process may already have exited between the state check and kill.
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
    if (child !== processChild || childGeneration !== generation) return;
    child = null;
    childGeneration += 1;
    if (active) finishActive(error);
    else drain();
  }

  function ensureChild() {
    if (child && child.connected !== false && !child.killed) return child;
    const processChild = forkImpl(workerPath, [], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
      },
      serialization: "advanced",
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    });
    child = processChild;
    const generation = ++childGeneration;
    processChild.on("message", (message) => {
      if (child !== processChild || childGeneration !== generation || !active) return;
      if (!message || message.requestId !== active.requestId) return;
      if (message.type === "result") {
        const audio = Buffer.isBuffer(message.audio)
          ? message.audio
          : Buffer.from(message.audio ?? []);
        finishActive(null, {
          audio,
          sampleRate: Number(message.sampleRate) || 24_000,
          durationMs: Number(message.durationMs) || 0,
        });
      } else if (message.type === "error") {
        finishActive(errorFromWorker(message.error));
      }
    });
    processChild.once("error", (error) => {
      failChild(processChild, generation, error);
    });
    processChild.once("exit", (code, signal) => {
      failChild(
        processChild,
        generation,
        runtimeError(
          `TTS worker exited before completing the request (${signal || (code ?? "unknown")})`,
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
      rejectItem(item, runtimeError("TTS inference timed out", "TTS_TIMEOUT"));
      terminateCurrentChild();
      drain();
    }, Math.max(1, timeoutMs));
    item.timer.unref?.();

    let processChild;
    try {
      processChild = ensureChild();
      processChild.send({
        type: "synthesize",
        requestId: item.requestId,
        payload: item.payload,
      });
    } catch (error) {
      active = null;
      terminateCurrentChild();
      rejectItem(item, error);
      drain();
      return;
    }
  }

  function synthesize(payload, { signal } = {}) {
    if (closed) {
      return Promise.reject(runtimeError("TTS runtime is closed", "TTS_RUNTIME_CLOSED"));
    }
    if (signal?.aborted) return Promise.reject(abortError());
    if (active && queue.length >= Math.max(0, maxQueueSize)) {
      return Promise.reject(runtimeError("TTS queue is full", "TTS_BACKPRESSURE"));
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
    const error = runtimeError("TTS runtime is closed", "TTS_RUNTIME_CLOSED");
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
    status() {
      if (closed) return "closed";
      if (active) return "busy";
      return child ? "loading-or-ready" : "not-loaded";
    },
  };
}
