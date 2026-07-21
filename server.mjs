import { createReadStream, existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = dirname(fileURLToPath(import.meta.url));
const requestedPdf = process.argv[2];
const portFile = process.argv[3];

if (!requestedPdf) {
  console.error("请指定要阅读的 PDF 文件。");
  process.exit(1);
}

const pdfPath = resolve(requestedPdf);
if (!existsSync(pdfPath) || extname(pdfPath).toLowerCase() !== ".pdf") {
  console.error(`PDF 文件不存在或格式不正确：${pdfPath}`);
  process.exit(1);
}

const staticFiles = new Map([
  ["/", [join(appRoot, "index.html"), "text/html; charset=utf-8"]],
  ["/index.html", [join(appRoot, "index.html"), "text/html; charset=utf-8"]],
  ["/styles.css", [join(appRoot, "styles.css"), "text/css; charset=utf-8"]],
  ["/app.mjs", [join(appRoot, "app.mjs"), "text/javascript; charset=utf-8"]],
  ["/vendor/pdf.mjs", [join(appRoot, "vendor", "pdf.mjs"), "text/javascript; charset=utf-8"]],
  ["/vendor/pdf.worker.mjs", [join(appRoot, "vendor", "pdf.worker.mjs"), "text/javascript; charset=utf-8"]],
]);

let lastSeen = Date.now();

function setCommonHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; worker-src 'self' blob:; connect-src 'self' blob:",
  );
}

function sendStatic(response, filePath, contentType, cache = false) {
  const file = readFileSync(filePath);
  response.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": file.length,
    "Cache-Control": cache ? "public, max-age=31536000, immutable" : "no-store",
  });
  response.end(file);
}

function sendPdf(request, response) {
  const size = statSync(pdfPath).size;
  const range = request.headers.range;

  response.setHeader("Accept-Ranges", "bytes");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/pdf");

  if (!range) {
    response.writeHead(200, { "Content-Length": size });
    createReadStream(pdfPath).pipe(response);
    return;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) {
    response.writeHead(416, { "Content-Range": `bytes */${size}` });
    response.end();
    return;
  }

  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    response.writeHead(416, { "Content-Range": `bytes */${size}` });
    response.end();
    return;
  }

  response.writeHead(206, {
    "Content-Length": end - start + 1,
    "Content-Range": `bytes ${start}-${end}/${size}`,
  });
  createReadStream(pdfPath, { start, end }).pipe(response);
}

const server = createServer((request, response) => {
  lastSeen = Date.now();
  setCommonHeaders(response);

  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/document.pdf") {
    sendPdf(request, response);
    return;
  }

  if (url.pathname === "/config.json") {
    const body = Buffer.from(JSON.stringify({ fileName: basename(pdfPath) }));
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": body.length,
      "Cache-Control": "no-store",
    });
    response.end(body);
    return;
  }

  if (url.pathname === "/heartbeat") {
    response.writeHead(204, { "Cache-Control": "no-store" });
    response.end();
    return;
  }

  if (url.pathname === "/favicon.ico") {
    response.writeHead(204);
    response.end();
    return;
  }

  const staticEntry = staticFiles.get(url.pathname);
  if (staticEntry) {
    const [filePath, contentType] = staticEntry;
    sendStatic(response, filePath, contentType, url.pathname.startsWith("/vendor/"));
    return;
  }

  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("没有这个页面");
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
