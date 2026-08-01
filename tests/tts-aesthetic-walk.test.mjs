import test from "node:test";
import assert from "node:assert/strict";

import {
  aestheticWalkPlanSignature,
  estimateSpeechSecondsAtOneX,
  isAestheticWalkPlanLate,
  planAestheticWalkUtterance,
  visualWindowSeconds,
} from "../tts-aesthetic-walk.mjs";

function chunk(text, { y = 0.36, height = 0.08 } = {}) {
  return {
    text,
    normalizedBbox: { x: 0.1, y, width: 0.8, height },
  };
}

test("speech duration estimates CJK units and Latin words separately", () => {
  assert.equal(estimateSpeechSecondsAtOneX("字".repeat(30)), 6);
  assert.equal(estimateSpeechSecondsAtOneX(Array.from({ length: 11 }, () => "word").join(" ")), 4);
});

test("visual window follows chunk geometry, page height and physical scroll speed", () => {
  assert.ok(Math.abs(visualWindowSeconds({
    chunk: chunk("text", { y: 0.4, height: 0.08 }),
    normalizedReadingY: 0.38,
    pageHeightPx: 1_000,
    scrollPxPerSecond: 10,
  }) - 10) < 1e-9);
});

test("aesthetic walk keeps a roomy utterance at the gentle 1.5x floor", () => {
  const plan = planAestheticWalkUtterance({
    chunk: chunk("A short sentence.", { y: 0.4, height: 0.12 }),
    normalizedReadingY: 0.38,
    pageHeightPx: 1_000,
    scrollPxPerSecond: 10,
    nowMs: 1_000,
  });
  assert.equal(plan.decision, "full");
  assert.equal(plan.speed, 1.5);
  assert.ok(plan.latestStartAtMs > 1_000);
});

test("aesthetic walk raises speed inside 1.5–2.5x to fit the visual window", () => {
  const text = Array.from({ length: 33 }, () => "word").join(" ");
  const plan = planAestheticWalkUtterance({
    chunk: chunk(text, { y: 0.38, height: 0.07 }),
    normalizedReadingY: 0.38,
    pageHeightPx: 1_000,
    scrollPxPerSecond: 10,
    nowMs: 2_000,
    synthesisReserveSeconds: 0.5,
  });
  assert.equal(plan.decision, "full");
  assert.equal(plan.speed, 1.85);
});

test("aesthetic walk shortens at a sentence boundary when the full chunk cannot fit", () => {
  const text = `A calm first sentence. ${Array.from({ length: 60 }, () => "later").join(" ")}.`;
  const plan = planAestheticWalkUtterance({
    chunk: chunk(text, { y: 0.38, height: 0.05 }),
    normalizedReadingY: 0.38,
    pageHeightPx: 1_000,
    scrollPxPerSecond: 10,
    nowMs: 3_000,
    synthesisReserveSeconds: 0.5,
  });
  assert.equal(plan.decision, "shortened");
  assert.equal(plan.text, "A calm first sentence.");
  assert.ok(plan.speed >= 1.5 && plan.speed <= 2.5);
});

test("aesthetic walk quietly skips when even the first sentence has passed its window", () => {
  const plan = planAestheticWalkUtterance({
    chunk: chunk(`${Array.from({ length: 50 }, () => "unhurried").join(" ")}. Another sentence.`, {
      y: 0.37,
      height: 0.02,
    }),
    normalizedReadingY: 0.38,
    pageHeightPx: 1_000,
    scrollPxPerSecond: 12,
    nowMs: 4_000,
  });
  assert.equal(plan.decision, "skip");
  assert.equal(plan.text, "");
  assert.equal(plan.speed, 2.5);
});

test("missing layout data falls back honestly to the 1.5x floor", () => {
  const plan = planAestheticWalkUtterance({
    chunk: chunk("Fallback sentence."),
    pageHeightPx: 0,
    scrollPxPerSecond: 10,
  });
  assert.equal(plan.decision, "fallback");
  assert.equal(plan.speed, 1.5);
  assert.equal(plan.latestStartAtMs, null);
});

test("plan signatures ignore deadlines while lateness uses the absolute latest start", () => {
  const first = {
    kind: "aesthetic-walk",
    decision: "full",
    text: "Same sentence.",
    speed: 1.75,
    latestStartAtMs: 5_000,
  };
  const second = { ...first, latestStartAtMs: 5_300 };
  assert.equal(aestheticWalkPlanSignature(first), aestheticWalkPlanSignature(second));
  assert.equal(isAestheticWalkPlanLate(first, { nowMs: 5_100, graceMs: 120 }), false);
  assert.equal(isAestheticWalkPlanLate(first, { nowMs: 5_121, graceMs: 120 }), true);
});
