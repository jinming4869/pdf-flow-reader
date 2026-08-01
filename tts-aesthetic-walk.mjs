// tts-aesthetic-walk.mjs — pure visual-window planning for 美学散步

import { firstSentence } from "./tts-sentence.mjs";

const DEFAULT_CJK_UNITS_PER_MINUTE = 300;
const DEFAULT_LATIN_WORDS_PER_MINUTE = 165;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizedText(text = "") {
  return String(text).replace(/\s+/gu, " ").trim();
}

function countMatches(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

export function estimateSpeechSecondsAtOneX(text = "", {
  cjkUnitsPerMinute = DEFAULT_CJK_UNITS_PER_MINUTE,
  latinWordsPerMinute = DEFAULT_LATIN_WORDS_PER_MINUTE,
} = {}) {
  const source = normalizedText(text);
  if (!source) return 0;
  const cjkUnits = countMatches(
    source,
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu,
  );
  const latinWords = countMatches(
    source,
    /\p{Script=Latin}+(?:[’'-]\p{Script=Latin}+)*/gu,
  );
  const numericTokens = countMatches(source, /\p{N}+(?:[.,]\p{N}+)*/gu);
  const cjkPerMinute = Math.max(1, finiteNumber(
    cjkUnitsPerMinute,
    DEFAULT_CJK_UNITS_PER_MINUTE,
  ));
  const latinPerMinute = Math.max(1, finiteNumber(
    latinWordsPerMinute,
    DEFAULT_LATIN_WORDS_PER_MINUTE,
  ));
  const measuredSeconds = (
    (cjkUnits / cjkPerMinute) +
    ((latinWords + numericTokens) / latinPerMinute)
  ) * 60;
  if (measuredSeconds > 0) return measuredSeconds;
  const visibleUnits = [...source].filter((character) => /[\p{L}\p{N}]/u.test(character)).length;
  return visibleUnits / (DEFAULT_CJK_UNITS_PER_MINUTE / 60);
}

export function visualWindowSeconds({
  chunk,
  normalizedReadingY = 0.38,
  pageHeightPx = 0,
  scrollPxPerSecond = 0,
} = {}) {
  const box = chunk?.normalizedBbox;
  const pageHeight = finiteNumber(pageHeightPx);
  const scrollSpeed = finiteNumber(scrollPxPerSecond);
  if (!box || pageHeight <= 0 || scrollSpeed <= 0) return null;
  const readingY = clamp(finiteNumber(normalizedReadingY, 0.38), 0, 1);
  const chunkEnd = clamp(
    finiteNumber(box.y) + Math.max(0, finiteNumber(box.height)),
    0,
    1,
  );
  return Math.max(0, (chunkEnd - readingY) * pageHeight / scrollSpeed);
}

function candidatePlan({
  decision,
  text,
  visualSeconds,
  availableSeconds,
  nowMs,
  minRate,
  maxRate,
}) {
  const baseSeconds = estimateSpeechSecondsAtOneX(text);
  if (!text || baseSeconds <= 0 || availableSeconds <= 0) return null;
  const requiredRate = baseSeconds / availableSeconds;
  if (requiredRate > maxRate) return null;
  const speed = clamp(
    Math.ceil(Math.max(minRate, requiredRate) * 100) / 100,
    minRate,
    maxRate,
  );
  const estimatedSpeechSeconds = baseSeconds / speed;
  return {
    kind: "aesthetic-walk",
    decision,
    text,
    speed,
    estimatedSpeechSeconds,
    visualWindowSeconds: visualSeconds,
    latestStartAtMs: Math.round(nowMs + Math.max(
      0,
      visualSeconds - estimatedSpeechSeconds,
    ) * 1000),
  };
}

export function planAestheticWalkUtterance({
  chunk,
  text = chunk?.text ?? "",
  normalizedReadingY = 0.38,
  pageHeightPx = 0,
  scrollPxPerSecond = 0,
  nowMs = Date.now(),
  minRate = 1.5,
  maxRate = 2.5,
  synthesisReserveSeconds = 0.65,
} = {}) {
  const source = normalizedText(text);
  const minimumRate = Math.max(0.5, finiteNumber(minRate, 1.5));
  const maximumRate = Math.max(minimumRate, finiteNumber(maxRate, 2.5));
  const visualSeconds = visualWindowSeconds({
    chunk,
    normalizedReadingY,
    pageHeightPx,
    scrollPxPerSecond,
  });
  if (visualSeconds === null) {
    return {
      kind: "aesthetic-walk",
      decision: "fallback",
      text: source,
      speed: minimumRate,
      estimatedSpeechSeconds: estimateSpeechSecondsAtOneX(source) / minimumRate,
      visualWindowSeconds: null,
      latestStartAtMs: null,
    };
  }

  const availableSeconds = Math.max(
    0,
    visualSeconds - Math.max(0, finiteNumber(synthesisReserveSeconds, 0.65)),
  );
  const fullPlan = candidatePlan({
    decision: "full",
    text: source,
    visualSeconds,
    availableSeconds,
    nowMs: finiteNumber(nowMs, Date.now()),
    minRate: minimumRate,
    maxRate: maximumRate,
  });
  if (fullPlan) return fullPlan;

  const shortenedText = firstSentence(source);
  if (shortenedText && shortenedText !== source) {
    const shortenedPlan = candidatePlan({
      decision: "shortened",
      text: shortenedText,
      visualSeconds,
      availableSeconds,
      nowMs: finiteNumber(nowMs, Date.now()),
      minRate: minimumRate,
      maxRate: maximumRate,
    });
    if (shortenedPlan) return shortenedPlan;
  }

  return {
    kind: "aesthetic-walk",
    decision: "skip",
    text: "",
    speed: maximumRate,
    estimatedSpeechSeconds: 0,
    visualWindowSeconds: visualSeconds,
    latestStartAtMs: Math.round(finiteNumber(nowMs, Date.now())),
  };
}

export function aestheticWalkPlanSignature(plan = null) {
  if (!plan || plan.kind !== "aesthetic-walk") return null;
  return [
    plan.decision ?? "unknown",
    finiteNumber(plan.speed, 1).toFixed(2),
    normalizedText(plan.text),
  ].join("|");
}

export function isAestheticWalkPlanLate(plan = null, {
  nowMs = Date.now(),
  graceMs = 120,
} = {}) {
  if (!plan || plan.kind !== "aesthetic-walk") return false;
  const deadline = Number(plan.latestStartAtMs);
  if (!Number.isFinite(deadline)) return false;
  return finiteNumber(nowMs, Date.now()) > deadline + Math.max(0, finiteNumber(graceMs, 120));
}
