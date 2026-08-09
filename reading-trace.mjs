export const READING_TRACE_SCHEMA_VERSION = 1;

const LIFECYCLES = new Set(["draft", "active", "trashed", "purged"]);
const CROP_STATES = new Set(["pending", "ready", "failed"]);
const EMOTION_STATES = new Set(["unplaced", "placed", "revised"]);
const SOURCE_PROVENANCE = new Set(["none", "native", "ocr", "mixed"]);
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function failure(code, message, ErrorType = TypeError) {
  const error = new ErrorType(message);
  error.code = code;
  return error;
}

function invalid(message) {
  throw failure("TRACE_INVALID", message);
}

function invalidTransition(message) {
  throw failure("TRACE_INVALID_TRANSITION", message, RangeError);
}

function nonEmptyString(value, name) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) invalid(`${name} 必须是非空字符串。`);
  return normalized;
}

function isoTimestamp(value, name = "timestamp") {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) invalid(`${name} 必须是有效时间。`);
  return date.toISOString();
}

function normalizedNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < -1 || number > 1) {
    invalid(`${name} 必须位于 [-1, 1]。`);
  }
  return number;
}

function normalizedPagePoint(point, index) {
  if (!point || typeof point !== "object") invalid(`lassoPath[${index}] 必须是坐标对象。`);
  const x = Number(point.x);
  const y = Number(point.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
    invalid(`lassoPath[${index}] 必须位于页面归一化坐标 [0, 1]。`);
  }
  const normalized = { x, y };
  if (point.pressure !== undefined) {
    const pressure = Number(point.pressure);
    if (!Number.isFinite(pressure) || pressure < 0 || pressure > 1) {
      invalid(`lassoPath[${index}].pressure 必须位于 [0, 1]。`);
    }
    normalized.pressure = pressure;
  }
  if (point.time !== undefined) {
    const time = Number(point.time);
    if (!Number.isFinite(time) || time < 0) invalid(`lassoPath[${index}].time 必须是非负数。`);
    normalized.time = time;
  }
  return normalized;
}

function normalizedPath(value) {
  if (!Array.isArray(value) || value.length < 3) invalid("lassoPath 至少需要三个点。");
  return value.map(normalizedPagePoint);
}

function emotionCoordinate(value, name) {
  if (!value || typeof value !== "object") invalid(`${name} 必须是情绪坐标。`);
  return {
    valence: normalizedNumber(value.valence, `${name}.valence`),
    arousal: normalizedNumber(value.arousal, `${name}.arousal`),
  };
}

function deepClone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function safeRelativeReference(value) {
  const reference = nonEmptyString(value, "crop.reference");
  if (
    reference.startsWith("/") ||
    reference.startsWith("\\") ||
    /^[a-zA-Z]:[\\/]/.test(reference) ||
    reference.split(/[\\/]+/).includes("..")
  ) {
    invalid("crop.reference 必须是文档目录内的相对路径。");
  }
  return reference;
}

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) invalid(`${name} 必须是正整数。`);
  return number;
}

function transitionTime(options = {}) {
  return isoTimestamp(options.now ?? new Date(), "now");
}

