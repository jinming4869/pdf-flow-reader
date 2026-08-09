import assert from "node:assert/strict";
import test from "node:test";

import {
  READING_TRACE_SCHEMA_VERSION,
  assertReadingTrace,
  createReadingTraceDraft,
  fromReadingTraceRecord,
  isPersistableReadingTrace,
  toReadingTraceRecord,
  transitionReadingTrace,
} from "../reading-trace.mjs";

const CAPTURED_AT = new Date("2026-08-09T10:00:00.000Z");

function draft(overrides = {}) {
  return createReadingTraceDraft({
    id: "trace-1",
    documentId: "doc-1",
    documentFingerprint: "pdf:strict-content-id",
    pageIndex: 7,
    lassoPath: [
      { x: 0.1, y: 0.2 },
      { x: 0.6, y: 0.2 },
      { x: 0.4, y: 0.7 },
    ],
    sourceText: "A sentence that mattered.",
    sourceProvenance: "native",
    speedTier: "long-day",
    speedPxPerSecond: 20,
    readingOrder: 3,
    ...overrides,
  }, { now: CAPTURED_AT });
}

test("lasso closure creates a durable draft without AI or archive fields", () => {
  const inputPath = [
    { x: 0.1, y: 0.2 },
    { x: 0.6, y: 0.2 },
    { x: 0.4, y: 0.7 },
  ];
  const trace = draft({ lassoPath: inputPath });

  assert.equal(trace.schemaVersion, READING_TRACE_SCHEMA_VERSION);
  assert.equal(trace.lifecycle, "draft");
  assert.equal(trace.crop.state, "pending");
  assert.equal(trace.emotion.state, "unplaced");
  assert.equal(trace.createdAt, "2026-08-09T10:00:00.000Z");
  assert.equal(trace.updatedAt, trace.createdAt);
  assert.equal(trace.revision, 1);
  assert.equal("echo" in trace, false);
  assert.equal("archive" in trace, false);
  assert.notEqual(trace.lassoPath, inputPath);
  assert.deepEqual(trace.lassoPath, inputPath);
});

test("trace contract rejects malformed normalized paths and document anchors", () => {
  assert.throws(() => draft({ documentFingerprint: "" }), { code: "TRACE_INVALID" });
  assert.throws(() => draft({ pageIndex: -1 }), { code: "TRACE_INVALID" });
  assert.throws(() => draft({ lassoPath: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }), {
    code: "TRACE_INVALID",
  });
  assert.throws(() => draft({
    lassoPath: [{ x: 0, y: 0 }, { x: 1.1, y: 0.5 }, { x: 0.2, y: 0.3 }],
  }), { code: "TRACE_INVALID" });
});

test("crop can fail, retry, and become ready without losing the trace", () => {
  const failed = transitionReadingTrace(draft(), {
    type: "CROP_FAILED",
    errorCode: "CANVAS_OOM",
  }, { now: new Date("2026-08-09T10:00:01Z") });
  assert.equal(failed.crop.state, "failed");
  assert.equal(failed.crop.errorCode, "CANVAS_OOM");
  assert.equal(failed.lifecycle, "draft");

  const pending = transitionReadingTrace(failed, { type: "RETRY_CROP" }, {
    now: new Date("2026-08-09T10:00:02Z"),
  });
  assert.deepEqual(pending.crop, {
    state: "pending",
    reference: null,
    mimeType: null,
    width: null,
    height: null,
    errorCode: null,
    updatedAt: "2026-08-09T10:00:02.000Z",
  });

  const ready = transitionReadingTrace(pending, {
    type: "CROP_READY",
    reference: "traces/trace-1/crop.png",
    mimeType: "image/png",
    width: 1200,
    height: 800,
  }, { now: new Date("2026-08-09T10:00:03Z") });
  assert.equal(ready.crop.state, "ready");
  assert.equal(ready.crop.reference, "traces/trace-1/crop.png");
  assert.equal(ready.crop.width, 1200);
  assert.equal(ready.crop.errorCode, null);
});

