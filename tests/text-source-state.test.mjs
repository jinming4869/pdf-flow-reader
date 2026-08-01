import test from "node:test";
import assert from "node:assert/strict";

import {
  assessmentSupportsDensity,
  assessTextQuality,
  resolveTextSourceState,
  selectReadableChunks,
  TEXT_SOURCE_STATE,
} from "../text-source-state.mjs";

const bbox = { x: 10, y: 20, width: 300, height: 18 };

function record(text, overrides = {}) {
  return { text, bbox, role: "body", confidence: 1, ...overrides };
}

function cleanProseLines() {
  return [
    record("Patient reading makes difficult arguments easier to follow."),
    record("Each sentence adds enough context for the next idea to settle."),
    record("A quiet page can hold attention without forcing a hurried pace."),
  ];
}

test("clean native prose is ready", () => {
  const result = assessTextQuality({
    chunks: cleanProseLines(),
    source: "native-text",
  });

  assert.equal(result.state, "ready");
  assert.deepEqual(result.reasonCodes, []);
  assert.ok(result.metrics.proseUnits >= 80);
  assert.equal(result.metrics.qualifiedProseLineCount, 3);
  assert.equal(result.metrics.bboxCoverage, 1);
  assert.equal(result.metrics.weightedConfidence, null);
});

test("empty extraction is empty rather than poor", () => {
  const result = assessTextQuality({
    segments: [{ text: "   \n\t  ", bbox }],
    source: "native-text",
  });

  assert.equal(result.state, "empty");
  assert.deepEqual(result.reasonCodes, ["no-text"]);
});

test("a long readable chunk can satisfy the prose-shape alternative", () => {
  const result = assessTextQuality({
    chunks: [record(`${"a".repeat(120)}.`)],
    source: "native-text",
  });

  assert.equal(result.state, "ready");
  assert.equal(result.metrics.longestReadableChunkUnits, 120);
  assert.equal(result.metrics.longestReadableChunkHasTerminalPunctuation, true);
});

test("prose units and three-line thresholds are inclusive", () => {
  const chunks = [
    record("a".repeat(27)),
    record("b".repeat(27)),
    record("c".repeat(26)),
  ];
  const result = assessTextQuality({ chunks, source: "native-text" });

  assert.equal(result.metrics.proseUnits, 80);
  assert.equal(result.metrics.qualifiedProseLineCount, 3);
  assert.equal(result.state, "ready");
});

test("table-of-contents text is poor", () => {
  const result = assessTextQuality({
    chunks: [
      record("Introduction ................................ 1"),
      record("Methods .................................... 18"),
      record("Results .................................... 42"),
      record("Appendix ................................... 96"),
    ],
    source: "native-text",
  });

  assert.equal(result.state, "poor");
  assert.equal(result.metrics.tocLineRatio, 1);
  assert.ok(result.reasonCodes.includes("toc-heavy"));
});

test("the directory ratio must be strictly below 0.35", () => {
  const toc = Array.from({ length: 7 }, (_, index) => record(`Chapter ${index} ........ ${index + 1}`));
  const prose = Array.from(
    { length: 13 },
    (_, index) => record(`Readable prose line number ${index} carries a complete and useful thought.`),
  );
  const atBoundary = assessTextQuality({ chunks: [...toc, ...prose] });
  const belowBoundary = assessTextQuality({ chunks: [...toc.slice(0, 6), ...prose, record("One more readable prose line keeps the ratio below its limit.")] });

  assert.equal(atBoundary.metrics.tocLineRatio, 0.35);
  assert.ok(atBoundary.reasonCodes.includes("toc-heavy"));
  assert.ok(belowBoundary.metrics.tocLineRatio < 0.35);
  assert.ok(!belowBoundary.reasonCodes.includes("toc-heavy"));
});

test("numeric tables are poor and the table ratio rejects 0.50", () => {
  const tables = Array.from({ length: 5 }, (_, index) => record(`${2000 + index}  120  450  930`));
  const prose = Array.from(
    { length: 5 },
    (_, index) => record(`Interpretive prose line ${index} explains what the reported values mean.`),
  );
  const result = assessTextQuality({ chunks: [...tables, ...prose] });

  assert.equal(result.state, "poor");
  assert.equal(result.metrics.tableLineRatio, 0.5);
  assert.ok(result.reasonCodes.includes("table-heavy"));
});

test("OCR vocabulary grids separated by repeated pipes are table-like", () => {
  const vocabularyRows = Array.from({ length: 4 }, (_, index) => record(
    `休暇${index} | 休假 | holiday | 授業 | 上课 | lesson`,
  ));
  const result = assessTextQuality({
    chunks: [...vocabularyRows, record("丁さんは上海の日系企業の会社員です。毎朝七時に起きます。")],
    source: "ocr",
  });

  assert.equal(result.metrics.tableLineRatio, 0.8);
  assert.ok(result.reasonCodes.includes("table-heavy"));
  assert.equal(result.state, "poor");
});

