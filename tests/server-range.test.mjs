import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createReaderServer } from "../server.mjs";

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
  assert.deepEqual(await config.json(), {
    fileName: pdfName,
    fileSize: bytes.length,
    systemMemoryGiB: 16,
  });

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

  const streamed = await fetch(`${origin}/http-range.mjs`, {
    headers: { Connection: "close" },
  });
  const body = await streamed.text();
  assert.equal(streamed.status, 200);
  assert.equal(Number(streamed.headers.get("content-length")), Buffer.byteLength(body));
  assert.match(body, /export function parseByteRange/);
});
