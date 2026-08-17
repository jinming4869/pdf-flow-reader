// review-state.mjs — 单书回望输出的本地存储（与用户痕迹分列）
//
// AI 输出独立存储键，绝不写入 reading-trace；
// done 是终态，同书重复生成按新版本覆盖（保留生成时间与模型）。

export const REVIEW_STATE_KEY = "pdf-flow-reader:v1:review-state";
export const REVIEW_STATE_SCHEMA_VERSION = 1;

export function nowIso(now = new Date()) {
  return now instanceof Date ? now.toISOString() : new Date(now).toISOString();
}

function sanitizeRecord(record = null) {
  if (!record || typeof record !== "object") return null;
  const status = ["pending", "done", "partial", "failed", "cancelled"].includes(record.status)
    ? record.status
    : null;
  if (!status) return null;
  return {
    status,
    sections: Array.isArray(record.sections)
      ? record.sections
        .filter((section) => section && typeof section.text === "string" && section.text)
        .map((section) => ({
          index: Math.max(0, Math.round(Number(section.index) || 0)),
          pageStart: Math.max(0, Math.round(Number(section.pageStart) || 0)),
          pageEnd: Math.max(0, Math.round(Number(section.pageEnd) || 0)),
          text: section.text,
        }))
      : [],
    errorCode: typeof record.errorCode === "string" ? record.errorCode : null,
    model: typeof record.model === "string" ? record.model : null,
    generatedAt: typeof record.generatedAt === "string" ? record.generatedAt : null,
  };
}

export function createEmptyReviewState(now = new Date()) {
  return {
    schemaVersion: REVIEW_STATE_SCHEMA_VERSION,
    updatedAt: nowIso(now),
    records: {},
  };
}

function sanitizeState(value, now = new Date()) {
  const fallback = createEmptyReviewState(now);
  if (!value || typeof value !== "object") return fallback;
  const records = {};
  if (value.records && typeof value.records === "object") {
    for (const [documentId, record] of Object.entries(value.records)) {
      const cleaned = sanitizeRecord(record);
      if (cleaned) records[documentId] = cleaned;
    }
  }
  return {
    schemaVersion: REVIEW_STATE_SCHEMA_VERSION,
    updatedAt: nowIso(now),
    records,
  };
}

export function readReviewState(storage = globalThis.localStorage, now = new Date()) {
  if (!storage) return createEmptyReviewState(now);
  try {
    const raw = storage.getItem(REVIEW_STATE_KEY);
    if (!raw) return createEmptyReviewState(now);
    return sanitizeState(JSON.parse(raw), now);
  } catch {
    return createEmptyReviewState(now);
  }
}

export function writeReviewState(state, storage = globalThis.localStorage, now = new Date()) {
  const next = sanitizeState({ ...state, updatedAt: nowIso(now) }, now);
  storage?.setItem?.(REVIEW_STATE_KEY, JSON.stringify(next));
  return next;
}

export function recordReviewPending(state, documentId, now = new Date()) {
  if (typeof documentId !== "string" || !documentId) return state;
  const record = {
    status: "pending",
    sections: [],
    errorCode: null,
    model: null,
    generatedAt: nowIso(now),
  };
  return {
    ...state,
    records: { ...(state.records ?? {}), [documentId]: record },
    updatedAt: record.generatedAt,
  };
}

export function recordReviewResult(state, documentId, {
  status = "done",
  sections = [],
  errorCode = null,
  model = null,
}, now = new Date()) {
  if (typeof documentId !== "string" || !documentId) return state;
  const record = {
    status: ["done", "partial", "failed", "cancelled"].includes(status) ? status : "failed",
    sections: Array.isArray(sections) ? sections : [],
    errorCode: typeof errorCode === "string" ? errorCode : null,
    model: typeof model === "string" ? model : null,
    generatedAt: nowIso(now),
  };
  return {
    ...state,
    records: { ...(state.records ?? {}), [documentId]: record },
    updatedAt: record.generatedAt,
  };
}
