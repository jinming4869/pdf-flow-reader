import { createReadStream, existsSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { totalmem } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseByteRange } from "./http-range.mjs";
import { createTtsRuntimeRouter } from "./tts-runtime-router.mjs";

const modulePath = fileURLToPath(import.meta.url);
const defaultAppRoot = dirname(modulePath);

function createStaticFiles(appRoot) {
  return new Map([
    ["/", [join(appRoot, "index.html"), "text/html; charset=utf-8"]],
    ["/index.html", [join(appRoot, "index.html"), "text/html; charset=utf-8"]],
    ["/styles.css", [join(appRoot, "styles.css"), "text/css; charset=utf-8"]],
    ["/app.mjs", [join(appRoot, "app.mjs"), "text/javascript; charset=utf-8"]],
    ["/book-carousel.mjs", [join(appRoot, "book-carousel.mjs"), "text/javascript; charset=utf-8"]],
    ["/reading-trace.mjs", [join(appRoot, "reading-trace.mjs"), "text/javascript; charset=utf-8"]],
    ["/trace-session.mjs", [join(appRoot, "trace-session.mjs"), "text/javascript; charset=utf-8"]],
    ["/trace-client.mjs", [join(appRoot, "trace-client.mjs"), "text/javascript; charset=utf-8"]],
    ["/trace-capture-controller.mjs", [join(appRoot, "trace-capture-controller.mjs"), "text/javascript; charset=utf-8"]],
    ["/lasso-geometry.mjs", [join(appRoot, "lasso-geometry.mjs"), "text/javascript; charset=utf-8"]],
    ["/trace-crop.mjs", [join(appRoot, "trace-crop.mjs"), "text/javascript; charset=utf-8"]],
    ["/chunk-coordinate.mjs", [join(appRoot, "chunk-coordinate.mjs"), "text/javascript; charset=utf-8"]],
    ["/http-range.mjs", [join(appRoot, "http-range.mjs"), "text/javascript; charset=utf-8"]],
    ["/pdf-source.mjs", [join(appRoot, "pdf-source.mjs"), "text/javascript; charset=utf-8"]],
    ["/page-layout.mjs", [join(appRoot, "page-layout.mjs"), "text/javascript; charset=utf-8"]],
    ["/render-scheduler.mjs", [join(appRoot, "render-scheduler.mjs"), "text/javascript; charset=utf-8"]],
    ["/ocr-provider.mjs", [join(appRoot, "ocr-provider.mjs"), "text/javascript; charset=utf-8"]],
    ["/ocr-schedule.mjs", [join(appRoot, "ocr-schedule.mjs"), "text/javascript; charset=utf-8"]],
    ["/ocr-segment-adapter.mjs", [join(appRoot, "ocr-segment-adapter.mjs"), "text/javascript; charset=utf-8"]],
    ["/reading-model.mjs", [join(appRoot, "reading-model.mjs"), "text/javascript; charset=utf-8"]],
    ["/reading-rhythm.mjs", [join(appRoot, "reading-rhythm.mjs"), "text/javascript; charset=utf-8"]],
    ["/reading-clock.mjs", [join(appRoot, "reading-clock.mjs"), "text/javascript; charset=utf-8"]],
    ["/readable-chunk.mjs", [join(appRoot, "readable-chunk.mjs"), "text/javascript; charset=utf-8"]],
    ["/sound-engine.mjs", [join(appRoot, "sound-engine.mjs"), "text/javascript; charset=utf-8"]],
    ["/storage.mjs", [join(appRoot, "storage.mjs"), "text/javascript; charset=utf-8"]],
    ["/text-cleaner.mjs", [join(appRoot, "text-cleaner.mjs"), "text/javascript; charset=utf-8"]],
    ["/text-segment.mjs", [join(appRoot, "text-segment.mjs"), "text/javascript; charset=utf-8"]],
    ["/text-source-state.mjs", [join(appRoot, "text-source-state.mjs"), "text/javascript; charset=utf-8"]],
    ["/tts-audio-player.mjs", [join(appRoot, "tts-audio-player.mjs"), "text/javascript; charset=utf-8"]],
    ["/tts-aesthetic-walk.mjs", [join(appRoot, "tts-aesthetic-walk.mjs"), "text/javascript; charset=utf-8"]],
    ["/tts-controller.mjs", [join(appRoot, "tts-controller.mjs"), "text/javascript; charset=utf-8"]],
    ["/tts-model-manager.mjs", [join(appRoot, "tts-model-manager.mjs"), "text/javascript; charset=utf-8"]],
    ["/tts-paragraph-flow.mjs", [join(appRoot, "tts-paragraph-flow.mjs"), "text/javascript; charset=utf-8"]],
    ["/tts-policy.mjs", [join(appRoot, "tts-policy.mjs"), "text/javascript; charset=utf-8"]],
    ["/tts-point-gesture.mjs", [join(appRoot, "tts-point-gesture.mjs"), "text/javascript; charset=utf-8"]],
    ["/tts-point-sentence.mjs", [join(appRoot, "tts-point-sentence.mjs"), "text/javascript; charset=utf-8"]],
    ["/tts-point-session.mjs", [join(appRoot, "tts-point-session.mjs"), "text/javascript; charset=utf-8"]],
    ["/tts-preferences.mjs", [join(appRoot, "tts-preferences.mjs"), "text/javascript; charset=utf-8"]],
    ["/tts-provider.mjs", [join(appRoot, "tts-provider.mjs"), "text/javascript; charset=utf-8"]],
    ["/tts-scheduler.mjs", [join(appRoot, "tts-scheduler.mjs"), "text/javascript; charset=utf-8"]],
    ["/tts-sentence.mjs", [join(appRoot, "tts-sentence.mjs"), "text/javascript; charset=utf-8"]],
    ["/tts-segment-picker.mjs", [join(appRoot, "tts-segment-picker.mjs"), "text/javascript; charset=utf-8"]],
    ["/build/rhythm-motifs/snow-mist.svg", [join(appRoot, "build", "rhythm-motifs", "snow-mist.svg"), "image/svg+xml"]],
    ["/build/rhythm-motifs/aesthetic-walk.svg", [join(appRoot, "build", "rhythm-motifs", "aesthetic-walk.svg"), "image/svg+xml"]],
    ["/build/rhythm-motifs/long-day.svg", [join(appRoot, "build", "rhythm-motifs", "long-day.svg"), "image/svg+xml"]],
    ["/build/rhythm-motifs/winding-stream.svg", [join(appRoot, "build", "rhythm-motifs", "winding-stream.svg"), "image/svg+xml"]],
    ["/build/rhythm-motifs/strong-wind.svg", [join(appRoot, "build", "rhythm-motifs", "strong-wind.svg"), "image/svg+xml"]],
    ["/build/rhythm-motifs/all-things-flourish.svg", [join(appRoot, "build", "rhythm-motifs", "all-things-flourish.svg"), "image/svg+xml"]],
    ["/vendor/pdf.mjs", [join(appRoot, "vendor", "pdf.mjs"), "text/javascript; charset=utf-8"]],
    ["/vendor/pdf.worker.mjs", [join(appRoot, "vendor", "pdf.worker.mjs"), "text/javascript; charset=utf-8"]],
    ["/vendor/tesseract/tesseract.esm.min.js", [join(appRoot, "vendor", "tesseract", "tesseract.esm.min.js"), "text/javascript; charset=utf-8"]],
    ["/vendor/tesseract/worker.min.js", [join(appRoot, "vendor", "tesseract", "worker.min.js"), "text/javascript; charset=utf-8"]],
    ["/vendor/tesseract/core/tesseract-core-lstm.wasm.js", [join(appRoot, "vendor", "tesseract", "core", "tesseract-core-lstm.wasm.js"), "text/javascript; charset=utf-8"]],
    ["/vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js", [join(appRoot, "vendor", "tesseract", "core", "tesseract-core-simd-lstm.wasm.js"), "text/javascript; charset=utf-8"]],
    ["/vendor/tesseract/core/tesseract-core-relaxedsimd-lstm.wasm.js", [join(appRoot, "vendor", "tesseract", "core", "tesseract-core-relaxedsimd-lstm.wasm.js"), "text/javascript; charset=utf-8"]],
    ["/vendor/tesseract/lang/chi_sim.traineddata.gz", [join(appRoot, "vendor", "tesseract", "lang", "chi_sim.traineddata.gz"), "application/gzip"]],
    ["/vendor/tesseract/lang/chi_tra.traineddata.gz", [join(appRoot, "vendor", "tesseract", "lang", "chi_tra.traineddata.gz"), "application/gzip"]],
    ["/vendor/tesseract/lang/eng.traineddata.gz", [join(appRoot, "vendor", "tesseract", "lang", "eng.traineddata.gz"), "application/gzip"]],
    ["/vendor/tesseract/lang/jpn.traineddata.gz", [join(appRoot, "vendor", "tesseract", "lang", "jpn.traineddata.gz"), "application/gzip"]],
  ]);
}

function setCommonHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' blob: data:; worker-src 'self' blob:; connect-src 'self' blob:",
  );
}

function streamFile(
  request,
  response,
  filePath,
  streamOptions = undefined,
  observability = undefined,
) {
  const stream = createReadStream(filePath, streamOptions);
  let stoppedEarly = false;
  const stopStream = () => {
    if (stream.destroyed) return;
    if (!stoppedEarly) {
      stoppedEarly = true;
      observability?.onAborted?.();
    }
    stream.destroy();
  };

  request.once("aborted", stopStream);
  response.once("close", () => {
    if (!response.writableEnded) stopStream();
  });
  stream.once("error", (error) => {
    if (response.destroyed) return;
    if (response.headersSent) response.destroy(error);
    else {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("读取本地文件失败");
    }
  });
  if (observability?.onBytes) {
    stream.on("data", (chunk) => observability.onBytes(chunk.byteLength));
  }
  stream.pipe(response);
}

function sendStatic(request, response, filePath, contentType, cache = false) {
  let size;
  try {
    size = statSync(filePath).size;
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("没有这个页面");
    return;
  }

  response.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": size,
    "Cache-Control": cache ? "public, max-age=31536000, immutable" : "no-store",
  });
  if (request.method === "HEAD") response.end();
  else streamFile(request, response, filePath);
}