test("CJK OCR lists without enough sentence endings stay unavailable for speech", () => {
  const result = assessTextQuality({
    chunks: [
      record("休暇 休假 holiday 授業 上课 lesson"),
      record("習慣 习惯 custom 交流 交流 exchange"),
      record("瞬間 瞬间 moment 評判 评价 reputation"),
      record("丁さんは会社員です。"),
    ],
    source: "ocr",
    languageSet: "jpn+chi_sim+eng",
  });

  assert.equal(result.metrics.terminalPunctuationLineRatio, 0.25);
  assert.ok(result.reasonCodes.includes("low-sentence-boundary-ratio"));
  assert.equal(result.state, "poor");
  assert.equal(assessmentSupportsDensity(result), true);
});

test("CJK OCR prose with stable sentence boundaries remains ready", () => {
  const result = assessTextQuality({
    chunks: [
      record("丁さんは上海の日系企業の会社員で、毎朝七時に起きます。"),
      record("それから家で朝ご飯を食べ、八時ごろ電車で会社へ行きます。"),
      record("会社は郊外にあり、駅から会社までいつも一時間ぐらいかかります。"),
    ],
    source: "ocr",
    languageSet: "jpn+chi_sim+eng",
  });

  assert.equal(result.metrics.terminalPunctuationLineRatio, 1);
  assert.ok(!result.reasonCodes.includes("low-sentence-boundary-ratio"));
  assert.equal(result.state, "ready");
});

test("Chinese OCR prose is not rejected when chunk boundaries cut through sentences", () => {
  const result = assessTextQuality({
    chunks: [
      record("土地合并以后，农民仍然依靠公共土地维持生活。"),
      record("庄园制度的变化并不会立刻消除旧有的社会关系"),
      record("地方权力也会影响农民进入市场时能够采取的选择"),
      record("这些条件共同塑造了现代社会形成过程中的政治冲突"),
    ],
    source: "ocr",
    languageSet: "chi_sim+eng",
  });

  assert.equal(result.metrics.terminalPunctuationLineRatio, 0.25);
  assert.ok(!result.reasonCodes.includes("low-sentence-boundary-ratio"));
  assert.equal(result.state, "ready");
});

test("noisy or low-confidence OCR never drives the speed estimate", () => {
  assert.equal(assessmentSupportsDensity({
    state: "poor",
    reasonCodes: ["low-ocr-confidence"],
  }), false);
  assert.equal(assessmentSupportsDensity({
    state: "poor",
    reasonCodes: ["high-noise-ratio", "low-sentence-boundary-ratio"],
  }), false);
  assert.equal(assessmentSupportsDensity({ state: "empty", reasonCodes: ["no-text"] }), false);
});

test("visible gibberish is poor rather than empty", () => {
  const result = assessTextQuality({
    chunks: [record("����������������||||||||||||||||")],
    source: "native-text",
  });

  assert.equal(result.state, "poor");
  assert.ok(result.metrics.noiseRatio > 0.08);
  assert.ok(result.reasonCodes.includes("high-noise-ratio"));
});

test("speakable ratio accepts 0.55 and rejects values below it", () => {
  const atBoundary = assessTextQuality({
    chunks: [
      record(`${"a".repeat(37)}${",".repeat(30)}`),
      record(`${"b".repeat(37)}${";".repeat(30)}`),
      record(`${"c".repeat(36)}${":".repeat(30)}`),
    ],
  });
  const belowBoundary = assessTextQuality({
    chunks: [
      record(`${"a".repeat(37)}${",".repeat(30)}`),
      record(`${"b".repeat(36)}${";".repeat(31)}`),
      record(`${"c".repeat(36)}${":".repeat(30)}`),
    ],
  });

  assert.equal(atBoundary.metrics.speakableRatio, 0.55);
  assert.ok(!atBoundary.reasonCodes.includes("low-speakable-ratio"));
  assert.ok(belowBoundary.metrics.speakableRatio < 0.55);
  assert.ok(belowBoundary.reasonCodes.includes("low-speakable-ratio"));
});

test("noise ratio accepts 0.08 and rejects values above it", () => {
  const atBoundary = assessTextQuality({
    chunks: [
      record(`${"a".repeat(62)}${"�".repeat(5)}`),
      record(`${"b".repeat(61)}${"�".repeat(6)}`),
      record(`${"c".repeat(61)}${"�".repeat(5)}`),
    ],
  });
  const aboveBoundary = assessTextQuality({
    chunks: [
      record(`${"a".repeat(61)}${"�".repeat(6)}`),
      record(`${"b".repeat(61)}${"�".repeat(6)}`),
      record(`${"c".repeat(61)}${"�".repeat(5)}`),
    ],
  });

  assert.equal(atBoundary.metrics.noiseRatio, 0.08);
  assert.ok(!atBoundary.reasonCodes.includes("high-noise-ratio"));
  assert.ok(aboveBoundary.metrics.noiseRatio > 0.08);
  assert.ok(aboveBoundary.reasonCodes.includes("high-noise-ratio"));
});

