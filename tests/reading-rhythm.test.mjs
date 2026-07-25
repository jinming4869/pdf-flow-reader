import test from "node:test";
import assert from "node:assert/strict";

import {
  createRhythmSnapshot,
  densityLevelFromRatio,
  flowTimeRange,
  rateRange,
} from "../reading-rhythm.mjs";

test("rateRange gives an honest fuzzy range around a point estimate", () => {
  assert.deepEqual(rateRange(250), { min: 220, max: 280 });
  assert.deepEqual(rateRange(0), { min: 0, max: 0 });
});

test("densityLevelFromRatio translates page density into gentle labels", () => {
  assert.equal(densityLevelFromRatio(0.6).key, "sparse");
  assert.equal(densityLevelFromRatio(1).key, "balanced");
  assert.equal(densityLevelFromRatio(1.5).key, "dense");
  assert.equal(densityLevelFromRatio(null).key, "unknown");
});

test("flowTimeRange estimates remaining page flow time from pixels and speed", () => {
  assert.deepEqual(flowTimeRange(3600, 10), { minMinutes: 5, maxMinutes: 7 });
  assert.equal(flowTimeRange(0, 10), null);
  assert.equal(flowTimeRange(3600, 0), null);
});

test("createRhythmSnapshot combines rates, density, tier and remaining time", () => {
  const snapshot = createRhythmSnapshot({
    mode: "both",
    cjkRate: 300,
    englishRate: 120,
    densityRatio: 1.2,
    remainingPixels: 7200,
    pixelsPerSecond: 20,
    tier: { name: "长日留痕", themeKey: "long-day" },
  });

  assert.equal(snapshot.mode, "both");
  assert.deepEqual(snapshot.cjkRange, { min: 264, max: 336 });
  assert.deepEqual(snapshot.englishRange, { min: 106, max: 134 });
  assert.equal(snapshot.density.key, "slightly-dense");
  assert.deepEqual(snapshot.remainingFlowTime, { minMinutes: 5, maxMinutes: 7 });
});
