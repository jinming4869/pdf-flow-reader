import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  createReaderServer,
  parseReaderCliArgs,
} from "../server.mjs";

async function startServer(pdfPath) {
  const server = createReaderServer({ pdfPath, systemMemoryBytes: 16 * 2 ** 30 });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    server,
    origin: `http://127.0.0.1:${address.port}`,
  };
}

test("server streams Unicode-path PDFs with HEAD, 206, and 416 semantics", async (t) => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "缓缓读 range 测试-"));
  const pdfName = "Long book 长文档 测试.pdf";
  const pdfPath = join(fixtureRoot, pdfName);
  const bytes = Buffer.from("0123456789abcdefghijklmnopqrstuvwxyz", "utf8");
  writeFileSync(pdfPath, bytes);
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

  const { server, origin } = await startServer(pdfPath);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const head = await fetch(`${origin}/document.pdf`, {
    method: "HEAD",
    headers: { Connection: "close" },
  });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), String(bytes.length));
  assert.equal(head.headers.get("accept-ranges"), "bytes");
  assert.equal(await head.text(), "");

  const closed = await fetch(`${origin}/document.pdf`, {
    headers: { Range: "bytes=5-9", Connection: "close" },
  });
  assert.equal(closed.status, 206);
  assert.equal(closed.headers.get("content-range"), `bytes 5-9/${bytes.length}`);
  assert.equal(closed.headers.get("content-length"), "5");
  assert.equal(await closed.text(), "56789");

  const openEnded = await fetch(`${origin}/document.pdf`, {
    headers: { Range: "bytes=30-", Connection: "close" },
  });
  assert.equal(openEnded.status, 206);
  assert.equal(await openEnded.text(), "uvwxyz");

  const suffix = await fetch(`${origin}/document.pdf`, {
    headers: { Range: "bytes=-4", Connection: "close" },
  });
  assert.equal(suffix.status, 206);
  assert.equal(await suffix.text(), "wxyz");

  const rangeHead = await fetch(`${origin}/document.pdf`, {
    method: "HEAD",
    headers: { Range: "bytes=1-3", Connection: "close" },
  });
  assert.equal(rangeHead.status, 206);
  assert.equal(rangeHead.headers.get("content-range"), `bytes 1-3/${bytes.length}`);
  assert.equal(await rangeHead.text(), "");

  for (const range of ["bytes=999-", "bytes=1-2,4-5", "bytes=8-3"]) {
    const response = await fetch(`${origin}/document.pdf`, {
      headers: { Range: range, Connection: "close" },
    });
    assert.equal(response.status, 416);
    assert.equal(response.headers.get("content-range"), `bytes */${bytes.length}`);
  }

  const config = await fetch(`${origin}/config.json`, {
    headers: { Connection: "close" },
  });
  const configJson = await config.json();
  assert.equal(configJson.fileName, pdfName);
  assert.equal(configJson.fileSize, bytes.length);
  assert.equal(configJson.systemMemoryGiB, 16);
  assert.equal(typeof configJson.lastModified, "number");
  assert.ok(configJson.lastModified > 0);

  rmSync(pdfPath);
  const missingPdf = await fetch(`${origin}/document.pdf`, {
    headers: { Range: "bytes=0-3", Connection: "close" },
  });
  assert.equal(missingPdf.status, 404);
  assert.match(await missingPdf.text(), /移动或删除/);

  const missingConfig = await fetch(`${origin}/config.json`, {
    headers: { Connection: "close" },
  });
  assert.deepEqual(await missingConfig.json(), {
    fileName: null,
    fileSize: null,
    lastModified: null,
    systemMemoryGiB: 16,
  });

  const diagnostics = await fetch(`${origin}/diagnostics.json`, {
    headers: { Connection: "close" },
  });
  assert.deepEqual(await diagnostics.json(), {
    httpRange: {
      rangeRequests: 4,
      rangeBytesSent: 15,
      fullRequests: 1,
      fullBytesSent: 0,
      invalidRangeRequests: 3,
      abortedStreams: 0,
    },
  });
});

test("CLI keeps the PDF positional argument when --idle-ms is absent", () => {
  const parsed = parseReaderCliArgs([
    "/tmp/一本书.pdf",
    "/tmp/reader-port.json",
  ]);

  assert.equal(parsed.pdfPath, resolve("/tmp/一本书.pdf"));
  assert.equal(parsed.portFile, "/tmp/reader-port.json");
  assert.equal(parsed.idleMs, 0);
  assert.equal(parsed.startsWithPortFlag, false);
});

test("CLI removes an explicit --idle-ms pair without shifting PDF arguments", () => {
  const parsed = parseReaderCliArgs([
    "/tmp/一本书.pdf",
    "/tmp/reader-port.json",
    "--idle-ms",
    "30000",
  ]);

  assert.equal(parsed.pdfPath, resolve("/tmp/一本书.pdf"));
  assert.equal(parsed.portFile, "/tmp/reader-port.json");
  assert.equal(parsed.idleMs, 30000);
});