export function createReadingTraceDraft(input = {}, options = {}) {
  const timestamp = isoTimestamp(options.now ?? input.capturedAt ?? new Date(), "capturedAt");
  const pageIndex = Number(input.pageIndex);
  const readingOrder = Number(input.readingOrder);
  const speed = Number(input.speedPxPerSecond);
  if (!Number.isInteger(pageIndex) || pageIndex < 0) invalid("pageIndex 必须是非负整数。");
  if (!Number.isInteger(readingOrder) || readingOrder < 0) invalid("readingOrder 必须是非负整数。");
  if (!Number.isFinite(speed) || speed <= 0) invalid("speedPxPerSecond 必须是正数。");
  const provenance = typeof input.sourceProvenance === "string"
    ? input.sourceProvenance
    : "none";
  if (!SOURCE_PROVENANCE.has(provenance)) invalid("sourceProvenance 无效。");

  const trace = {
    schemaVersion: READING_TRACE_SCHEMA_VERSION,
    id: nonEmptyString(input.id, "id"),
    documentId: nonEmptyString(input.documentId, "documentId"),
    documentFingerprint: nonEmptyString(input.documentFingerprint, "documentFingerprint"),
    pageIndex,
    lassoPath: normalizedPath(input.lassoPath),
    source: {
      text: typeof input.sourceText === "string" ? input.sourceText : "",
      provenance,
    },
    readingContext: {
      speedTier: nonEmptyString(input.speedTier, "speedTier"),
      speedPxPerSecond: speed,
      readingOrder,
      capturedAt: timestamp,
    },
    crop: {
      state: "pending",
      reference: null,
      mimeType: null,
      width: null,
      height: null,
      errorCode: null,
      updatedAt: timestamp,
    },
    emotion: {
      state: "unplaced",
      original: null,
      current: null,
      updatedAt: null,
    },
    lifecycle: "draft",
    trashedAt: null,
    purgeAfter: null,
    purgedAt: null,
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  assertReadingTrace(trace);
  return deepFreeze(trace);
}

export function assertReadingTrace(trace) {
  if (!trace || typeof trace !== "object" || Array.isArray(trace)) invalid("trace 必须是对象。");
  if (trace.schemaVersion !== READING_TRACE_SCHEMA_VERSION) invalid("schemaVersion 不受支持。");
  nonEmptyString(trace.id, "id");
  nonEmptyString(trace.documentId, "documentId");
  nonEmptyString(trace.documentFingerprint, "documentFingerprint");
  if (!Number.isInteger(trace.pageIndex) || trace.pageIndex < 0) invalid("pageIndex 无效。");
  normalizedPath(trace.lassoPath);

  if (!trace.source || typeof trace.source !== "object") invalid("source 无效。");
  if (typeof trace.source.text !== "string") invalid("source.text 必须是字符串。");
  if (!SOURCE_PROVENANCE.has(trace.source.provenance)) invalid("source.provenance 无效。");

  if (!trace.readingContext || typeof trace.readingContext !== "object") invalid("readingContext 无效。");
  nonEmptyString(trace.readingContext.speedTier, "readingContext.speedTier");
  if (!Number.isFinite(trace.readingContext.speedPxPerSecond) || trace.readingContext.speedPxPerSecond <= 0) {
    invalid("readingContext.speedPxPerSecond 无效。");
  }
  if (!Number.isInteger(trace.readingContext.readingOrder) || trace.readingContext.readingOrder < 0) {
    invalid("readingContext.readingOrder 无效。");
  }
  isoTimestamp(trace.readingContext.capturedAt, "readingContext.capturedAt");

  if (!trace.crop || typeof trace.crop !== "object" || !CROP_STATES.has(trace.crop.state)) {
    invalid("crop.state 无效。");
  }
  isoTimestamp(trace.crop.updatedAt, "crop.updatedAt");
  if (trace.crop.state === "ready") {
    safeRelativeReference(trace.crop.reference);
    if (typeof trace.crop.mimeType !== "string" || !trace.crop.mimeType.startsWith("image/")) {
      invalid("ready crop 必须包含 image MIME type。");
    }
    positiveInteger(trace.crop.width, "crop.width");
    positiveInteger(trace.crop.height, "crop.height");
    if (trace.crop.errorCode !== null) invalid("ready crop 不能保留 errorCode。");
  } else if (trace.crop.state === "failed") {
    nonEmptyString(trace.crop.errorCode, "crop.errorCode");
    if (trace.crop.reference !== null) invalid("failed crop 不能包含 reference。");
  } else if (
    trace.crop.reference !== null ||
    trace.crop.mimeType !== null ||
    trace.crop.width !== null ||
    trace.crop.height !== null ||
    trace.crop.errorCode !== null
  ) {
    invalid("pending crop 不能预填结果字段。");
  }

  if (!trace.emotion || typeof trace.emotion !== "object" || !EMOTION_STATES.has(trace.emotion.state)) {
    invalid("emotion.state 无效。");
  }
  if (trace.emotion.state === "unplaced") {
    if (trace.emotion.original !== null || trace.emotion.current !== null || trace.emotion.updatedAt !== null) {
      invalid("unplaced emotion 不能包含坐标。");
    }
  } else {
    const original = emotionCoordinate(trace.emotion.original, "emotion.original");
    const current = emotionCoordinate(trace.emotion.current, "emotion.current");
    isoTimestamp(trace.emotion.updatedAt, "emotion.updatedAt");
    if (
      trace.emotion.state === "placed" &&
      (original.valence !== current.valence || original.arousal !== current.arousal)
    ) {
      invalid("placed emotion 的 original 与 current 必须一致。");
    }
  }

  if (!LIFECYCLES.has(trace.lifecycle)) invalid("lifecycle 无效。");
  if (trace.lifecycle === "draft" && trace.emotion.state !== "unplaced") {
    invalid("draft trace 必须处于 unplaced emotion。");
  }
  if (trace.lifecycle === "active" && trace.emotion.state === "unplaced") {
    invalid("active trace 必须已有情绪坐标。");
  }
  if (trace.lifecycle === "trashed") {
    isoTimestamp(trace.trashedAt, "trashedAt");
    isoTimestamp(trace.purgeAfter, "purgeAfter");
    if (trace.purgedAt !== null) invalid("trashed trace 不能已有 purgedAt。");
  } else if (trace.lifecycle === "purged") {
    isoTimestamp(trace.purgedAt, "purgedAt");
  } else if (trace.trashedAt !== null || trace.purgeAfter !== null || trace.purgedAt !== null) {
    invalid("活动 trace 不能包含删除时间。");
  }

  if (!Number.isInteger(trace.revision) || trace.revision < 1) invalid("revision 必须是正整数。");
  isoTimestamp(trace.createdAt, "createdAt");
  isoTimestamp(trace.updatedAt, "updatedAt");
  return trace;
}

export function transitionReadingTrace(trace, event = {}, options = {}) {
  assertReadingTrace(trace);
  const type = typeof event.type === "string" ? event.type : "";
  const timestamp = transitionTime(options);

  if (trace.lifecycle === "purged") invalidTransition("purged trace 不能再转移。");
  if (trace.lifecycle === "trashed" && !["RESTORE", "PURGE"].includes(type)) {
    invalidTransition("trashed trace 只允许恢复或彻底删除。");
  }

  const next = deepClone(trace);
  switch (type) {
    case "CROP_FAILED": {
      if (next.crop.state !== "pending") invalidTransition("只有 pending crop 可以失败。");
      next.crop = {
        state: "failed",
        reference: null,
        mimeType: null,
        width: null,
        height: null,
        errorCode: nonEmptyString(event.errorCode, "crop.errorCode"),
        updatedAt: timestamp,
      };
      break;
    }
    case "RETRY_CROP": {
      if (next.crop.state !== "failed") invalidTransition("只有 failed crop 可以重试。");
      next.crop = {
        state: "pending",
        reference: null,
        mimeType: null,
        width: null,
        height: null,
        errorCode: null,
        updatedAt: timestamp,
      };
      break;
    }
    case "CROP_READY": {
      if (next.crop.state !== "pending") invalidTransition("只有 pending crop 可以完成。");
      next.crop = {
        state: "ready",
        reference: safeRelativeReference(event.reference),
        mimeType: nonEmptyString(event.mimeType, "crop.mimeType"),
        width: positiveInteger(event.width, "crop.width"),
        height: positiveInteger(event.height, "crop.height"),
        errorCode: null,
        updatedAt: timestamp,
      };
      break;
    }
    case "PLACE_EMOTION": {
      if (next.lifecycle !== "draft" || next.emotion.state !== "unplaced") {
        invalidTransition("只有未落点草稿可以首次放置情绪。");
      }
      const coordinate = emotionCoordinate(event, "emotion");
      next.emotion = {
        state: "placed",
        original: coordinate,
        current: { ...coordinate },
        updatedAt: timestamp,
      };
      next.lifecycle = "active";
      break;
    }
    case "REVISE_EMOTION": {
      if (next.lifecycle !== "active" || next.emotion.state === "unplaced") {
        invalidTransition("只有 active trace 可以修正情绪。");
      }
      next.emotion = {
        ...next.emotion,
        state: "revised",
        current: emotionCoordinate(event, "emotion"),
        updatedAt: timestamp,
      };
      break;
    }
    case "TRASH": {
      if (!["draft", "active"].includes(next.lifecycle)) invalidTransition("当前 trace 不能进入回收站。");
      const trashedDate = new Date(timestamp);
      next.lifecycle = "trashed";
      next.trashedAt = timestamp;
      next.purgeAfter = new Date(trashedDate.getTime() + TRASH_RETENTION_MS).toISOString();
      next.purgedAt = null;
      break;
    }
    case "RESTORE": {
      if (next.lifecycle !== "trashed") invalidTransition("只有 trashed trace 可以恢复。");
      next.lifecycle = next.emotion.state === "unplaced" ? "draft" : "active";
      next.trashedAt = null;
      next.purgeAfter = null;
      next.purgedAt = null;
      break;
    }
    case "PURGE": {
      if (next.lifecycle !== "trashed") invalidTransition("只有 trashed trace 可以彻底删除。");
      if (event.confirmed !== true) {
        throw failure("TRACE_CONFIRMATION_REQUIRED", "彻底删除需要明确确认。", RangeError);
      }
      next.lifecycle = "purged";
      next.purgedAt = timestamp;
      break;
    }
    default:
      invalidTransition(`不支持的 trace 事件：${type || "<empty>"}`);
  }

  next.revision += 1;
  next.updatedAt = timestamp;
  assertReadingTrace(next);
  return deepFreeze(next);
}

export function fromReadingTraceRecord(record) {
  const trace = deepClone(record);
  assertReadingTrace(trace);
  return deepFreeze(trace);
}

export function isPersistableReadingTrace(trace) {
  assertReadingTrace(trace);
  return trace.lifecycle !== "purged";
}

export function toReadingTraceRecord(trace) {
  assertReadingTrace(trace);
  if (!isPersistableReadingTrace(trace)) {
    throw failure("TRACE_NOT_PERSISTABLE", "purged trace 不应继续持久化。", RangeError);
  }
  return deepClone(trace);
}
