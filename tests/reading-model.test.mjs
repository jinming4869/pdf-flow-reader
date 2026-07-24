import assert from "node:assert/strict";
import test from "node:test";

import {
  SPEED_TIERS,
  analyzeText,
  readingMetricMode,
  speedTier,
  unitsPerMinute,
} from "../reading-model.mjs";

test("six physical speed tiers keep their agreed boundaries", () => {
  assert.equal(SPEED_TIERS.length, 6);
  assert.equal(speedTier(4).name, "雪国朦胧");
  assert.equal(speedTier(8).name, "雪国朦胧");
  assert.equal(speedTier(9).name, "美学散步");
  assert.equal(speedTier(14).name, "美学散步");
  assert.equal(speedTier(15).name, "长日留痕");
  assert.equal(speedTier(21).name, "长日留痕");
  assert.equal(speedTier(22).name, "流觞曲水");
  assert.equal(speedTier(31).name, "流觞曲水");
  assert.equal(speedTier(32).name, "强风吹拂");
  assert.equal(speedTier(44).name, "强风吹拂");
  assert.equal(speedTier(45).name, "万物繁盛");
  assert.equal(speedTier(64).name, "万物繁盛");
});

test("text analysis separates language evidence from numeric reading units", () => {
  assert.deepEqual(analyzeText("你好，世界！ 123"), {
    cjkCharacters: 4,
    numericUnits: 3,
    englishWords: 0,
    source: "native",
  });
  assert.deepEqual(analyzeText("A user's well-made guide, 1981–1992."), {
    cjkCharacters: 0,
    numericUnits: 8,
    englishWords: 4,
    source: "native",
  });
  assert.deepEqual(analyzeText("日本語とカタカナ 2026", "ocr"), {
    cjkCharacters: 8,
    numericUnits: 4,
    englishWords: 0,
    source: "ocr",
  });
});

test("numbers never make an English table show the CJK metric", () => {
  const stats = analyzeText(`
    Political liberties 1981 1991 1992
    Press freedom 9 components 13 components
    Civil rights 1978 2026 100 200 300
  `);

  assert.equal(stats.cjkCharacters, 0);
  assert.ok(stats.numericUnits > 20);
  assert.ok(stats.englishWords > 0);
  assert.equal(readingMetricMode(stats.cjkCharacters, stats.englishWords), "english");
});

test("metric mode uses actual CJK characters and Latin words only", () => {
  assert.equal(readingMetricMode(0, 0), "empty");
  assert.equal(readingMetricMode(0, 80), "english");
  assert.equal(readingMetricMode(80, 0), "cjk");
  assert.equal(readingMetricMode(20, 80), "both");
  assert.equal(readingMetricMode(80, 20), "both");
  assert.equal(readingMetricMode(19, 81), "english");
  assert.equal(readingMetricMode(81, 19), "cjk");
  assert.equal(readingMetricMode(20, 120), "english");
  assert.equal(readingMetricMode(120, 20), "cjk");
});

test("reading rate follows text density and physical speed", () => {
  assert.equal(unitsPerMinute(300, 1_000, 20), 360);
  assert.equal(unitsPerMinute(300, 1_000, 10), 180);
  assert.equal(unitsPerMinute(0, 1_000, 20), 0);
  assert.equal(unitsPerMinute(300, 0, 20), 0);
  assert.equal(unitsPerMinute(300, 1_000, 0), 0);
});