function sendPdf(request, response, pdfPath, diagnostics) {
  let size;
  try {
    size = statSync(pdfPath).size;
  } catch {
    response.writeHead(404, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(request.method === "HEAD" ? undefined : "PDF 文件已经被移动或删除");
    return;
  }
  const range = parseByteRange(request.headers.range, size);

  response.setHeader("Accept-Ranges", "bytes");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/pdf");

  if (range?.ok === false) {
    diagnostics.invalidRangeRequests += 1;
    response.writeHead(416, {
      "Content-Length": 0,
      "Content-Range": `bytes */${size}`,
    });
    response.end();
    return;
  }

  if (!range) {
    diagnostics.fullRequests += 1;
    response.writeHead(200, { "Content-Length": size });
    if (request.method === "HEAD") response.end();
    else streamFile(request, response, pdfPath, undefined, {
      onBytes: (bytes) => {
        diagnostics.fullBytesSent += bytes;
      },
      onAborted: () => {
        diagnostics.abortedStreams += 1;
      },
    });
    return;
  }

  diagnostics.rangeRequests += 1;
  response.writeHead(206, {
    "Content-Length": range.length,
    "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
  });
  if (request.method === "HEAD") response.end();
  else streamFile(
    request,
    response,
    pdfPath,
    { start: range.start, end: range.end },
    {
      onBytes: (bytes) => {
        diagnostics.rangeBytesSent += bytes;
      },
      onAborted: () => {
        diagnostics.abortedStreams += 1;
      },
    },
  );
}

function audioContentType(filePath) {
  const extension = extname(filePath).toLowerCase();
  if (extension === ".mp3") return "audio/mpeg";
  if (extension === ".wav") return "audio/wav";
  if (extension === ".ogg") return "audio/ogg";
  if (extension === ".m4a") return "audio/mp4";
  return null;
}

function sendJson(request, response, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
  });
  if (request.method === "HEAD") response.end();
  else response.end(body);
}

const KOKORO_SAFE_VOICES = new Set([
  "af_heart", "af_alloy", "af_aoede", "af_bella", "af_jessica", "af_kore", "af_nicole", "af_nova", "af_river", "af_sarah", "af_sky",
  "am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam", "am_michael", "am_onyx", "am_puck", "am_santa",
  "bf_emma", "bf_isabella", "bm_george", "bm_lewis", "bf_alice", "bf_lily", "bm_daniel", "bm_fable",
  "zf_xiaobei", "jf_alpha",
]);

function safeKokoroVoice(voice) {
  const normalized = String(voice ?? "af_heart").trim();
  return KOKORO_SAFE_VOICES.has(normalized) ? normalized : "af_heart";
}

