import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, join, relative, resolve } from "node:path";

import {
  createReadingTraceDraft,
  fromReadingTraceRecord,
  toReadingTraceRecord,
  transitionReadingTrace,
} from "./reading-trace.mjs";

const DOCUMENT_SCHEMA_VERSION = 1;
const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

function repositoryError(code, message, ErrorType = Error) {
  const error = new ErrorType(message);
  error.code = code;
  return error;
}

function safeId(value, name) {
  const id = typeof value === "string" ? value.trim() : "";
  if (!SAFE_ID.test(id)) {
    throw repositoryError("TRACE_UNSAFE_ID", `${name} 只能包含 1–128 个字母、数字、点、下划线或连字符。`, TypeError);
  }
  return id;
}

function nonEmptyString(value, name) {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result) throw repositoryError("TRACE_REPOSITORY_INVALID", `${name} 必须是非空字符串。`, TypeError);
  return result;
}

function optionalPath(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    throw repositoryError("TRACE_REPOSITORY_INVALID", "lastKnownPath 必须是字符串或 null。", TypeError);
  }
  return value;
}

function optionalSize(value) {
  if (value === null || value === undefined) return null;
  const size = Number(value);
  if (!Number.isFinite(size) || size < 0) {
    throw repositoryError("TRACE_REPOSITORY_INVALID", "fileSize 必须是非负数或 null。", TypeError);
  }
  return size;
}

function timestamp(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw repositoryError("TRACE_REPOSITORY_INVALID", "时间无效。", TypeError);
  }
  return date.toISOString();
}

function clone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

