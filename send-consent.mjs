// send-consent.mjs — AI 发送范围的逐项授权状态（v5.2）
//
// 三种发送范围（冻结需求 §2）：
// - echo：圈选文字 + 裁图（沿用 v5.1“配置即授权”，不按书保存）
// - review：整书航迹聚合 + 整书正文（必须按书明确授权）
// - lse：回望结果 + 整书正文（必须按书明确授权）
//
// 范围从小到大，升级范围必须明确确认，禁止静默扩大；
// 授权状态按书保存，拒绝发送不影响任何本地功能。

export const SEND_SCOPES = Object.freeze({
  echo: { label: "一句复述", needsBookConsent: false },
  review: { label: "单书回望", needsBookConsent: true },
  lse: { label: "LSE 工作纸", needsBookConsent: true },
});

export const CONSENT_STORE_KEY = "pdf-flow-reader:v1:send-consent";
export const CONSENT_SCHEMA_VERSION = 1;

export function validScope(scope) {
  return Object.prototype.hasOwnProperty.call(SEND_SCOPES, scope) ? scope : null;
}

export function createEmptyConsentState(now = new Date()) {
  return {
    schemaVersion: CONSENT_SCHEMA_VERSION,
    updatedAt: now instanceof Date ? now.toISOString() : new Date(now).toISOString(),
    grants: {},
  };
}

function sanitizeState(value, now = new Date()) {
  const fallback = createEmptyConsentState(now);
  if (!value || typeof value !== "object") return fallback;
  const grants = {};
  if (value.grants && typeof value.grants === "object") {
    for (const [scope, entries] of Object.entries(value.grants)) {
      if (!validScope(scope)) continue;
      if (!entries || typeof entries !== "object") continue;
      const cleaned = {};
      for (const [documentId, grantedAt] of Object.entries(entries)) {
        if (typeof documentId === "string" && documentId && typeof grantedAt === "string") {
          cleaned[documentId] = grantedAt;
        }
      }
      grants[scope] = cleaned;
    }
  }
  return {
    schemaVersion: CONSENT_SCHEMA_VERSION,
    updatedAt: fallback.updatedAt,
    grants,
  };
}

export function readSendConsent(storage = globalThis.localStorage, now = new Date()) {
  if (!storage) return createEmptyConsentState(now);
  try {
    const raw = storage.getItem(CONSENT_STORE_KEY);
    if (!raw) return createEmptyConsentState(now);
    return sanitizeState(JSON.parse(raw), now);
  } catch {
    return createEmptyConsentState(now);
  }
}

export function writeSendConsent(state, storage = globalThis.localStorage, now = new Date()) {
  const next = sanitizeState({
    ...state,
    updatedAt: now instanceof Date ? now.toISOString() : new Date(now).toISOString(),
  }, now);
  storage?.setItem?.(CONSENT_STORE_KEY, JSON.stringify(next));
  return next;
}

export function isScopeGranted(state, scope, documentId) {
  const normalizedScope = validScope(scope);
  if (!normalizedScope) return false;
  const definition = SEND_SCOPES[normalizedScope];
  if (!definition.needsBookConsent) return true;
  if (typeof documentId !== "string" || !documentId) return false;
  return Boolean(state?.grants?.[normalizedScope]?.[documentId]);
}

export function grantScope(state, scope, documentId, now = new Date()) {
  const normalizedScope = validScope(scope);
  if (!normalizedScope || !SEND_SCOPES[normalizedScope].needsBookConsent) return state;
  if (typeof documentId !== "string" || !documentId) return state;
  const timestamp = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  return {
    ...state,
    grants: {
      ...(state?.grants ?? {}),
      [normalizedScope]: {
        ...(state?.grants?.[normalizedScope] ?? {}),
        [documentId]: timestamp,
      },
    },
    updatedAt: timestamp,
  };
}

export function revokeScope(state, scope, documentId) {
  const normalizedScope = validScope(scope);
  if (!normalizedScope || typeof documentId !== "string" || !documentId) return state;
  const grants = { ...(state?.grants ?? {}) };
  if (grants[normalizedScope]) {
    grants[normalizedScope] = { ...grants[normalizedScope] };
    delete grants[normalizedScope][documentId];
  }
  return { ...state, grants };
}

/**
 * 发送内容清单：界面展示用，绝不包含正文内容本身。
 */
export function summarizeSendPayload(scope, payload = {}) {
  const normalizedScope = validScope(scope);
  if (!normalizedScope) return { scope: null, lines: [] };
  const lines = [];
  if (normalizedScope === "echo") {
    lines.push(`圈选文字约 ${Math.max(0, Number(payload.textLength) || 0)} 字`);
    lines.push(`裁图 ${payload.imageCount ? "1 张" : "无"}`);
    lines.push("不发送整书正文");
  } else if (normalizedScope === "review") {
    lines.push(`整书正文约 ${Math.max(0, Number(payload.fullTextLength) || 0)} 字`);
    lines.push(`航迹 ${Math.max(0, Number(payload.traceCount) || 0)} 条（情绪坐标与圈选文字）`);
    lines.push("发送到 echo-strong 凭据配置的模型");
  } else {
    lines.push(`回望结果 + 整书正文约 ${Math.max(0, Number(payload.fullTextLength) || 0)} 字`);
    lines.push("发送到 echo-strong 凭据配置的模型");
  }
  return { scope: normalizedScope, lines };
}