function readRequestBody(request, maxBytes = 64_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    request.on("data", (chunk) => {
      total += chunk.byteLength;
      if (total > maxBytes) {
        reject(new Error("TTS 请求过大"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

async function handleKokoroTts(request, response, ttsRuntime) {
  if (request.method === "GET" || request.method === "HEAD") {
    sendJson(request, response, {
      provider: "kokoro-local",
      model: "language-routed-kokoro-onnx",
      models: {
        en: "onnx-community/Kokoro-82M-ONNX",
        zh: "kokoro-v1.0.int8.onnx",
        ja: "kokoro-v1.0.int8.onnx",
      },
      dtype: "q8",
      status: ttsRuntime.status(),
    });
    return;
  }
  if (request.method !== "POST") {
    response.writeHead(405, {
      Allow: "GET, HEAD, POST",
      "Content-Type": "text/plain; charset=utf-8",
    });
    response.end("只支持 TTS 查询或合成请求");
    return;
  }

  const controller = new AbortController();
  let finished = false;
  const abortInference = () => {
    if (!finished) controller.abort();
  };
  const abortOnClosedResponse = () => {
    if (!response.writableEnded) abortInference();
  };
  request.once("aborted", abortInference);
  response.once("close", abortOnClosedResponse);

  try {
    const raw = await readRequestBody(request);
    const payload = JSON.parse(raw || "{}");
    const text = String(payload.text ?? "").trim();
    const language = String(payload.language ?? "").trim() || null;
    const voice = safeKokoroVoice(payload.voice ?? "af_heart");
    const requestedSpeed = Number(payload.speed ?? 1);
    const ttsSpeed = Number.isFinite(requestedSpeed)
      ? Math.max(0.9, Math.min(1.85, requestedSpeed))
      : 1.15;
    if (!text) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("缺少需要朗读的文本");
      return;
    }

    const result = await ttsRuntime.synthesize(
      {
        text,
        language,
        voice,
        speed: ttsSpeed,
        generation: payload.generation ?? null,
        warmup: payload.warmup === true,
      },
      { signal: controller.signal },
    );
    if (controller.signal.aborted || response.destroyed || response.writableEnded) return;
    const body = result.audio;
    const actualVoice = result.voice ?? voice;
    const actualSpeed = Number.isFinite(result.speed) ? result.speed : ttsSpeed;
    const actualLanguage = result.language ?? language ?? "unknown";

    response.writeHead(200, {
      "Content-Type": "audio/wav",
      "Content-Length": body.byteLength,
      "Cache-Control": "no-store",
      "X-TTS-Provider": "kokoro-local",
      "X-TTS-Voice": actualVoice,
      "X-TTS-Language": actualLanguage,
      "X-TTS-Model": result.model ?? "onnx-community/Kokoro-82M-ONNX",
      "X-TTS-Dtype": result.dtype ?? "q8",
      "X-TTS-Speed": String(actualSpeed),
      "X-TTS-Duration-Ms": String(result.durationMs),
      "X-TTS-Sample-Rate": String(result.sampleRate),
      "X-TTS-Unknown-Phonemes": String(result.unknownPhonemeCount ?? 0),
    });
    response.end(body);
  } catch (error) {
    if (
      controller.signal.aborted
      || error?.name === "AbortError"
      || response.destroyed
      || response.writableEnded
    ) return;
    const status = error?.code === "TTS_TIMEOUT" ? 504 : 500;
    response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    response.end(error instanceof Error ? error.message : String(error));
  } finally {
    finished = true;
    request.removeListener("aborted", abortInference);
    response.removeListener("close", abortOnClosedResponse);
  }
}

export function createReaderServer({
  pdfPath = null,
  appRoot = defaultAppRoot,
  systemMemoryBytes = totalmem(),
  ttsRuntime = createTtsRuntimeRouter({ appRoot }),
} = {}) {
  const resolvedPdfPath = pdfPath ? resolve(pdfPath) : null;
  const staticFiles = createStaticFiles(appRoot);
  const pdfDiagnostics = {
    rangeRequests: 0,
    rangeBytesSent: 0,
    fullRequests: 0,
    fullBytesSent: 0,
    invalidRangeRequests: 0,
    abortedStreams: 0,
  };

  const server = createServer((request, response) => {
    setCommonHeaders(response);

    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/tts/kokoro") {
      void handleKokoroTts(request, response, ttsRuntime);
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, {
        Allow: "GET, HEAD",
        "Content-Type": "text/plain; charset=utf-8",
      });
      response.end("只支持读取请求");
      return;
    }

    if (url.pathname === "/document.pdf") {
      if (!resolvedPdfPath) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end(request.method === "HEAD" ? undefined : "请先选择一份 PDF");
        return;
      }
      sendPdf(request, response, resolvedPdfPath, pdfDiagnostics);
      return;
    }

    if (url.pathname === "/config.json") {
      let fileSize = null;
      if (resolvedPdfPath) {
        try {
          fileSize = statSync(resolvedPdfPath).size;
        } catch {
          // The file may have been moved after the local reader started.
        }
      }
      let lastModified = null;
      if (resolvedPdfPath && fileSize !== null) {
        try {
          lastModified = Math.round(statSync(resolvedPdfPath).mtimeMs);
        } catch {
          // Best-effort metadata for local reading memory.
        }
      }
      sendJson(request, response, {
        fileName: fileSize === null ? null : basename(resolvedPdfPath),
        fileSize,
        lastModified,
        systemMemoryGiB: Math.round((systemMemoryBytes / 2 ** 30) * 10) / 10,
      });
      return;
    }

    if (url.pathname === "/diagnostics.json") {
      sendJson(request, response, { httpRange: { ...pdfDiagnostics } });
      return;
    }

    if (url.pathname === "/heartbeat" || url.pathname === "/favicon.ico") {
      response.writeHead(204, { "Cache-Control": "no-store" });
      response.end();
      return;
    }

    if (url.pathname.startsWith("/build/sound-cues/")) {
      const filePath = resolve(appRoot, `.${decodeURIComponent(url.pathname)}`);
      const soundRoot = resolve(appRoot, "build", "sound-cues");
      const contentType = audioContentType(filePath);
      if (filePath.startsWith(soundRoot) && contentType) {
        sendStatic(request, response, filePath, contentType, true);
        return;
      }
    }

    const staticEntry = staticFiles.get(url.pathname);
    if (staticEntry) {
      const [filePath, contentType] = staticEntry;
      sendStatic(request, response, filePath, contentType, url.pathname.startsWith("/vendor/"));
      return;
    }

    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(request.method === "HEAD" ? undefined : "没有这个页面");
  });
  let ttsRuntimeClosed = false;
  const closeTtsRuntime = () => {
    if (ttsRuntimeClosed) return;
    ttsRuntimeClosed = true;
    ttsRuntime.close?.();
  };
  const closeHttpServer = server.close.bind(server);
  server.close = (callback) => {
    closeTtsRuntime();
    const result = closeHttpServer(callback);
    server.closeAllConnections?.();
    return result;
  };
  server.once("close", closeTtsRuntime);
  return server;
}

export function parseReaderCliArgs(cliArgs = []) {
  const startsWithPortFlag = cliArgs[0] === "--port-file";
  const idleMsIndex = cliArgs.indexOf("--idle-ms");
  const idleMs = idleMsIndex >= 0 ? Number(cliArgs[idleMsIndex + 1]) : 0;
  const positionalArgs = cliArgs.filter((arg, index) => {
    if (
      idleMsIndex >= 0 &&
      (index === idleMsIndex || index === idleMsIndex + 1)
    ) {
      return false;
    }
    return true;
  });
  const requestedPdf = startsWithPortFlag ? positionalArgs[2] : positionalArgs[0];
  const portFile = positionalArgs[1];
  return {
    idleMs,
    pdfPath: requestedPdf ? resolve(requestedPdf) : null,
    portFile,
    startsWithPortFlag,
  };
}

function startCli() {
  const {
    idleMs,
    pdfPath,
    portFile,
    startsWithPortFlag,
  } = parseReaderCliArgs(process.argv.slice(2));

  if (startsWithPortFlag && !portFile) {
    console.error("缺少 --port-file 的路径。");
    process.exit(1);
  }
  if (pdfPath && (!existsSync(pdfPath) || extname(pdfPath).toLowerCase() !== ".pdf")) {
    console.error(`PDF 文件不存在或格式不正确：${pdfPath}`);
    process.exit(1);
  }

  const server = createReaderServer({ pdfPath });
  let lastSeen = Date.now();
  server.on("request", () => {
    lastSeen = Date.now();
  });
  server.on("error", (error) => {
    if (portFile) {
      writeFileSync(portFile, JSON.stringify({ error: error.message }), "utf8");
    }
    console.error(error);
    process.exit(1);
  });
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") return;
    const info = { port: address.port, pid: process.pid };
    if (portFile) writeFileSync(portFile, JSON.stringify(info), "utf8");
    console.log(`夜晚的书斋已启动：http://127.0.0.1:${address.port}/`);
  });

  const idleTimer = Number.isFinite(idleMs) && idleMs > 0
    ? setInterval(() => {
        if (Date.now() - lastSeen > idleMs) {
          clearInterval(idleTimer);
          server.close(() => process.exit(0));
        }
      }, Math.min(30_000, Math.max(1000, idleMs)))
    : null;
  idleTimer?.unref?.();

  function cleanPortFile() {
    if (!portFile || !existsSync(portFile)) return;
    try {
      unlinkSync(portFile);
    } catch {
      // The launcher usually removes it first.
    }
  }

  process.on("exit", cleanPortFile);
  process.on("SIGINT", () => server.close(() => process.exit(0)));
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
}

if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
  startCli();
}