test("bbox coverage accepts 0.80 and rejects values below it", () => {
  const valid = record("a".repeat(80));
  const missingTwenty = record("b".repeat(20), { bbox: null });
  const atBoundary = assessTextQuality({
    segments: [valid, missingTwenty],
    chunks: [
      record("a".repeat(34)),
      record("b".repeat(33)),
      record("c".repeat(33)),
    ],
  });
  const missingTwentyOne = record("b".repeat(21), { bbox: null });
  const belowBoundary = assessTextQuality({
    segments: [record("a".repeat(79)), missingTwentyOne],
    chunks: [
      record("a".repeat(34)),
      record("b".repeat(33)),
      record("c".repeat(33)),
    ],
  });

  assert.equal(atBoundary.metrics.bboxCoverage, 0.8);
  assert.equal(atBoundary.state, "ready");
  assert.ok(belowBoundary.metrics.bboxCoverage < 0.8);
  assert.ok(belowBoundary.reasonCodes.includes("low-bbox-coverage"));
});

test("OCR confidence is character-weighted and accepts 0.55", () => {
  const chunks = [record(`${"a".repeat(120)}.`)];
  const atBoundary = assessTextQuality({
    segments: [record("a".repeat(90), { confidence: 0.6 }), record("b".repeat(30), { confidence: 0.4 })],
    chunks,
    source: "ocr",
  });
  const belowBoundary = assessTextQuality({
    segments: [record("a".repeat(90), { confidence: 0.59 }), record("b".repeat(30), { confidence: 0.4 })],
    chunks,
    source: "ocr",
  });

  assert.equal(atBoundary.metrics.weightedConfidence, 0.55);
  assert.equal(atBoundary.state, "ready");
  assert.ok(belowBoundary.metrics.weightedConfidence < 0.55);
  assert.ok(belowBoundary.reasonCodes.includes("low-ocr-confidence"));
});

test("native ready wins even when OCR is also ready", () => {
  const result = resolveTextSourceState({
    nativeKnown: true,
    nativeAssessment: { state: "ready" },
    ocrKnown: true,
    ocrAssessment: { state: "ready" },
  });

  assert.deepEqual(result, {
    state: TEXT_SOURCE_STATE.NATIVE_READY,
    selectedSource: "native",
    ttsReady: true,
    shouldScheduleOcr: false,
  });
});

test("poor native text switches to ready OCR text", () => {
  const result = resolveTextSourceState({
    nativeKnown: true,
    nativeAssessment: { state: "poor" },
    ocrKnown: true,
    ocrAssessment: { state: "ready" },
  });

  assert.equal(result.state, TEXT_SOURCE_STATE.OCR_READY);
  assert.equal(result.selectedSource, "ocr");
  assert.equal(result.ttsReady, true);
  assert.equal(result.shouldScheduleOcr, false);
});

test("poor native text schedules OCR only when work is not terminal or active", () => {
  const base = {
    nativeKnown: true,
    nativeAssessment: { state: "poor" },
    ocrKnown: false,
  };
  const needed = resolveTextSourceState(base);
  const scheduled = resolveTextSourceState({
    ...base,
    ocrTask: { pageIndex: 2, status: "scheduled" },
  });
  const running = resolveTextSourceState({
    ...base,
    ocrTask: { pageIndex: 2, status: "running" },
  });
  const failed = resolveTextSourceState({ ...base, ocrFailed: true });
  const suppressed = resolveTextSourceState({ ...base, autoSuppressed: true });

  assert.equal(needed.state, TEXT_SOURCE_STATE.OCR_NEEDED);
  assert.equal(needed.shouldScheduleOcr, true);
  assert.equal(scheduled.state, TEXT_SOURCE_STATE.OCR_SCHEDULED);
  assert.equal(scheduled.shouldScheduleOcr, false);
  assert.equal(running.state, TEXT_SOURCE_STATE.OCR_RUNNING);
  assert.equal(running.shouldScheduleOcr, false);
  assert.equal(failed.state, TEXT_SOURCE_STATE.OCR_FAILED);
  assert.equal(failed.shouldScheduleOcr, false);
  assert.equal(suppressed.state, TEXT_SOURCE_STATE.OCR_SUPPRESSED);
  assert.equal(suppressed.shouldScheduleOcr, false);
});

test("known poor OCR does not loop into another automatic request", () => {
  const result = resolveTextSourceState({
    nativeKnown: true,
    nativeAssessment: { state: "empty" },
    ocrKnown: true,
    ocrAssessment: { state: "poor" },
  });

  assert.equal(result.state, TEXT_SOURCE_STATE.OCR_POOR);
  assert.equal(result.ttsReady, false);
  assert.equal(result.shouldScheduleOcr, false);
});

test("selectReadableChunks returns only the chosen source", () => {
  const nativeChunks = [record("native")];
  const ocrChunks = [record("ocr")];

  assert.equal(selectReadableChunks({ selectedSource: "native", nativeChunks, ocrChunks }), nativeChunks);
  assert.equal(selectReadableChunks({ selectedSource: "ocr", nativeChunks, ocrChunks }), ocrChunks);
  assert.deepEqual(selectReadableChunks({ selectedSource: null, nativeChunks, ocrChunks }), []);
});
