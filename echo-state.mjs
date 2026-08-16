// echo-state.mjs — 一句复述的待生成状态持久化（renderer localStorage）
//
// 本地记录是唯一事实源：done 状态不会被新的 pending 覆盖；
// 失败记录保留原因与有界尝试计数，重试由书架手动触发（S4）。

export const ECHO_STATE_KEY = "pdf-flow-reader:v1:echo-state";
export const ECHO_STATE_SCHEMA_VERSION = 1;
export const ECHO_MAX_ATTEMPTS = 3;

export function nowIso(now = new Date()) {
  return now instanceof Date ? now.toISOString() : new Date(now).toISOString();
}

export function createEmptyEchoState(now = new Date()) {
  return {
    schemaVersion: ECHO_STATE_SCHEMA_VERSION,
    updatedAt: nowIso(now),
    records: {},
  };
}

function sanitizeRecord(record = null) {
  if (!record || typeof record !== "object") return null;
  const status = ["pending", "done", "failed"].includes(record.status)
    ? record.status
    : null;
  if (!status) return null;
  return {
    traceId: typeof record.traceId === "string" ? record.traceId : "",
    status,
    text: status === "done" && typeof record.text === "string" ? record.text : null,
    mode: status === "done" && typeof record.mode === "string" ? record.mode : null,
    model: status === "done" && typeof record.model === "string" ? record.model : null,
    latencyMs: status === "done" && Number.isFinite(Number(record.latencyMs))
      ? Math.max(0, Math.round(Number(record.latencyMs)))
      : null,
    reason: status === "failed" && typeof record.reason === "string" ? record.reason : null,
    attempts: Number.isFinite(Number(record.attempts))
      ? Math.max(0, Math.min(ECHO_MAX_ATTEMPTS, Math.round(Number(record.attempts))))
      : 0,
    requestedAt: typeof record.requestedAt === "string" ? record.requestedAt : null,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null,
  };
}

function sanitizeState(value, now = new Date()) {
  const fallback = createEmptyEchoState(now);
  if (!value || typeof value !== "object") return fallback;
  const records = {};
  if (value.records && typeof value.records === "object") {
    for (const [traceId, record] of Object.entries(value.records)) {
      const cleaned = sanitizeRecord(record);
      if (cleaned && cleaned.traceId === traceId) records[traceId] = cleaned;
    }
  }
  return {
    schemaVersion: ECHO_STATE_SCHEMA_VERSION,
    updatedAt: nowIso(now),
    records,
  };
}

export function readEchoState(storage = globalThis.localStorage, now = new Date()) {
  if (!storage) return createEmptyEchoState(now);
  try {
    const raw = storage.getItem(ECHO_STATE_KEY);
    if (!raw) return createEmptyEchoState(now);
    return sanitizeState(JSON.parse(raw), now);
  } catch {
    return createEmptyEchoState(now);
  }
}

export function writeEchoState(state, storage = globalThis.localStorage, now = new Date()) {
  const next = sanitizeState({ ...state, updatedAt: nowIso(now) }, now);
  storage?.setItem?.(ECHO_STATE_KEY, JSON.stringify(next));
  return next;
}

export function recordEchoPending(state, traceId, now = new Date()) {
  const previous = sanitizeRecord(state.records?.[traceId]);
  // done 是终态，不会被新的 pending 覆盖。
  if (previous?.status === "done") return state;
  const record = {
    traceId,
    status: "pending",
    text: null,
    mode: null,
    model: null,
    latencyMs: null,
    reason: null,
    attempts: Math.min(ECHO_MAX_ATTEMPTS, (previous?.attempts ?? 0) + 1),
    requestedAt: nowIso(now),
    updatedAt: nowIso(now),
  };
  return {
    ...state,
    records: { ...(state.records ?? {}), [traceId]: record },
    updatedAt: record.updatedAt,
  };
}

export function recordEchoSuccess(state, traceId, {
  text,
  mode = "text-only",
  model = null,
  latencyMs = null,
}, now = new Date()) {
  const previous = sanitizeRecord(state.records?.[traceId]);
  if (previous?.status === "done") return state;
  const record = {
    traceId,
    status: "done",
    text: typeof text === "string" ? text : null,
    mode: typeof mode === "string" ? mode : "text-only",
    model: typeof model === "string" ? model : null,
    latencyMs: Number.isFinite(Number(latencyMs)) ? Math.max(0, Math.round(Number(latencyMs))) : null,
    reason: null,
    attempts: previous?.attempts ?? 0,
    requestedAt: previous?.requestedAt ?? nowIso(now),
    updatedAt: nowIso(now),
  };
  if (!record.text) return state;
  return {
    ...state,
    records: { ...(state.records ?? {}), [traceId]: record },
    updatedAt: record.updatedAt,
  };
}

export function recordEchoFailure(state, traceId, reason = "unknown", now = new Date()) {
  const previous = sanitizeRecord(state.records?.[traceId]);
  if (previous?.status === "done") return state;
  const record = {
    traceId,
    status: "failed",
    text: null,
    mode: null,
    model: null,
    latencyMs: null,
    reason: typeof reason === "string" ? reason : "unknown",
    attempts: Math.min(ECHO_MAX_ATTEMPTS, (previous?.attempts ?? 0) + 1),
    requestedAt: previous?.requestedAt ?? nowIso(now),
    updatedAt: nowIso(now),
  };
  return {
    ...state,
    records: { ...(state.records ?? {}), [traceId]: record },
    updatedAt: record.updatedAt,
  };
}

export function retryableEchoRecords(state) {
  return Object.values(state?.records ?? {})
    .filter((record) => (
      record?.status === "failed" &&
      record.attempts < ECHO_MAX_ATTEMPTS
    ))
    .sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)));
}
