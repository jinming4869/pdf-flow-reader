const LIGATURES = new Map([
  ["\uFB00", "ff"],
  ["\uFB01", "fi"],
  ["\uFB02", "fl"],
  ["\uFB03", "ffi"],
  ["\uFB04", "ffl"],
  ["\uFB05", "st"],
  ["\uFB06", "st"],
]);

const PRODUCTION_HEADER = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s+\S+\s+Sheet\s+number\s+\d+\s+Page\s+number\s+\d+\b/i;
const PAGE_NUMBER = /^[-–—]?\s*\d{1,4}\s*[-–—]?$/;
const ORNAMENT_ONLY = /^[!•·*\s]+$/u;
const SPACED_CAPS = /^(?:[A-Z]\s+){2,}[A-Z]$/;

export function replaceLigatures(text = "") {
  return String(text).replace(/[\uFB00-\uFB06]/gu, (char) => LIGATURES.get(char) ?? char);
}

export function normalizePdfArtifacts(text = "") {
  return replaceLigatures(text)
    .replace(PRODUCTION_HEADER, " ")
    .replace(/([\p{Script=Latin}]{2,})-\s+(?=[\p{Script=Latin}]{2,}\b)/gu, "$1")
    .replace(/([\p{Script=Latin}])\s+([’'])\s+([\p{Script=Latin}])/gu, "$1$2$3")
    .replace(/([\p{Script=Latin}])([’'])\s+([\p{Script=Latin}])/gu, "$1$2$3")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([([{])\s+/g, "$1")
    .replace(/\s+([)\]}])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function normalizeLineKey(text = "") {
  return normalizePdfArtifacts(text)
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function isLikelyPageNumber(text = "") {
  return PAGE_NUMBER.test(normalizePdfArtifacts(text));
}

export function isLikelyProductionHeader(text = "") {
  return PRODUCTION_HEADER.test(String(text));
}

export function isLikelyRunningHeader(text = "", { repeatedLines = new Set() } = {}) {
  const clean = normalizePdfArtifacts(text);
  if (!clean) return true;
  if (ORNAMENT_ONLY.test(clean)) return true;
  if (isLikelyProductionHeader(clean) || isLikelyPageNumber(clean)) return true;
  if (repeatedLines.has(normalizeLineKey(clean))) return true;
  if (SPACED_CAPS.test(clean) && clean.length <= 42) return true;
  return false;
}

export function repeatedLineKeys(pages = [], { minCount = 2 } = {}) {
  const counts = new Map();
  for (const lines of pages) {
    const seenOnPage = new Set();
    for (const line of Array.isArray(lines) ? lines : []) {
      const key = normalizeLineKey(typeof line === "string" ? line : line?.text ?? "");
      if (!key || key.length > 80 || isLikelyPageNumber(key)) continue;
      seenOnPage.add(key);
    }
    for (const key of seenOnPage) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, count]) => count >= minCount).map(([key]) => key));
}

export function cleanReadableLine(text = "") {
  return normalizePdfArtifacts(text);
}
