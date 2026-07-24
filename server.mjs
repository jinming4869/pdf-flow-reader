import { createReadStream, existsSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { totalmem } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseByteRange } from "./http-range.mjs";

const modulePath = fileURLToPath(import.meta.url);
const defaultAppRoot = dirname(modulePath);

function createStaticFiles(appRoot) {
  return new Map([
    ["/", [join(appRoot, "index.html"), "text/html; charset=utf-8"]],
    ["/index.html", [join(appRoot, "index.html"), "text/html; charset=utf-8"]],
    ["/styles.css", [join(appRoot, "styles.css"), "text/css; charset=utf-8"]],
    ["/app.mjs", [join(appRoot, "app.mjs"), "text/javascript; charset=utf-8"]],
    ["/http-range.mjs", [join(appRoot, "http-range.mjs"), "text/javascript; charset=utf-8"]],
    ["/pdf-source.mjs", [join(appRoot, "pdf-source.mjs"), "text/javascript; charset=utf-8"]],
    ["/page-layout.mjs", [join(appRoot, "page-layout.mjs"), "text/javascript; charset=utf-8"]],
    ["/render-scheduler.mjs", [join(appRoot, "render-scheduler.mjs"), "text/javascript; charset=utf-8"]],
    ["/ocr-provider.mjs", [join(appRoot, "ocr-provider.mjs"), "text/javascript; charset=utf-8"]],
    ["/reading-model.mjs", [join(appRoot, "reading-model.mjs"), "text/javascript; charset=utf-8"]],
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

export function createReaderServer({
  pdfPath = null,
  appRoot = defaultAppRoot,
  systemMemoryBytes = totalmem(),
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

  return createServer((request, response) => {
    setCommonHeaders(response);

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, {
        Allow: "GET, HEAD",
        "Content-Type": "text/plain; charset=utf-8",
      });
      response.end("只支持读取请求");
      return;
    }

    const url = new URL(request.url ?? "/", "http://127.0.0.1");
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
      sendJson(request, response, {
        fileName: fileSize === null ? null : basename(resolvedPdfPath),
        fileSize,
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

    const staticEntry = staticFiles.get(url.pathname);
    if (staticEntry) {
      const [filePath, contentType] = staticEntry;
      sendStatic(request, response, filePath, contentType, url.pathname.startsWith("/vendor/"));
      return;
    }

    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(request.method === "HEAD" ? undefined : "没有这个页面");
  });
}

function startCli() {
  const cliArgs = process.argv.slice(2);
  const startsWithPortFlag = cliArgs[0] === "--port-file";
  const requestedPdf = startsWithPortFlag ? cliArgs[2] : cliArgs[0];
  const portFile = cliArgs[1];
  const pdfPath = requestedPdf ? resolve(requestedPdf) : null;

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
    console.log(`缓缓读已启动：http://127.0.0.1:${address.port}/`);
  });

  const idleTimer = setInterval(() => {
    if (Date.now() - lastSeen > 150_000) {
      clearInterval(idleTimer);
      server.close(() => process.exit(0));
    }
  }, 30_000);

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
