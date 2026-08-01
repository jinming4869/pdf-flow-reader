// tts-policy.mjs — pure six-tier Hisheng product contracts

import { stripBalancedParentheticals } from "./tts-sentence.mjs";

const COMMON_EXCLUDED_ROLES = ["reference", "table", "formula"];

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function createPolicy({
  tierKey,
  behavior,
  autoRead,
  visibleLine = false,
  playTrigger,
  prefetchTrigger = null,
  scope,
  oncePer,
  latePolicy,
  speechRate = { mode: "comfortable" },
  prefetchEnabled = false,
  prefetchTarget = null,
  excludedRoles = COMMON_EXCLUDED_ROLES,
  excludeAnnotations = false,
  parentheticals = "keep",
  manualAction = null,
  manualShortcut = null,
  masterPlacement = "bottom",
  pointReadControlVisible = false,
} = {}) {
  return deepFreeze({
    enabled: true,
    tierKey,
    behavior,
    autoRead,
    readingLine: {
      track: true,
      visible: visibleLine,
    },
    trigger: {
      play: playTrigger,
      prefetch: prefetchTrigger,
    },
    utterance: {
      scope,
      oncePer,
      latePolicy,
    },
    speechRate,
    prefetch: {
      enabled: prefetchEnabled,
      target: prefetchTarget,
    },
    filter: {
      excludePageMargins: true,
      excludedRoles,
      excludeBibliographic: true,
      excludeAnnotations,
      parentheticals,
    },
    manual: {
      action: manualAction,
      shortcut: manualShortcut,
    },
    controls: {
      masterPlacement,
      pointReadControlVisible,
    },
    playback: {
      allowOverlap: false,
      cancelOnPolicyChange: true,
    },
  });
}

export const HISHENG_TIER_POLICIES = Object.freeze({
  "snow-mist": createPolicy({
    tierKey: "snow-mist",
    behavior: "舒适随读，当前段播放时轻轻准备下一段",
    autoRead: "continuous",
    playTrigger: "reading-line-chunk",
    prefetchTrigger: "current-utterance-started",
    scope: "readable-chunk",
    oncePer: "chunk",
    latePolicy: "skip",
    prefetchEnabled: true,
    prefetchTarget: "next-readable-chunk",
  }),
  "aesthetic-walk": createPolicy({
    tierKey: "aesthetic-walk",
    behavior: "以 1.5–2.5 倍跟随纸页，省略岔路；来不及的句子安静略过",
    autoRead: "continuous",
    playTrigger: "reading-line-chunk",
    prefetchTrigger: "current-utterance-started",
    scope: "visual-window-utterance",
    oncePer: "utterance",
    latePolicy: "shorten-at-sentence-or-skip",
    speechRate: { mode: "follow-scroll", min: 1.5, max: 2.5 },
    prefetchEnabled: true,
    prefetchTarget: "next-eligible-utterance",
    excludedRoles: [...COMMON_EXCLUDED_ROLES, "footnote", "annotation"],
    excludeAnnotations: true,
    parentheticals: "strip-balanced",
  }),
  "long-day": createPolicy({
    tierKey: "long-day",
    behavior: "保持安静；按 R 或乐符读阅读线下方最近一句",
    autoRead: "none",
    visibleLine: true,
    playTrigger: "manual-line-action",
    scope: "nearest-sentence-below-line",
    oncePer: "request",
    latePolicy: "play-once",
    manualAction: "read-line-sentence",
    manualShortcut: "KeyR",
  }),
  "winding-stream": createPolicy({
    tierKey: "winding-stream",
    behavior: "越过段落时，只让下一段的首句泛起声音",
    autoRead: "paragraph-lead",
    playTrigger: "paragraph-tail-crossed",
    prefetchTrigger: "paragraph-start-crossed",
    scope: "next-paragraph-lead-sentence",
    oncePer: "paragraph",
    latePolicy: "skip",
    prefetchEnabled: true,
    prefetchTarget: "next-paragraph-lead-sentence",
    excludedRoles: [...COMMON_EXCLUDED_ROLES, "footnote", "annotation", "heading"],
    excludeAnnotations: true,
  }),
  "strong-wind": createPolicy({
    tierKey: "strong-wind",
    behavior: "点句朗读开启后，点击 PDF 中的完整句子即可听见",
    autoRead: "none",
    playTrigger: "point-click",
    scope: "pointed-sentence",
    oncePer: "request",
    latePolicy: "play-once",
    manualAction: "point-sentence",
    masterPlacement: "top",
    pointReadControlVisible: true,
  }),
  "all-things-flourish": createPolicy({
    tierKey: "all-things-flourish",
    behavior: "点句朗读开启后，点击 PDF 中的完整句子即可听见",
    autoRead: "none",
    playTrigger: "point-click",
    scope: "pointed-sentence",
    oncePer: "request",
    latePolicy: "play-once",
    manualAction: "point-sentence",
    masterPlacement: "top",
    pointReadControlVisible: true,
  }),
});

