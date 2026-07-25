import test from "node:test";
import assert from "node:assert/strict";

import {
  clearLocalState,
  createDocumentFingerprint,
  createEmptyState,
  latestRhythmEcho,
  readLocalState,
  recentDocumentRecords,
  removeDocumentRecord,
  storageKey,
  upsertDocumentRecord,
  upsertRhythmRecord,
  writeLocalState,
} from "../storage.mjs";

class MemoryStorage {
  constructor() {
    this.map = new Map();
  }

  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }

  setItem(key, value) {
    this.map.set(key, String(value));
  }
}

test("default preferences keep subtle sound cues enabled", () => {
  const state = createEmptyState(new Date("2026-07-24T00:00:00Z"));
  assert.equal(state.preferences.soundCueEnabled, true);
  assert.equal(state.preferences.rhythmPatternMode, "soft");
});

test("createDocumentFingerprint is stable for the same local file metadata", () => {
  const first = createDocumentFingerprint({
    fileName: "Paper.PDF",
    fileSize: 2048,
    lastModified: 1234.4,
  });
  const second = createDocumentFingerprint({
    fileName: "paper.pdf",
    fileSize: 2048,
    lastModified: 1234,
  });
  assert.equal(first, second);
});

test("document records keep reading position and sort by newest update", () => {
  let state = createEmptyState(new Date("2026-07-24T00:00:00Z"));
  state = upsertDocumentRecord(
    state,
    { fileName: "A.pdf", fileSize: 100, lastModified: 1 },
    { lastPageIndex: 4, progressRatio: 0.2, lastSpeedPxPerSecond: 18 },
    new Date("2026-07-24T00:01:00Z"),
  );
  state = upsertDocumentRecord(
    state,
    { fileName: "B.pdf", fileSize: 200, lastModified: 2 },
    { lastPageIndex: 8, progressRatio: 0.5, lastSpeedPxPerSecond: 32 },
    new Date("2026-07-24T00:02:00Z"),
  );

  const recent = recentDocumentRecords(state);
  assert.equal(recent.length, 2);
  assert.equal(recent[0].fileName, "B.pdf");
  assert.equal(recent[1].lastPageIndex, 4);
});

test("rhythm echo only advances when a faster speed is recorded", () => {
  let state = createEmptyState(new Date("2026-07-24T00:00:00Z"));
  state = upsertDocumentRecord(
    state,
    { fileName: "Echo.pdf", fileSize: 300, lastModified: 3 },
    {},
    new Date("2026-07-24T00:01:00Z"),
  );
  const [documentRecord] = recentDocumentRecords(state);

  state = upsertRhythmRecord(
    state,
    documentRecord,
    { speedPxPerSecond: 42, bandKey: "strong-wind", bandName: "强风吹拂", cjkRateMin: 500, cjkRateMax: 620, pageIndex: 18 },
    new Date("2026-07-24T00:02:00Z"),
  );
  state = upsertRhythmRecord(
    state,
    documentRecord,
    { speedPxPerSecond: 20, bandKey: "long-day", bandName: "长日留痕", cjkRateMin: 200, cjkRateMax: 260, pageIndex: 19 },
    new Date("2026-07-24T00:03:00Z"),
  );

  const echo = latestRhythmEcho(state);
  assert.equal(echo.fileName, "Echo.pdf");
  assert.equal(echo.maxSpeedPxPerSecond, 42);
  assert.equal(echo.maxBandName, "强风吹拂");
});

test("state can be saved, read, removed and cleared through a storage adapter", () => {
  const storage = new MemoryStorage();
  let state = createEmptyState(new Date("2026-07-24T00:00:00Z"));
  state = upsertDocumentRecord(
    state,
    { fileName: "Stored.pdf", fileSize: 400, lastModified: 4 },
    { progressRatio: 0.75 },
    new Date("2026-07-24T00:01:00Z"),
  );
  writeLocalState(state, storage, new Date("2026-07-24T00:02:00Z"));

  const stored = readLocalState(storage);
  assert.equal(storage.getItem(storageKey).includes("Stored.pdf"), true);
  assert.equal(recentDocumentRecords(stored)[0].progressRatio, 0.75);

  const removed = removeDocumentRecord(stored, recentDocumentRecords(stored)[0].id);
  assert.equal(recentDocumentRecords(removed).length, 0);

  const cleared = clearLocalState(storage, new Date("2026-07-24T00:03:00Z"));
  assert.equal(recentDocumentRecords(cleared).length, 0);
});