test("CLI supports --port-file with and without a PDF path", () => {
  const withoutPdf = parseReaderCliArgs([
    "--port-file",
    "/tmp/reader-port.json",
  ]);
  const withPdf = parseReaderCliArgs([
    "--port-file",
    "/tmp/reader-port.json",
    "/tmp/一本书.pdf",
  ]);

  assert.equal(withoutPdf.pdfPath, null);
  assert.equal(withoutPdf.portFile, "/tmp/reader-port.json");
  assert.equal(withoutPdf.startsWithPortFlag, true);
  assert.equal(withPdf.pdfPath, resolve("/tmp/一本书.pdf"));
  assert.equal(withPdf.portFile, "/tmp/reader-port.json");
});

test("registered static assets use Content-Length and support HEAD", async (t) => {
  const { server, origin } = await startServer(null);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const head = await fetch(`${origin}/vendor/pdf.mjs`, {
    method: "HEAD",
    headers: { Connection: "close" },
  });
  assert.equal(head.status, 200);
  assert.match(head.headers.get("content-type"), /text\/javascript/);
  assert.ok(Number(head.headers.get("content-length")) > 100_000);
  assert.equal(await head.text(), "");

  const motif = await fetch(`${origin}/build/rhythm-motifs/snow-mist.svg`, {
    method: "HEAD",
    headers: { Connection: "close" },
  });
  assert.equal(motif.status, 200);
  assert.equal(motif.headers.get("content-type"), "image/svg+xml");
  assert.ok(Number(motif.headers.get("content-length")) > 100);

  const soundCue = await fetch(`${origin}/build/sound-cues/up-1.m4a`, {
    method: "HEAD",
    headers: { Connection: "close" },
  });
  assert.equal(soundCue.status, 200);
  assert.equal(soundCue.headers.get("content-type"), "audio/mp4");
  assert.ok(Number(soundCue.headers.get("content-length")) > 1000);

  const coordinateModule = await fetch(`${origin}/chunk-coordinate.mjs`, {
    method: "HEAD",
    headers: { Connection: "close" },
  });
  assert.equal(coordinateModule.status, 200);
  assert.match(coordinateModule.headers.get("content-type"), /text\/javascript/);
  assert.ok(Number(coordinateModule.headers.get("content-length")) > 1000);

  const readableChunkModule = await fetch(`${origin}/readable-chunk.mjs`, {
    method: "HEAD",
    headers: { Connection: "close" },
  });
  assert.equal(readableChunkModule.status, 200);
  assert.match(readableChunkModule.headers.get("content-type"), /text\/javascript/);
  assert.ok(Number(readableChunkModule.headers.get("content-length")) > 1000);

  const ocrSegmentAdapter = await fetch(`${origin}/ocr-segment-adapter.mjs`, {
    method: "HEAD",
    headers: { Connection: "close" },
  });
  assert.equal(ocrSegmentAdapter.status, 200);
  assert.match(ocrSegmentAdapter.headers.get("content-type"), /text\/javascript/);
  assert.ok(Number(ocrSegmentAdapter.headers.get("content-length")) > 1000);

  const ocrSchedule = await fetch(`${origin}/ocr-schedule.mjs`, {
    method: "HEAD",
    headers: { Connection: "close" },
  });
  assert.equal(ocrSchedule.status, 200);
  assert.match(ocrSchedule.headers.get("content-type"), /text\/javascript/);
  assert.ok(Number(ocrSchedule.headers.get("content-length")) > 1000);

  const textSourceState = await fetch(`${origin}/text-source-state.mjs`, {
    method: "HEAD",
    headers: { Connection: "close" },
  });
  assert.equal(textSourceState.status, 200);
  assert.match(textSourceState.headers.get("content-type"), /text\/javascript/);
  assert.ok(Number(textSourceState.headers.get("content-length")) > 1000);

  for (const moduleName of [
    "book-carousel.mjs",
    "tts-audio-player.mjs",
    "tts-aesthetic-walk.mjs",
    "tts-controller.mjs",
    "tts-model-manager.mjs",
    "tts-paragraph-flow.mjs",
    "tts-policy.mjs",
    "tts-point-sentence.mjs",
    "tts-point-session.mjs",
    "tts-preferences.mjs",
    "tts-scheduler.mjs",
    "tts-sentence.mjs",
  ]) {
    const response = await fetch(`${origin}/${moduleName}`, {
      method: "HEAD",
      headers: { Connection: "close" },
    });
    assert.equal(response.status, 200, moduleName);
    assert.match(response.headers.get("content-type"), /text\/javascript/);
    assert.ok(Number(response.headers.get("content-length")) > 1000, moduleName);
  }

  const pointGesture = await fetch(`${origin}/tts-point-gesture.mjs`, {
    method: "HEAD",
    headers: { Connection: "close" },
  });
  assert.equal(pointGesture.status, 200);
  assert.match(pointGesture.headers.get("content-type"), /text\/javascript/);
  assert.ok(Number(pointGesture.headers.get("content-length")) > 200);

  const kokoroStatus = await fetch(`${origin}/tts/kokoro`, {
    headers: { Connection: "close" },
  });
  assert.equal(kokoroStatus.status, 200);
  const kokoroJson = await kokoroStatus.json();
  assert.equal(kokoroJson.provider, "kokoro-local");
  assert.equal(kokoroJson.dtype, "q8");

  const streamed = await fetch(`${origin}/http-range.mjs`, {
    headers: { Connection: "close" },
  });
  const body = await streamed.text();
  assert.equal(streamed.status, 200);
  assert.equal(Number(streamed.headers.get("content-length")), Buffer.byteLength(body));
  assert.match(body, /export function parseByteRange/);
});
