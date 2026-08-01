import test from "node:test";
import assert from "node:assert/strict";

import {
  distanceToReadingLine,
  isReadableChunk,
  pickReadableChunk,
  pickReadableSentenceBelowLine,
  previewPickedChunk,
} from "../tts-segment-picker.mjs";

function chunk(chunkIndex, y, height, text = `chunk ${chunkIndex}`, extra = {}) {
  return {
    source: "native-text",
    pageIndex: 0,
    chunkIndex,
    text,
    role: "body",
    priority: 1,
    normalizedBbox: { x: 0.1, y, width: 0.8, height },
    ...extra,
  };
}

test("isReadableChunk rejects low priority and non-body noise", () => {
  assert.equal(isReadableChunk(chunk(1, 0.2, 0.05)), true);
  assert.equal(isReadableChunk(chunk(2, 0.2, 0.05, "table", { role: "table" })), false);
  assert.equal(isReadableChunk(chunk(3, 0.2, 0.05, "footnote", { priority: 0.38 })), false);
});

test("distanceToReadingLine returns zero when the reading line crosses a chunk", () => {
  assert.equal(distanceToReadingLine(chunk(1, 0.3, 0.1), 0.35), 0);
  assert.equal(Number(distanceToReadingLine(chunk(1, 0.3, 0.1), 0.2).toFixed(2)), 0.1);
});

test("pickReadableChunk chooses the closest readable chunk in the reading window", () => {
  const pick = pickReadableChunk([
    chunk(1, 0.1, 0.05),
    chunk(2, 0.36, 0.08, "current paragraph"),
    chunk(3, 0.7, 0.05),
  ], { normalizedReadingY: 0.38 });
  assert.equal(pick.key, "native-text:0:2");
  assert.equal(pick.chunk.text, "current paragraph");
});

test("pickReadableChunk respects excludeKeys and preview truncates text", () => {
  const longText = "A".repeat(220);
  const pick = pickReadableChunk([
    chunk(1, 0.36, 0.08, longText),
    chunk(2, 0.42, 0.08, "next"),
  ], {
    normalizedReadingY: 0.38,
    excludeKeys: new Set(["native-text:0:1"]),
  });
  assert.equal(pick.key, "native-text:0:2");
  assert.equal(previewPickedChunk({ ...pick, chunk: chunk(1, 0.36, 0.08, longText) }).text.length, 178);
});

test("pickReadableSentenceBelowLine ignores closer text above the line", () => {
  const pick = pickReadableSentenceBelowLine([
    chunk(1, 0.28, 0.06, "Above sentence."),
    chunk(2, 0.41, 0.08, "Below sentence. Another one."),
  ], { normalizedReadingY: 0.38 });
  assert.equal(pick.chunk.text, "Below sentence.");
  assert.equal(pick.sentenceIndex, 0);
  assert.ok(pick.chunk.normalizedBbox.y > 0.38);
});

test("pickReadableSentenceBelowLine selects the nearest sentence inside a crossing chunk", () => {
  const pick = pickReadableSentenceBelowLine([
    chunk(
      1,
      0.3,
      0.3,
      "First sentence. Second sentence. Third sentence.",
    ),
  ], { normalizedReadingY: 0.39 });
  assert.equal(pick.chunk.text, "Second sentence.");
  assert.equal(pick.sentenceIndex, 1);
  assert.match(pick.key, /sentence:1$/);
});

test("pickReadableSentenceBelowLine rejects a sentence whose start is above the line", () => {
  const pick = pickReadableSentenceBelowLine([
    chunk(1, 0.3, 0.04, "Crossed sentence."),
    chunk(2, 0.36, 0.04, "Truly below."),
  ], { normalizedReadingY: 0.32 });
  assert.equal(pick.chunk.text, "Truly below.");
  assert.equal(pick.chunk.normalizedBbox.y, 0.36);
});