test("placing emotion activates a trace and revision preserves the original coordinate", () => {
  const placed = transitionReadingTrace(draft(), {
    type: "PLACE_EMOTION",
    valence: -0.7,
    arousal: 0.8,
  }, { now: new Date("2026-08-09T10:01:00Z") });
  assert.equal(placed.lifecycle, "active");
  assert.equal(placed.emotion.state, "placed");
  assert.deepEqual(placed.emotion.original, { valence: -0.7, arousal: 0.8 });
  assert.deepEqual(placed.emotion.current, placed.emotion.original);

  const revised = transitionReadingTrace(placed, {
    type: "REVISE_EMOTION",
    valence: -0.4,
    arousal: 0.5,
  }, { now: new Date("2026-08-09T10:02:00Z") });
  assert.equal(revised.emotion.state, "revised");
  assert.deepEqual(revised.emotion.original, { valence: -0.7, arousal: 0.8 });
  assert.deepEqual(revised.emotion.current, { valence: -0.4, arousal: 0.5 });
  assert.equal(revised.revision, 3);
  assert.throws(() => transitionReadingTrace(draft(), {
    type: "REVISE_EMOTION",
    valence: 0,
    arousal: 0,
  }), { code: "TRACE_INVALID_TRANSITION" });
});

test("trash is recoverable and purge requires explicit confirmation", () => {
  const placed = transitionReadingTrace(draft(), {
    type: "PLACE_EMOTION",
    valence: 0.4,
    arousal: -0.2,
  }, { now: new Date("2026-08-09T10:01:00Z") });
  const trashed = transitionReadingTrace(placed, { type: "TRASH" }, {
    now: new Date("2026-08-09T10:05:00Z"),
  });

  assert.equal(trashed.lifecycle, "trashed");
  assert.equal(trashed.trashedAt, "2026-08-09T10:05:00.000Z");
  assert.equal(trashed.purgeAfter, "2026-09-08T10:05:00.000Z");
  assert.throws(() => transitionReadingTrace(trashed, {
    type: "CROP_FAILED",
    errorCode: "LATE_RESULT",
  }), { code: "TRACE_INVALID_TRANSITION" });
  assert.throws(() => transitionReadingTrace(trashed, { type: "PURGE" }), {
    code: "TRACE_CONFIRMATION_REQUIRED",
  });

  const restored = transitionReadingTrace(trashed, { type: "RESTORE" }, {
    now: new Date("2026-08-09T10:06:00Z"),
  });
  assert.equal(restored.lifecycle, "active");
  assert.equal(restored.trashedAt, null);
  assert.equal(restored.purgeAfter, null);

  const trashedAgain = transitionReadingTrace(restored, { type: "TRASH" }, {
    now: new Date("2026-08-09T10:07:00Z"),
  });
  const purged = transitionReadingTrace(trashedAgain, {
    type: "PURGE",
    confirmed: true,
  }, { now: new Date("2026-08-09T10:08:00Z") });
  assert.equal(purged.lifecycle, "purged");
  assert.equal(isPersistableReadingTrace(purged), false);
  assert.throws(() => toReadingTraceRecord(purged), { code: "TRACE_NOT_PERSISTABLE" });
});

test("serialization round-trips through a detached strict record", () => {
  const trace = draft();
  assert.equal(assertReadingTrace(trace), trace);
  const record = toReadingTraceRecord(trace);
  assert.deepEqual(record, trace);
  assert.notEqual(record, trace);
  record.lassoPath[0].x = 0.9;
  assert.equal(trace.lassoPath[0].x, 0.1);

  const restored = fromReadingTraceRecord(toReadingTraceRecord(trace));
  assert.deepEqual(restored, trace);
  assert.notEqual(restored, trace);
  assert.equal(Object.isFrozen(restored), true);

  assert.throws(() => fromReadingTraceRecord({
    ...toReadingTraceRecord(trace),
    schemaVersion: 0,
  }), { code: "TRACE_INVALID" });
});
