const STORAGE_KEY = "pdf-flow-reader:v3:local-state";
const SCHEMA_VERSION = 1;
const DEFAULT_RECENT_LIMIT = 6;

export function nowIso(now = new Date()) {
  return now instanceof Date ? now.toISOString() : new Date(now).toISOString();
}

export function createEmptyState(now = new Date()) {
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt: nowIso(now),
    updatedAt: nowIso(now),
    documents: {},
    rhythmRecords: {},
    preferences: {
      defaultSpeedPxPerSecond: 16,
      soundCueEnabled: true,
      soundCueVolume: 0.28,
      showDetailedRhythmStats: false,
      recentDocumentLimit: DEFAULT_RECENT_LIMIT,
      restoreLastPositionEnabled: true,
      rhythmPatternMode: "soft",
      ttsPreferredMode: "off",
      ttsConsentGiven: false,
    },
  };
}

function clampRecentLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_RECENT_LIMIT;
  return Math.max(1, Math.min(18, Math.round(parsed)));
}

function sanitizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sanitizeState(value, now = new Date()) {
  const fallback = createEmptyState(now);
  if (!value || typeof value !== "object") return fallback;

  const preferences = {
    ...fallback.preferences,
    ...(value.preferences && typeof value.preferences === "object"
      ? value.preferences
      : {}),
  };
  preferences.defaultSpeedPxPerSecond = Math.max(
    4,
    Math.min(64, Math.round(sanitizeNumber(preferences.defaultSpeedPxPerSecond, 16))),
  );
  preferences.soundCueVolume = Math.max(
    0,
    Math.min(1, sanitizeNumber(preferences.soundCueVolume, 0.28)),
  );
  preferences.recentDocumentLimit = clampRecentLimit(preferences.recentDocumentLimit);
  preferences.soundCueEnabled = true;
  preferences.showDetailedRhythmStats = Boolean(preferences.showDetailedRhythmStats);
  preferences.restoreLastPositionEnabled = preferences.restoreLastPositionEnabled !== false;
  preferences.rhythmPatternMode = ["soft", "clear"].includes(preferences.rhythmPatternMode)
    ? preferences.rhythmPatternMode
    : "soft";
  preferences.ttsPreferredMode = ["off", "local-only", "api"].includes(
    preferences.ttsPreferredMode,
  )
    ? preferences.ttsPreferredMode
    : "off";
  preferences.ttsConsentGiven = Boolean(preferences.ttsConsentGiven);

  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : fallback.createdAt,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : fallback.updatedAt,
    documents: value.documents && typeof value.documents === "object"
      ? { ...value.documents }
      : {},
    rhythmRecords: value.rhythmRecords && typeof value.rhythmRecords === "object"
      ? { ...value.rhythmRecords }
      : {},
    preferences,
  };
}

export function createDocumentFingerprint({ fileName, fileSize, lastModified } = {}) {
  const normalizedName = String(fileName || "未命名 PDF").trim().toLowerCase();
  const normalizedSize = Number.isFinite(Number(fileSize)) ? Math.max(0, Number(fileSize)) : 0;
  const normalizedModified = Number.isFinite(Number(lastModified))
    ? Math.max(0, Math.round(Number(lastModified)))
    : 0;
  return `v1:${encodeURIComponent(normalizedName)}:${normalizedSize}:${normalizedModified}`;
}

export function createDocumentId(fingerprint) {
  let hash = 2166136261;
  const input = String(fingerprint || "");
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `doc_${(hash >>> 0).toString(36)}`;
}

export function readLocalState(storage = globalThis.localStorage, now = new Date()) {
  if (!storage) return createEmptyState(now);
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return createEmptyState(now);
    return sanitizeState(JSON.parse(raw), now);
  } catch {
    return createEmptyState(now);
  }
}

export function writeLocalState(state, storage = globalThis.localStorage, now = new Date()) {
  const nextState = sanitizeState(
    {
      ...state,
      updatedAt: nowIso(now),
    },
    now,
  );
  storage?.setItem?.(STORAGE_KEY, JSON.stringify(nextState));
  return nextState;
}

