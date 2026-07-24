import assert from "node:assert/strict";
import test from "node:test";

// The browser build of PDF.js initializes this DOM type at module load time.
// Range transport itself does not use matrix operations in these Node tests.
globalThis.DOMMatrix ??= class DOMMatrix {};
globalThis.Uint8Array.prototype.toHex ??= function toHex() {
  return [...this].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const {
  createFilePdfSource,
} = await import("../pdf-source.mjs");
const pdfjsLib = await import("../vendor/pdf.mjs");
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "../vendor/pdf.worker.mjs",
  import.meta.url,
).href;

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

function onePagePdfBytes() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> /Contents 4 0 R >>",
    "<< /Length 5 >>\nstream\nBT ET\nendstream",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /ID [<00112233445566778899AABBCCDDEEFF><00112233445566778899AABBCCDDEEFF>] >>\n`;
  body += `startxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

test("File source reads an initial chunk and requested slices without copying the whole file", async () => {
  const bytes = Uint8Array.from({ length: 64 }, (_, index) => index);
  const slices = [];
  const file = {
    size: bytes.length,
    arrayBuffer() {
      throw new Error("whole-file arrayBuffer must not be called");
    },
    slice(begin, end) {
      slices.push([begin, end]);
      return new Blob([bytes.slice(begin, end)]);
    },
  };

  const source = await createFilePdfSource(file, { rangeChunkSize: 16 });
  assert.equal(source.length, 64);
  assert.equal(source.rangeChunkSize, 16);
  assert.equal(source.disableStream, true);
  assert.equal(source.disableAutoFetch, true);

  const deliveries = [];
  source.range.addRangeListener((begin, chunk) => {
    deliveries.push([begin, [...chunk]]);
  });
  source.range.requestDataRange(8, 13);
  await nextTurn();

  assert.deepEqual(slices, [[0, 16], [8, 13]]);
  assert.deepEqual(deliveries, [[8, [8, 9, 10, 11, 12]]]);
  assert.deepEqual(source.range.diagnostics, {
    requests: 2,
    completed: 2,
    failed: 0,
    aborted: 0,
    bytesRead: 21,
    inFlight: 0,
    isAborted: false,
  });
});

test("abort prevents a late slice result from reaching PDF.js", async () => {
  let releaseRead;
  const delayedRead = new Promise((resolve) => {
    releaseRead = resolve;
  });
  const file = {
    size: 32,
    slice(begin, end) {
      if (begin === 0) return new Blob([new Uint8Array(end - begin)]);
      return { arrayBuffer: () => delayedRead };
    },
  };
  const source = await createFilePdfSource(file, { rangeChunkSize: 8 });
  const deliveries = [];
  source.range.addRangeListener((begin, chunk) => deliveries.push([begin, chunk]));

  source.range.requestDataRange(8, 16);
  await nextTurn();
  source.range.abort();
  releaseRead(Uint8Array.from({ length: 8 }, (_, index) => index).buffer);
  await nextTurn();

  assert.deepEqual(deliveries, []);
  assert.deepEqual(source.range.diagnostics, {
    requests: 2,
    completed: 1,
    failed: 0,
    aborted: 1,
    bytesRead: 8,
    inFlight: 0,
    isAborted: true,
  });
});

test("AbortSignal cancels the transport and options are validated", async () => {
  const controller = new AbortController();
  const file = new Blob([new Uint8Array(10)]);
  const source = await createFilePdfSource(file, { signal: controller.signal });
  controller.abort();

  assert.equal(source.range.diagnostics.isAborted, true);
  await assert.rejects(() => createFilePdfSource(new Blob([])), TypeError);
  await assert.rejects(
    () => createFilePdfSource(file, { rangeChunkSize: 0 }),
    RangeError,
  );
});

test("File range source opens a real PDF.js document", async () => {
  const bytes = onePagePdfBytes();
  const slices = [];
  const file = {
    size: bytes.byteLength,
    arrayBuffer() {
      throw new Error("whole-file arrayBuffer must not be called");
    },
    slice(begin, end) {
      slices.push([begin, end]);
      return new Blob([bytes.slice(begin, end)]);
    },
  };
  const source = await createFilePdfSource(file, { rangeChunkSize: 64 });
  const loadingTask = pdfjsLib.getDocument(source);
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error("PDF.js file range load timed out")),
      2_000,
    );
  });
  const pdf = await Promise.race([loadingTask.promise, timeout]);
  clearTimeout(timeoutId);

  assert.equal(pdf.numPages, 1);
  assert.ok(slices.some(([begin, end]) => begin === 0 && end === 64));
  assert.equal(typeof file.arrayBuffer, "function");
  await loadingTask.destroy();
});
