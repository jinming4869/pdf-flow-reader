import assert from "node:assert/strict";
import test from "node:test";

import {
  createTraceSessionState,
  transitionTraceSession,
} from "../trace-session.mjs";

function step(state, event) {
  return transitionTraceSession(state, event);
}

test("arming a trace session requests pause, TTS cancellation, and viewport freeze", () => {
  const initial = createTraceSessionState();
  const result = step(initial, { type: "ARM" });

  assert.equal(result.accepted, true);
  assert.equal(result.state.phase, "armed");
  assert.equal(result.state.generation, 1);
  assert.deepEqual(result.effects, [
    { type: "PAUSE_READING" },
    { type: "CANCEL_TTS" },
    { type: "FREEZE_VIEWPORT" },
  ]);
  assert.equal(initial.phase, "idle");
});

test("a valid same-page pointer stroke requests durable draft creation", () => {
  let state = step(createTraceSessionState(), { type: "ARM" }).state;
  state = step(state, {
    type: "POINTER_DOWN",
    pageIndex: 2,
    point: { x: 0.1, y: 0.2 },
  }).state;
  state = step(state, {
    type: "POINTER_MOVE",
    pageIndex: 2,
    point: { x: 0.7, y: 0.2 },
  }).state;
  const result = step(state, {
    type: "POINTER_UP",
    pageIndex: 2,
    point: { x: 0.4, y: 0.8 },
    valid: true,
  });

  assert.equal(result.state.phase, "saving");
  assert.equal(result.state.points.length, 3);
  assert.deepEqual(result.effects, [{
    type: "CREATE_TRACE_DRAFT",
    generation: 1,
    pageIndex: 2,
    points: [
      { x: 0.1, y: 0.2 },
      { x: 0.7, y: 0.2 },
      { x: 0.4, y: 0.8 },
    ],
  }]);
});

test("cancelled, short, and cross-page gestures keep reading paused without a trace", () => {
  const armed = step(createTraceSessionState(), { type: "ARM" }).state;
  const cancelled = step(armed, { type: "CANCEL", reason: "escape" });
  assert.equal(cancelled.state.phase, "idle");
  assert.deepEqual(cancelled.effects, [
    { type: "DISCARD_GESTURE", reason: "escape" },
    { type: "KEEP_PAUSED" },
  ]);

  const drawing = step(armed, {
    type: "POINTER_DOWN",
    pageIndex: 0,
    point: { x: 0.1, y: 0.1 },
  }).state;
  const tooShort = step(drawing, {
    type: "POINTER_UP",
    pageIndex: 0,
    point: { x: 0.11, y: 0.11 },
    valid: false,
    reason: "path-too-short",
  });
  assert.equal(tooShort.state.phase, "idle");
  assert.equal(tooShort.effects.some((effect) => effect.type === "CREATE_TRACE_DRAFT"), false);
  assert.equal(tooShort.effects.at(-1).type, "KEEP_PAUSED");

  const crossPage = step(drawing, {
    type: "POINTER_MOVE",
    pageIndex: 1,
    point: { x: 0.2, y: 0.2 },
  });
  assert.equal(crossPage.state.phase, "idle");
  assert.deepEqual(crossPage.effects, [
    { type: "DISCARD_GESTURE", reason: "cross-page" },
    { type: "KEEP_PAUSED" },
  ]);
});

test("a saved draft opens review and only explicit return begins reflow", () => {
  let state = step(createTraceSessionState(), { type: "ARM" }).state;
  state = step(state, {
    type: "POINTER_DOWN",
    pageIndex: 1,
    point: { x: 0.1, y: 0.1 },
  }).state;
  state = step(state, {
    type: "POINTER_MOVE",
    pageIndex: 1,
    point: { x: 0.8, y: 0.1 },
  }).state;
  state = step(state, {
    type: "POINTER_UP",
    pageIndex: 1,
    point: { x: 0.5, y: 0.8 },
    valid: true,
  }).state;

  const saved = step(state, {
    type: "SAVE_SUCCEEDED",
    generation: state.generation,
    traceId: "trace-7",
  });
  assert.equal(saved.state.phase, "reviewing");
  assert.deepEqual(saved.effects, [{ type: "SHOW_TRACE_REVIEW", traceId: "trace-7" }]);

  const returned = step(saved.state, { type: "RETURN_TO_FLOW" });
  assert.equal(returned.state.phase, "idle");
  assert.deepEqual(returned.effects, [{ type: "BEGIN_REFLOW", traceId: "trace-7" }]);
});

test("save failure keeps the gesture for retry and cannot silently return", () => {
  let state = step(createTraceSessionState(), { type: "ARM" }).state;
  state = step(state, {
    type: "POINTER_DOWN",
    pageIndex: 4,
    point: { x: 0.1, y: 0.1 },
  }).state;
  state = step(state, {
    type: "POINTER_MOVE",
    pageIndex: 4,
    point: { x: 0.8, y: 0.1 },
  }).state;
  state = step(state, {
    type: "POINTER_UP",
    pageIndex: 4,
    point: { x: 0.4, y: 0.9 },
    valid: true,
  }).state;

  const failed = step(state, {
    type: "SAVE_FAILED",
    generation: state.generation,
    errorCode: "DISK_FULL",
  });
  assert.equal(failed.state.phase, "save-error");
  assert.equal(failed.state.points.length, 3);
  assert.deepEqual(failed.effects, [{ type: "SHOW_TRACE_SAVE_ERROR", errorCode: "DISK_FULL" }]);
  assert.equal(step(failed.state, { type: "RETURN_TO_FLOW" }).accepted, false);

  const retry = step(failed.state, { type: "RETRY_SAVE" });
  assert.equal(retry.state.phase, "saving");
  assert.equal(retry.effects[0].type, "CREATE_TRACE_DRAFT");
  assert.deepEqual(retry.effects[0].points, failed.state.points);

  const discard = step(failed.state, { type: "DISCARD", reason: "user-confirmed" });
  assert.equal(discard.state.phase, "idle");
  assert.deepEqual(discard.effects, [
    { type: "DISCARD_GESTURE", reason: "user-confirmed" },
    { type: "KEEP_PAUSED" },
  ]);
});

test("reset invalidates late save results after a document change", () => {
  let state = step(createTraceSessionState(), { type: "ARM" }).state;
  state = step(state, {
    type: "POINTER_DOWN",
    pageIndex: 0,
    point: { x: 0.1, y: 0.1 },
  }).state;
  state = step(state, {
    type: "POINTER_MOVE",
    pageIndex: 0,
    point: { x: 0.7, y: 0.1 },
  }).state;
  state = step(state, {
    type: "POINTER_UP",
    pageIndex: 0,
    point: { x: 0.4, y: 0.8 },
    valid: true,
  }).state;
  const oldGeneration = state.generation;

  const reset = step(state, { type: "RESET", reason: "document-changed" });
  assert.equal(reset.state.phase, "idle");
  assert.equal(reset.state.generation, oldGeneration + 1);
  assert.deepEqual(reset.effects, [{ type: "ABORT_TRACE_SESSION", reason: "document-changed" }]);

  const late = step(reset.state, {
    type: "SAVE_SUCCEEDED",
    generation: oldGeneration,
    traceId: "late-trace",
  });
  assert.equal(late.accepted, false);
  assert.deepEqual(late.state, reset.state);
  assert.deepEqual(late.effects, []);
});