async function exists(path) {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function atomicWrite(path, content, encoding = undefined) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let handle = null;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(content, encoding);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, path);
  } catch (error) {
    await handle?.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function atomicWriteJson(path, value) {
  return atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function pngBytes(value) {
  let bytes = null;
  if (value instanceof Uint8Array) {
    bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  } else if (value instanceof ArrayBuffer) {
    bytes = new Uint8Array(value);
  }
  if (!bytes || bytes.byteLength < 8 || bytes.byteLength > 64 * 1024 * 1024) {
    throw repositoryError("TRACE_CROP_BYTES_INVALID", "crop PNG 必须是 8 字节到 64MB 的二进制。", TypeError);
  }
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((byte, index) => bytes[index] === byte)) {
    throw repositoryError("TRACE_CROP_BYTES_INVALID", "crop 数据缺少 PNG 签名。", TypeError);
  }
  return bytes;
}

function cropDimension(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw repositoryError("TRACE_CROP_METADATA_INVALID", `${name} 必须是正整数。`, TypeError);
  }
  return number;
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function directoryEntries(path) {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function walkFiles(root) {
  const files = [];
  for (const entry of await directoryEntries(root)) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function validateDocumentRecord(record) {
  if (!record || typeof record !== "object") {
    throw repositoryError("TRACE_DOCUMENT_INVALID", "document.json 不是对象。", TypeError);
  }
  if (record.schemaVersion !== DOCUMENT_SCHEMA_VERSION) {
    throw repositoryError("TRACE_DOCUMENT_INVALID", "document schemaVersion 不受支持。", TypeError);
  }
  safeId(record.id, "document id");
  nonEmptyString(record.fingerprint, "document fingerprint");
  nonEmptyString(record.displayName, "document displayName");
  optionalPath(record.lastKnownPath);
  optionalSize(record.fileSize);
  timestamp(record.createdAt);
  timestamp(record.updatedAt);
  if (!Number.isInteger(record.nextReadingOrder) || record.nextReadingOrder < 1) {
    throw repositoryError("TRACE_DOCUMENT_INVALID", "nextReadingOrder 必须是正整数。", TypeError);
  }
  return record;
}

export function createTraceRepository({ rootPath } = {}) {
  const root = resolve(nonEmptyString(rootPath, "rootPath"));
  const documentsRoot = join(root, "documents");
  const recoveryRoot = join(root, "recovery");
  const locks = new Map();

  const documentDirectory = (documentId) => join(documentsRoot, safeId(documentId, "documentId"));
  const documentPath = (documentId) => join(documentDirectory(documentId), "document.json");
  const tracesDirectory = (documentId) => join(documentDirectory(documentId), "traces");
  const traceDirectory = (documentId, traceId) => join(
    tracesDirectory(documentId),
    safeId(traceId, "traceId"),
  );
  const tracePath = (documentId, traceId) => join(traceDirectory(documentId, traceId), "trace.json");

  function withDocumentLock(documentId, task) {
    const key = safeId(documentId, "documentId");
    const previous = locks.get(key) ?? Promise.resolve();
    const current = previous.then(task, task);
    const settled = current.then(
      () => undefined,
      () => undefined,
    );
    let tracked = null;
    tracked = settled.finally(() => {
      if (locks.get(key) === tracked) locks.delete(key);
    });
    locks.set(key, tracked);
    return current;
  }

  async function initialize() {
    await Promise.all([
      mkdir(documentsRoot, { recursive: true }),
      mkdir(recoveryRoot, { recursive: true }),
    ]);
    return { rootPath: root };
  }

  async function readDocument(documentId) {
    const record = await readJson(documentPath(documentId));
    if (!record) return null;
    validateDocumentRecord(record);
    return clone(record);
  }

  async function registerDocument(input = {}, options = {}) {
    const id = safeId(input.id, "document id");
    const fingerprint = nonEmptyString(input.fingerprint, "document fingerprint");
    const displayName = nonEmptyString(input.displayName, "document displayName");
    const lastKnownPath = optionalPath(input.lastKnownPath);
    const fileSize = optionalSize(input.fileSize);
    const now = timestamp(options.now);

    return withDocumentLock(id, async () => {
      const previous = await readDocument(id);
      if (previous && previous.fingerprint !== fingerprint) {
        throw repositoryError(
          "TRACE_DOCUMENT_IDENTITY_MISMATCH",
          `documentId ${id} 已绑定到另一份内容。`,
          RangeError,
        );
      }
      const record = {
        schemaVersion: DOCUMENT_SCHEMA_VERSION,
        id,
        fingerprint,
        displayName,
        lastKnownPath,
        fileSize,
        nextReadingOrder: previous?.nextReadingOrder ?? 1,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      };
      validateDocumentRecord(record);
      await atomicWriteJson(documentPath(id), record);
      await mkdir(tracesDirectory(id), { recursive: true });
      return clone(record);
    });
  }

  async function readTrace(documentId, traceId) {
    const id = safeId(documentId, "documentId");
    const trace = safeId(traceId, "traceId");
    const record = await readJson(tracePath(id, trace));
    return record ? fromReadingTraceRecord(record) : null;
  }

  async function listTraces(documentId, { includeTrashed = false } = {}) {
    const id = safeId(documentId, "documentId");
    const traces = [];
    for (const entry of await directoryEntries(tracesDirectory(id))) {
      if (!entry.isDirectory() || !SAFE_ID.test(entry.name)) continue;
      const trace = await readTrace(id, entry.name);
      if (!trace || trace.lifecycle === "purged") continue;
      if (!includeTrashed && trace.lifecycle === "trashed") continue;
      traces.push(trace);
    }
    return traces.sort((left, right) => (
      left.readingContext.readingOrder - right.readingContext.readingOrder ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id)
    ));
  }

  async function createDraft(input = {}, options = {}) {
    const documentId = safeId(input.documentId, "documentId");
    const traceId = safeId(input.id, "traceId");
    return withDocumentLock(documentId, async () => {
      const document = await readDocument(documentId);
      if (!document) {
        throw repositoryError("TRACE_DOCUMENT_NOT_FOUND", `找不到 documentId ${documentId}。`, RangeError);
      }
      if (document.fingerprint !== input.documentFingerprint) {
        throw repositoryError(
          "TRACE_DOCUMENT_IDENTITY_MISMATCH",
          `trace ${traceId} 的内容指纹与 document.json 不一致。`,
          RangeError,
        );
      }
      if (await exists(tracePath(documentId, traceId))) {
        throw repositoryError("TRACE_ALREADY_EXISTS", `traceId ${traceId} 已存在。`, RangeError);
      }

      const existingTraces = await listTraces(documentId, { includeTrashed: true });
      const highestExistingOrder = existingTraces.reduce(
        (maximum, trace) => Math.max(maximum, trace.readingContext.readingOrder),
        0,
      );
      const readingOrder = Math.max(document.nextReadingOrder, highestExistingOrder + 1);
      const trace = createReadingTraceDraft({
        ...input,
        id: traceId,
        documentId,
        readingOrder,
      }, options);
      const nextDocument = {
        ...document,
        nextReadingOrder: readingOrder + 1,
        updatedAt: timestamp(options.now),
      };
      // Advance the insertion counter first. A failed trace write may leave an
      // intentional order gap, but a crash can never create duplicate order.
      await atomicWriteJson(documentPath(documentId), nextDocument);
      await mkdir(traceDirectory(documentId, traceId), { recursive: true });
      await atomicWriteJson(tracePath(documentId, traceId), toReadingTraceRecord(trace));
      return trace;
    });
  }

  async function saveCrop(documentId, traceId, value, metadata = {}, options = {}) {
    const id = safeId(documentId, "documentId");
    const trace = safeId(traceId, "traceId");
    const bytes = pngBytes(value);
    if (metadata.mimeType !== "image/png") {
      throw repositoryError("TRACE_CROP_METADATA_INVALID", "v5.0 crop 只接受 image/png。", TypeError);
    }
    const width = cropDimension(metadata.width, "crop width");
    const height = cropDimension(metadata.height, "crop height");

    return withDocumentLock(id, async () => {
      const current = await readTrace(id, trace);
      if (!current) {
        throw repositoryError("TRACE_NOT_FOUND", `找不到 traceId ${trace}。`, RangeError);
      }
      if (
        Number.isInteger(options.expectedRevision) &&
        options.expectedRevision !== current.revision
      ) {
        throw repositoryError(
          "TRACE_REVISION_CONFLICT",
          `trace ${trace} revision 已从 ${options.expectedRevision} 变为 ${current.revision}。`,
          RangeError,
        );
      }
      const reference = `traces/${trace}/crop.png`;
      const next = transitionReadingTrace(current, {
        type: "CROP_READY",
        reference,
        mimeType: "image/png",
        width,
        height,
      }, options);
      await atomicWrite(join(traceDirectory(id, trace), "crop.png"), bytes);
      await atomicWriteJson(tracePath(id, trace), toReadingTraceRecord(next));
      return next;
    });
  }

  async function transitionTrace(documentId, traceId, event, options = {}) {
    const id = safeId(documentId, "documentId");
    const trace = safeId(traceId, "traceId");
    return withDocumentLock(id, async () => {
      const current = await readTrace(id, trace);
      if (!current) {
        throw repositoryError("TRACE_NOT_FOUND", `找不到 traceId ${trace}。`, RangeError);
      }
      if (
        Number.isInteger(options.expectedRevision) &&
        options.expectedRevision !== current.revision
      ) {
        throw repositoryError(
          "TRACE_REVISION_CONFLICT",
          `trace ${trace} revision 已从 ${options.expectedRevision} 变为 ${current.revision}。`,
          RangeError,
        );
      }
      const next = transitionReadingTrace(current, event, options);
      if (next.lifecycle === "purged") {
        await rm(traceDirectory(id, trace), { recursive: true, force: true });
      } else {
        await atomicWriteJson(tracePath(id, trace), toReadingTraceRecord(next));
      }
      return next;
    });
  }

  async function purgeExpired(options = {}) {
    const now = new Date(options.now ?? new Date());
    if (!Number.isFinite(now.getTime())) {
      throw repositoryError("TRACE_REPOSITORY_INVALID", "purge now 无效。", TypeError);
    }
    const purged = [];
    for (const documentEntry of await directoryEntries(documentsRoot)) {
      if (!documentEntry.isDirectory() || !SAFE_ID.test(documentEntry.name)) continue;
      const documentId = documentEntry.name;
      const traces = await listTraces(documentId, { includeTrashed: true });
      for (const trace of traces) {
        if (
          trace.lifecycle !== "trashed" ||
          !trace.purgeAfter ||
          new Date(trace.purgeAfter).getTime() > now.getTime()
        ) {
          continue;
        }
        await transitionTrace(documentId, trace.id, {
          type: "PURGE",
          confirmed: true,
        }, {
          expectedRevision: trace.revision,
          now,
        });
        purged.push({ documentId, traceId: trace.id });
      }
    }
    return purged;
  }

  async function recover() {
    await initialize();
    let removedTemps = 0;
    const quarantined = [];
    const files = await walkFiles(documentsRoot);

    for (const file of files) {
      if (!basename(file).includes(".tmp-")) continue;
      await rm(file, { force: true });
      removedTemps += 1;
    }

    for (const file of files) {
      const name = basename(file);
      if (!["trace.json", "document.json"].includes(name)) continue;
      try {
        const record = JSON.parse(await readFile(file, "utf8"));
        if (name === "trace.json") fromReadingTraceRecord(record);
        else validateDocumentRecord(record);
      } catch (error) {
        if (error?.code === "ENOENT") continue;
        const relativeName = relative(documentsRoot, file)
          .split(/[\\/]+/)
          .filter(Boolean)
          .join("__");
        const target = join(recoveryRoot, `${Date.now()}-${randomUUID()}-${relativeName}`);
        await mkdir(recoveryRoot, { recursive: true });
        await rename(file, target);
        quarantined.push({ source: relativeName, recoveredAs: basename(target) });
      }
    }
    return { removedTemps, quarantined };
  }

  return Object.freeze({
    initialize,
    recover,
    registerDocument,
    readDocument,
    createDraft,
    readTrace,
    listTraces,
    saveCrop,
    transitionTrace,
    purgeExpired,
  });
}
