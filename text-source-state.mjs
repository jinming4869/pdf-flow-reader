const QUALITY = Object.freeze({
  READY: "ready",
  POOR: "poor",
  EMPTY: "empty",
});

const DENSITY_BLOCKING_REASONS = new Set([
  "no-text",
  "low-speakable-ratio",
  "high-noise-ratio",
  "low-bbox-coverage",
  "low-ocr-confidence",
]);

export const TEXT_SOURCE_STATE = Object.freeze({
  CHECKING_NATIVE: "checking-native",
  NATIVE_READY: "native-ready",
  OCR_NEEDED: "ocr-needed",
  OCR_SCHEDULED: "ocr-scheduled",
  OCR_RUNNING: "ocr-running",
  OCR_READY: "ocr-ready",
  OCR_POOR: "ocr-poor",
  OCR_FAILED: "ocr-failed",
  OCR_SUPPRESSED: "ocr-suppressed",
});

function clamp(value, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function safeRecords(records) {
  return Array.isArray(records)
    ? records.filter((record) => record && typeof record.text === "string" && record.text.trim())
    : [];
}

function characters(text = "") {
  return Array.from(String(text));
}

function countLetters(text = "") {
  return characters(text).filter((character) => /\p{L}/u.test(character)).length;
}

function countSpeakableUnits(text = "") {
  return characters(text).filter((character) => /[\p{L}\p{N}]/u.test(character)).length;
}

function countNonWhitespace(text = "") {
  return characters(text).filter((character) => !/\s/u.test(character)).length;
}

function countNoise(text = "") {
  return characters(text).filter((character) => (
    !/\s/u.test(character)
    && (
      /[\p{C}\uFFFD]/u.test(character)
      || /[|¦¬^~`_=+*<>\\]/u.test(character)
      || /[ÃÂ]/u.test(character)
    )
  )).length;
}

function hasUsableBbox(record) {
  const bbox = record?.bbox ?? record?.readingBbox ?? record?.normalizedBbox;
  return Boolean(
    bbox
    && Number.isFinite(Number(bbox.x))
    && Number.isFinite(Number(bbox.y))
    && finiteNumber(bbox.width) > 0
    && finiteNumber(bbox.height) > 0
  );
}

function hasTerminalPunctuation(text = "") {
  return /[.!?。！？]["'”’」』）)\]]*$/u.test(text.trim());
}

function isExcludedRole(record) {
  return ["table", "formula", "footnote", "reference"].includes(record?.role);
}

function isTocLine(text = "") {
  const clean = text.trim();
  if (!clean) return false;
  if (/^(?:table of contents|contents|目录|目次)$/iu.test(clean)) return true;
  if (/(?:\.{3,}|…{2,}|·{3,})\s*(?:[ivxlcdm]+|\d{1,4})\s*$/iu.test(clean)) return true;
  return /^(?:(?:chapter|part|section)\b|第[一二三四五六七八九十百\d]+[章节部篇]).{2,80}\s{2,}(?:[ivxlcdm]+|\d{1,4})$/iu.test(clean);
}

function isTableLikeLine(record) {
  if (["table", "formula"].includes(record?.role)) return true;
  const text = record?.text?.trim() ?? "";
  if (!text) return false;

  const nonWhitespace = countNonWhitespace(text);
  const digits = characters(text).filter((character) => /\p{N}/u.test(character)).length;
  const letters = countLetters(text);
  const cells = text.split(/\t+|\s{2,}|\|+/u).filter(Boolean);
  const numericCells = cells.filter((cell) => {
    const visible = countNonWhitespace(cell);
    const cellDigits = characters(cell).filter((character) => /\p{N}/u.test(character)).length;
    return visible > 0 && cellDigits / visible >= 0.5;
  }).length;
  const visiblePipeCells = text
    .split(/\s*[|¦]\s*/u)
    .filter((cell) => countNonWhitespace(cell) > 0);

  if (nonWhitespace > 0 && digits / nonWhitespace >= 0.5) return true;
  if (cells.length >= 3 && numericCells >= 2) return true;
  if (visiblePipeCells.length >= 5) return true;
  return letters === 0 && digits > 0;
}

function normalizeConfidence(value) {
  const confidence = finiteNumber(value, 0);
  return clamp(confidence > 1 ? confidence / 100 : confidence);
}

function assessmentState(assessment) {
  const state = assessment?.state ?? assessment?.quality ?? assessment?.status;
  return Object.values(QUALITY).includes(state) ? state : QUALITY.EMPTY;
}

/**
 * Decide whether extracted text is substantial and clean enough for TTS.
 *
 * Text metrics are calculated from readable chunks when available, otherwise
 * from segments. Geometry and OCR confidence remain character-weighted at the
 * segment level so chunk aggregation cannot hide missing boxes or weak OCR.
 */
export function assessTextQuality({
  segments = [],
  chunks = [],
  source = "native",
  languageSet = "",
} = {}) {
  const safeSegments = safeRecords(segments);
  const safeChunks = safeRecords(chunks);
  const textRecords = safeChunks.length ? safeChunks : safeSegments;
  const geometryRecords = safeSegments.length ? safeSegments : textRecords;
  const joinedText = textRecords.map((record) => record.text).join("\n");
  const totalNonWhitespace = countNonWhitespace(joinedText);

  if (totalNonWhitespace === 0) {
    return {
      state: QUALITY.EMPTY,
      quality: QUALITY.EMPTY,
      reasonCodes: ["no-text"],
      metrics: {
        proseUnits: 0,
        lineCount: 0,
        qualifiedProseLineCount: 0,
        longestReadableChunkUnits: 0,
        longestReadableChunkHasTerminalPunctuation: false,
        terminalPunctuationLineRatio: 0,
        speakableRatio: 0,
        noiseRatio: 0,
        tocLineRatio: 0,
        tableLineRatio: 0,
        bboxCoverage: 0,
        weightedConfidence: null,
      },
    };
  }

  const classified = textRecords.map((record) => {
    const toc = isTocLine(record.text);
    const table = isTableLikeLine(record);
    const excluded = isExcludedRole(record);
    const languageUnits = countLetters(record.text);
    return {
      record,
      toc,
      table,
      readable: !toc && !table && !excluded,
      languageUnits,
    };
  });
  const readable = classified.filter((entry) => entry.readable);
  const proseUnits = readable.reduce((sum, entry) => sum + entry.languageUnits, 0);
  const qualifiedProseLineCount = readable.filter((entry) => entry.languageUnits >= 16).length;
  const longestReadable = readable.reduce(
    (longest, entry) => (entry.languageUnits > longest.languageUnits ? entry : longest),
    { languageUnits: 0, record: { text: "" } },
  );
  const terminalPunctuationLineCount = readable.filter((entry) => (
    hasTerminalPunctuation(entry.record.text)
  )).length;
  const terminalPunctuationLineRatio = readable.length
    ? terminalPunctuationLineCount / readable.length
    : 0;
  const speakableRatio = countSpeakableUnits(joinedText) / totalNonWhitespace;
  const noiseRatio = countNoise(joinedText) / totalNonWhitespace;
  const tocLineRatio = classified.filter((entry) => entry.toc).length / classified.length;
  const tableLineRatio = classified.filter((entry) => entry.table).length / classified.length;

  let geometryWeight = 0;
  let boxedWeight = 0;
  let confidenceWeight = 0;
  let weightedConfidenceTotal = 0;
  for (const record of geometryRecords) {
    const weight = countSpeakableUnits(record.text);
    geometryWeight += weight;
    if (hasUsableBbox(record)) boxedWeight += weight;
    if (weight > 0) {
      confidenceWeight += weight;
      weightedConfidenceTotal += weight * normalizeConfidence(record.confidence);
    }
  }
  const bboxCoverage = geometryWeight > 0 ? boxedWeight / geometryWeight : 0;
  const isOcr = String(source).toLowerCase().includes("ocr");
  const isJapaneseOcr = isOcr && /(?:^|\+)jpn(?:\+|$)/u.test(
    String(languageSet),
  );
  const weightedConfidence = isOcr
    ? (confidenceWeight > 0 ? weightedConfidenceTotal / confidenceWeight : 0)
    : null;
  const hasProseShape = qualifiedProseLineCount >= 3
    || (
      longestReadable.languageUnits >= 120
      && hasTerminalPunctuation(longestReadable.record.text)
    );

  const metrics = {
    proseUnits,
    lineCount: classified.length,
    qualifiedProseLineCount,
    longestReadableChunkUnits: longestReadable.languageUnits,
    longestReadableChunkHasTerminalPunctuation: hasTerminalPunctuation(longestReadable.record.text),
    terminalPunctuationLineRatio,
    speakableRatio,
    noiseRatio,
    tocLineRatio,
    tableLineRatio,
    bboxCoverage,
    weightedConfidence,
  };
  const reasonCodes = [];
  if (proseUnits < 80) reasonCodes.push("insufficient-prose");
  if (!hasProseShape) reasonCodes.push("insufficient-prose-structure");
  if (speakableRatio < 0.55) reasonCodes.push("low-speakable-ratio");
  if (noiseRatio > 0.08) reasonCodes.push("high-noise-ratio");
  if (tocLineRatio >= 0.35) reasonCodes.push("toc-heavy");
  if (tableLineRatio >= 0.5) reasonCodes.push("table-heavy");
  if (bboxCoverage < 0.8) reasonCodes.push("low-bbox-coverage");
  if (isOcr && weightedConfidence < 0.55) reasonCodes.push("low-ocr-confidence");
  if (isJapaneseOcr && terminalPunctuationLineRatio < 0.4) {
    reasonCodes.push("low-sentence-boundary-ratio");
  }

  const state = reasonCodes.length ? QUALITY.POOR : QUALITY.READY;
  return { state, quality: state, reasonCodes, metrics };
}

export function assessmentSupportsDensity(assessment) {
  const state = assessmentState(assessment);
  if (state === QUALITY.READY) return true;
  if (state === QUALITY.EMPTY) return false;
  const reasons = Array.isArray(assessment?.reasonCodes)
    ? assessment.reasonCodes
    : [];
  return reasons.length > 0 && !reasons.some((reason) => (
    DENSITY_BLOCKING_REASONS.has(reason)
  ));
}

export function resolveTextSourceState({
  nativeKnown = false,
  nativeAssessment = null,
  ocrKnown = false,
  ocrAssessment = null,
  ocrTask = null,
  ocrFailed = false,
  autoSuppressed = false,
} = {}) {
  if (!nativeKnown) {
    return {
      state: TEXT_SOURCE_STATE.CHECKING_NATIVE,
      selectedSource: null,
      ttsReady: false,
      shouldScheduleOcr: false,
    };
  }

  if (assessmentState(nativeAssessment) === QUALITY.READY) {
    return {
      state: TEXT_SOURCE_STATE.NATIVE_READY,
      selectedSource: "native",
      ttsReady: true,
      shouldScheduleOcr: false,
    };
  }

  if (ocrKnown && assessmentState(ocrAssessment) === QUALITY.READY) {
    return {
      state: TEXT_SOURCE_STATE.OCR_READY,
      selectedSource: "ocr",
      ttsReady: true,
      shouldScheduleOcr: false,
    };
  }

  if (ocrTask) {
    return {
      state: ocrTask.status === "scheduled"
        ? TEXT_SOURCE_STATE.OCR_SCHEDULED
        : TEXT_SOURCE_STATE.OCR_RUNNING,
      selectedSource: null,
      ttsReady: false,
      shouldScheduleOcr: false,
    };
  }

  if (ocrFailed) {
    return {
      state: TEXT_SOURCE_STATE.OCR_FAILED,
      selectedSource: null,
      ttsReady: false,
      shouldScheduleOcr: false,
    };
  }

  if (autoSuppressed) {
    return {
      state: TEXT_SOURCE_STATE.OCR_SUPPRESSED,
      selectedSource: null,
      ttsReady: false,
      shouldScheduleOcr: false,
    };
  }

  if (ocrKnown) {
    return {
      state: TEXT_SOURCE_STATE.OCR_POOR,
      selectedSource: null,
      ttsReady: false,
      shouldScheduleOcr: false,
    };
  }

  return {
    state: TEXT_SOURCE_STATE.OCR_NEEDED,
    selectedSource: null,
    ttsReady: false,
    shouldScheduleOcr: true,
  };
}

export function selectReadableChunks({
  selectedSource = null,
  nativeChunks = [],
  ocrChunks = [],
} = {}) {
  if (selectedSource === "native" || selectedSource === "native-text") {
    return Array.isArray(nativeChunks) ? nativeChunks : [];
  }
  if (selectedSource === "ocr" || selectedSource === "ocr-text") {
    return Array.isArray(ocrChunks) ? ocrChunks : [];
  }
  return [];
}
