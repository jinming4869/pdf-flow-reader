import test from "node:test";
import assert from "node:assert/strict";

import {
  buildReviewInput,
  buildTraceAggregate,
  splitBookTextIntoChunks,
} from "../review-input.mjs";

function trace(overrides = {}) {
  return {
    id: "t1",
    pageIndex: 0,
    lifecycle: "active",
    source: { text: "圈选文字。" },
    readingContext: { speedTier: "long-day", speedPxPerSecond: 16, readingOrder: 0, capturedAt: "2026-08-16T00:00:00.000Z" },
    emotion: { state: "placed", original: null, current: { valence: 0.5, arousal: -0.3 } },
    ...overrides,
  };
}

test("chunking respects page boundaries and preserves anchors", () => {
  const pages = [
    { pageIndex: 0, text: "甲".repeat(400) },
    { pageIndex: 1, text: "乙".repeat(400) },
    { pageIndex: 2, text: "丙".repeat(400) },
    { pageIndex: 3, text: "" },
  ];
  const chunks = splitBookTextIntoChunks(pages, { maxCharsPerChunk: 850 });
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].pageStart, 0);
  assert.equal(chunks[0].pageEnd, 1);
  assert.equal(chunks[1].pageStart, 2);
  assert.equal(chunks[1].pageEnd, 2);
  assert.match(chunks[1].text, /\[第 3 页\]/);
  // 空页被跳过。
  assert.equal(chunks.reduce((sum, chunk) => sum + chunk.charCount, 0), 1200);
});

test("aggregate counts tiers, revisited pages, and emotion sequence in order", () => {
  const traces = [
    trace({ id: "t1", pageIndex: 2, readingContext: { speedTier: "long-day", speedPxPerSecond: 16, readingOrder: 0, capturedAt: "x" } }),
    trace({ id: "t2", pageIndex: 2, emotion: { state: "unplaced", original: null, current: null, updatedAt: null }, readingContext: { speedTier: "whisper", speedPxPerSecond: 6, readingOrder: 1, capturedAt: "x" } }),
    trace({ id: "t3", pageIndex: 0, lifecycle: "trashed", readingContext: { speedTier: "whisper", speedPxPerSecond: 6, readingOrder: 2, capturedAt: "x" } }),
    trace({ id: "t4", pageIndex: 0, emotion: { state: "placed", current: { valence: 0.1, arousal: 0.9 } }, readingContext: { speedTier: "flow", speedPxPerSecond: 24, readingOrder: 3, capturedAt: "x" } }),
  ];
  const aggregate = buildTraceAggregate(traces);
  assert.equal(aggregate.traceCount, 3);
  assert.deepEqual(aggregate.revisitedPages, [{ page: 2, count: 2 }]);
  assert.equal(aggregate.emotionSequence.length, 2);
  assert.equal(aggregate.emotionSequence[0].page, 2);
  const rendered = aggregate.render();
  assert.match(rendered, /航迹数：3/);
  assert.match(rendered, /long-day × 1/);
  assert.match(rendered, /第 3 页（2 条）/);
  assert.doesNotMatch(rendered, /圈选文字摘录：圈选文字。圈选文字。圈选文字。/);
});

test("circled text excerpts are length bounded", () => {
  const traces = Array.from({ length: 5 }, (_, index) => (
    trace({ id: `t${index}`, source: { text: "很长的圈选内容。".repeat(40) } })
  ));
  const aggregate = buildTraceAggregate(traces, { maxCircledChars: 200 });
  assert.ok(aggregate.circledText.length <= 200 + 1);
  assert.ok(aggregate.circledText.endsWith("…"));
});

test("buildReviewInput combines chunks and aggregate with totals", () => {
  const pages = [
    { pageIndex: 0, text: "第一页正文。" },
    { pageIndex: 1, text: "第二页正文。" },
  ];
  const input = buildReviewInput(pages, [trace()]);
  assert.equal(input.chunks.length, 1);
  assert.equal(input.totalChars, "第一页正文。第二页正文。".length);
  assert.equal(input.traceCount, 1);
});
