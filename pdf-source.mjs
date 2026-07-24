import { PDFDataRangeTransport } from "./vendor/pdf.mjs";

export const DEFAULT_RANGE_CHUNK_SIZE = 256 * 1024;

class FilePdfRangeTransport extends PDFDataRangeTransport {
  #aborted = false;
  #generation = 0;
  #nextRequestId = 0;
  #pending = new Set();
  #signal = null;
  #signalHandler = null;
  #stats = {
    requests: 0,
    completed: 0,
    failed: 0,
    aborted: 0,
    bytesRead: 0,
  };

  constructor(file, { signal, initialData } = {}) {
    // This transport serves ranges only; there is no progressive full-reader
    // stream. Marking that stream complete makes PDF.js request byte ranges
    // immediately instead of waiting forever for a progressive chunk.
    super(file.size, initialData, true);
    this.file = file;
    this.kind = "file-range";
    if (initialData?.byteLength) {
      this.#stats.requests = 1;
      this.#stats.completed = 1;
      this.#stats.bytesRead = initialData.byteLength;
    }

    if (signal) {
      this.#signal = signal;
      this.#signalHandler = () => this.abort();
      if (signal.aborted) this.abort();
      else signal.addEventListener("abort", this.#signalHandler, { once: true });
    }
  }

  get diagnostics() {
    return Object.freeze({
      ...this.#stats,
      inFlight: this.#pending.size,
      isAborted: this.#aborted,
    });
  }

  requestDataRange(begin, end) {
    this.#stats.requests += 1;
    if (this.#aborted) {
      this.#stats.aborted += 1;
      return;
    }

    const boundedEnd = Math.min(end, this.length);
    if (
      !Number.isSafeInteger(begin) ||
      !Number.isSafeInteger(end) ||
      begin < 0 ||
      boundedEnd <= begin ||
      begin >= this.length
    ) {
      this.#stats.failed += 1;
      return;
    }

    const requestId = ++this.#nextRequestId;
    const generation = this.#generation;
    this.#pending.add(requestId);

    Promise.resolve()
      .then(() => this.file.slice(begin, boundedEnd).arrayBuffer())
      .then((buffer) => {
        if (this.#aborted || generation !== this.#generation) return;
        const chunk = new Uint8Array(buffer);
        this.#stats.completed += 1;
        this.#stats.bytesRead += chunk.byteLength;
        this.onDataRange(begin, chunk);
      })
      .catch(() => {
        if (!this.#aborted && generation === this.#generation) {
          this.#stats.failed += 1;
        }
      })
      .finally(() => {
        this.#pending.delete(requestId);
      });
  }

  abort() {
    if (this.#aborted) return;
    this.#aborted = true;
    this.#generation += 1;
    this.#stats.aborted += this.#pending.size;
    if (this.#signal && this.#signalHandler) {
      this.#signal.removeEventListener("abort", this.#signalHandler);
    }
    this.#signal = null;
    this.#signalHandler = null;
  }
}

/**
 * Build a PDF.js source descriptor without copying the whole File into memory.
 * Pass the result directly to pdfjsLib.getDocument().
 */
export async function createFilePdfSource(file, options = {}) {
  if (
    !file ||
    !Number.isSafeInteger(file.size) ||
    file.size <= 0 ||
    typeof file.slice !== "function"
  ) {
    throw new TypeError("createFilePdfSource needs a non-empty File or Blob.");
  }

  const rangeChunkSize = options.rangeChunkSize ?? DEFAULT_RANGE_CHUNK_SIZE;
  if (!Number.isSafeInteger(rangeChunkSize) || rangeChunkSize <= 0) {
    throw new RangeError("rangeChunkSize must be a positive safe integer.");
  }

  if (options.signal?.aborted) throw options.signal.reason ?? new DOMException(
    "PDF 读取已取消",
    "AbortError",
  );
  const initialEnd = Math.min(file.size, rangeChunkSize);
  const initialData = new Uint8Array(
    await file.slice(0, initialEnd).arrayBuffer(),
  );
  if (options.signal?.aborted) throw options.signal.reason ?? new DOMException(
    "PDF 读取已取消",
    "AbortError",
  );
  const transport = new FilePdfRangeTransport(file, { ...options, initialData });
  return {
    length: file.size,
    range: transport,
    disableStream: true,
    disableAutoFetch: true,
    rangeChunkSize,
  };
}
