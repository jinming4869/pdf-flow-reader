import test from "node:test";
import assert from "node:assert/strict";

import {
  createReadingClockSnapshot,
  hasReadingClockAdvanced,
  readingLineOffset,
} from "../reading-clock.mjs";

test("readingLineOffset follows the agreed reading-line ratio", () => {
  assert.equal(readingLineOffset({ scrollTop: 100, viewportHeight: 1000, ratio: 0.38 }), 480);
});

test("createReadingClockSnapshot normalizes scroll and progress state", () => {
  const snapshot = createReadingClockSnapshot({
    isPlaying: true,
    speedPxPerSecond: 18,
    scrollTop: 500,
    viewportHeight: 1000,
    scrollHeight: 3000,
    currentPageIndex: 4,
    updatedAt: 123,
  });

  assert.equal(snapshot.isPlaying, true);
  assert.equal(snapshot.readingLineY, 880);
  assert.equal(snapshot.progressRatio, 0.25);
  assert.equal(snapshot.currentPageIndex, 4);
  assert.equal(snapshot.updatedAt, 123);
});

test("hasReadingClockAdvanced detects meaningful movement and state changes", () => {
  const previous = createReadingClockSnapshot({ scrollTop: 100, viewportHeight: 1000, scrollHeight: 3000, currentPageIndex: 1 });
  const same = createReadingClockSnapshot({ scrollTop: 101, viewportHeight: 1000, scrollHeight: 3000, currentPageIndex: 1 });
  const moved = createReadingClockSnapshot({ scrollTop: 220, viewportHeight: 1000, scrollHeight: 3000, currentPageIndex: 1 });
  const pageChanged = createReadingClockSnapshot({ scrollTop: 101, viewportHeight: 1000, scrollHeight: 3000, currentPageIndex: 2 });

  assert.equal(hasReadingClockAdvanced(previous, same), false);
  assert.equal(hasReadingClockAdvanced(previous, moved), true);
  assert.equal(hasReadingClockAdvanced(previous, pageChanged), true);
});