export function upsertDocumentRecord(state, fileMeta, updates = {}, now = new Date()) {
  const fingerprint = fileMeta?.fingerprint ?? createDocumentFingerprint(fileMeta);
  const id = fileMeta?.id ?? createDocumentId(fingerprint);
  const previous = state.documents?.[id] ?? {};
  const timestamp = nowIso(now);
  const fileName = String(fileMeta?.fileName || previous.fileName || "未命名 PDF");
  const fileSize = sanitizeNumber(fileMeta?.fileSize ?? previous.fileSize, 0);
  const lastModified = sanitizeNumber(fileMeta?.lastModified ?? previous.lastModified, 0);

  const record = {
    id,
    fileName,
    fileSize,
    lastModified,
    fingerprint,
    lastPageIndex: Math.max(0, Math.round(sanitizeNumber(previous.lastPageIndex, 0))),
    lastScrollTop: Math.max(0, sanitizeNumber(previous.lastScrollTop, 0)),
    progressRatio: Math.max(0, Math.min(1, sanitizeNumber(previous.progressRatio, 0))),
    lastSpeedPxPerSecond: Math.max(
      4,
      Math.min(64, Math.round(sanitizeNumber(previous.lastSpeedPxPerSecond, 16))),
    ),
    lastBandKey: typeof previous.lastBandKey === "string" ? previous.lastBandKey : "long-day",
    openedAt: typeof previous.openedAt === "string" ? previous.openedAt : timestamp,
    updatedAt: timestamp,
    ...updates,
  };

  record.lastPageIndex = Math.max(0, Math.round(sanitizeNumber(record.lastPageIndex, 0)));
  record.lastScrollTop = Math.max(0, sanitizeNumber(record.lastScrollTop, 0));
  record.progressRatio = Math.max(0, Math.min(1, sanitizeNumber(record.progressRatio, 0)));
  record.lastSpeedPxPerSecond = Math.max(
    4,
    Math.min(64, Math.round(sanitizeNumber(record.lastSpeedPxPerSecond, 16))),
  );
  record.lastBandKey = typeof record.lastBandKey === "string" ? record.lastBandKey : "long-day";
  record.updatedAt = timestamp;

  return {
    ...state,
    documents: {
      ...(state.documents ?? {}),
      [id]: record,
    },
    updatedAt: timestamp,
  };
}

export function upsertRhythmRecord(state, documentRecord, rhythm, now = new Date()) {
  if (!documentRecord?.id || !rhythm) return state;
  const previous = state.rhythmRecords?.[documentRecord.id];
  const speed = Math.max(0, Math.round(sanitizeNumber(rhythm.speedPxPerSecond, 0)));
  if (previous && sanitizeNumber(previous.maxSpeedPxPerSecond, 0) > speed) return state;

  const timestamp = nowIso(now);
  const record = {
    id: `rhythm_${documentRecord.id}`,
    documentId: documentRecord.id,
    fileName: documentRecord.fileName,
    maxSpeedPxPerSecond: speed,
    maxBandKey: rhythm.bandKey ?? documentRecord.lastBandKey ?? "long-day",
    maxBandName: rhythm.bandName ?? "长日留痕",
    estimatedCharsPerMinuteMin: Math.max(0, Math.round(sanitizeNumber(rhythm.cjkRateMin, 0))),
    estimatedCharsPerMinuteMax: Math.max(0, Math.round(sanitizeNumber(rhythm.cjkRateMax, 0))),
    estimatedWordsPerMinuteMin: Math.max(0, Math.round(sanitizeNumber(rhythm.englishRateMin, 0))),
    estimatedWordsPerMinuteMax: Math.max(0, Math.round(sanitizeNumber(rhythm.englishRateMax, 0))),
    pageIndex: Math.max(0, Math.round(sanitizeNumber(rhythm.pageIndex, 0))),
    recordedAt: timestamp,
  };

  return {
    ...state,
    rhythmRecords: {
      ...(state.rhythmRecords ?? {}),
      [documentRecord.id]: record,
    },
    updatedAt: timestamp,
  };
}

export function recentDocumentRecords(state, limit = state.preferences?.recentDocumentLimit) {
  const safeLimit = clampRecentLimit(limit);
  return Object.values(state.documents ?? {})
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
    .slice(0, safeLimit);
}

export function latestRhythmEcho(state) {
  return Object.values(state.rhythmRecords ?? {})
    .sort((left, right) => String(right.recordedAt).localeCompare(String(left.recordedAt)))
    .at(0) ?? null;
}

export function removeDocumentRecord(state, documentId, now = new Date()) {
  const documents = { ...(state.documents ?? {}) };
  const rhythmRecords = { ...(state.rhythmRecords ?? {}) };
  delete documents[documentId];
  delete rhythmRecords[documentId];
  return {
    ...state,
    documents,
    rhythmRecords,
    updatedAt: nowIso(now),
  };
}

export function clearLocalState(storage = globalThis.localStorage, now = new Date()) {
  const nextState = createEmptyState(now);
  storage?.setItem?.(STORAGE_KEY, JSON.stringify(nextState));
  return nextState;
}

export const storageKey = STORAGE_KEY;