export function policyForTier(tierKey = "long-day") {
  return HISHENG_TIER_POLICIES[tierKey] ?? HISHENG_TIER_POLICIES["long-day"];
}

export function masterEnabledFromPreferences(preferences = {}) {
  if (typeof preferences.ttsEnabled === "boolean") return preferences.ttsEnabled;
  if (preferences.ttsMode === "whisper" || preferences.ttsMode === "flow") return true;
  return false;
}

export function resolveHishengPolicy({
  enabled = false,
  tierKey = "long-day",
} = {}) {
  const policy = policyForTier(tierKey);
  if (enabled) return policy;
  return deepFreeze({
    ...policy,
    enabled: false,
    autoRead: "none",
    readingLine: { ...policy.readingLine, visible: false },
    prefetch: { ...policy.prefetch, enabled: false },
    manual: { action: null, shortcut: null },
  });
}

export function shortcutActionForPolicy({ code, policy } = {}) {
  if (code === "KeyH") return "toggle-master";
  if (!policy?.enabled || code !== policy.manual?.shortcut) return null;
  return policy.manual.action ?? null;
}

export function shouldCancelPolicyTransition({
  enabled = false,
  previousTierKey,
  nextTierKey,
} = {}) {
  return Boolean(
    enabled &&
    previousTierKey &&
    nextTierKey &&
    previousTierKey !== nextTierKey
  );
}

export function shouldPreserveContinuousSpeechOnPageChange({
  enabled = false,
  tierKey = null,
  previousPage = 0,
  nextPage = 0,
  direction = 0,
  jumped = false,
} = {}) {
  return Boolean(
    enabled &&
    tierKey === "snow-mist" &&
    Number.isInteger(previousPage) &&
    previousPage > 0 &&
    nextPage === previousPage + 1 &&
    Number(direction) >= 0 &&
    !jumped
  );
}

function isPageMarginNoise(chunk) {
  const box = chunk?.normalizedBbox;
  if (!box) return false;
  const yStart = Number(box.y) || 0;
  const yEnd = yStart + (Number(box.height) || 0);
  const short = String(chunk?.text ?? "").trim().length <= 120;
  return short && (yStart < 0.055 || yEnd > 0.945);
}

export function isChunkAllowedByPolicy(
  chunk,
  policy,
  { explicitTarget = false } = {},
) {
  if (!policy?.enabled || !String(chunk?.text ?? "").trim()) return false;
  if (explicitTarget && !chunk?.normalizedBbox) return false;

  const filter = policy.filter ?? {};
  if (filter.excludePageMargins && isPageMarginNoise(chunk)) return false;
  if (filter.excludeBibliographic && chunk?.qualityFlags?.includes?.("bibliographic")) {
    return false;
  }
  if (filter.excludedRoles?.includes?.(chunk?.role)) return false;
  if (!explicitTarget && filter.excludeAnnotations && chunk?.role === "annotation") {
    return false;
  }
  return true;
}

export function filterTextForPolicy(text = "", policy = null) {
  const normalized = String(text).replace(/\s+/gu, " ").trim();
  if (!normalized) return "";
  if (policy?.filter?.parentheticals === "strip-balanced") {
    return stripBalancedParentheticals(normalized);
  }
  return normalized;
}
