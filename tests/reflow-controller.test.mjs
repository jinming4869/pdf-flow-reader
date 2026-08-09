import assert from "node:assert/strict";
import test from "node:test";

import {
  createReflowController,
  reflowTargetForSpeed,
  smoothstep,
} from "../reflow-controller.mjs";

test("reflow target stays in the current tier upper region without slowing the user", () => {
  assert.equal(reflowTargetForSpeed(6), 7);
  assert.equal(reflowTargetForSpeed(16), 20);
  assert.equal(reflowTargetForSpeed(24), 29);
  assert.equal(reflowTargetForSpeed(42), 42);
  assert.equal(reflowTargetForSpeed(64), 64);
});

test("smoothstep is bounded and symmetric", () => {
  assert.equal(smoothstep(-1), 0);
  assert.equal(smoothstep(0), 0);
  assert.equal(smoothstep(0.5), 0.5);
  assert.equal(smoothstep(1), 1);
  assert.equal(smoothstep(2), 1);
});

test("short interruption follows a deterministic thirty-second curve", () => {
  const controller = createReflowController();
  const started = controller.start({
    currentSpeed: 16,
    interruptionMs: 20_000,
    reason: "trace-return",
    now: 1_000,
  });
  assert.equal(started.active, true);
  assert.equal(started.mode, "short");
  assert.equal(started.durationMs, 30_000);
  assert.equal(started.startSpeed, 16);
  assert.equal(started.targetSpeed, 20);

  assert.deepEqual(controller.sample(16_000), {
    active: true,
    done: false,
    mode: "short",
    progress: 0.5,
    speed: 18,
    targetSpeed: 20,
  });
  assert.deepEqual(controller.sample(31_000), {
    active: false,
    done: true,
    mode: "short",
    progress: 1,
    speed: 20,
    targetSpeed: 20,
  });
});

test("new documents and long interruptions use ninety seconds", () => {
  const newDocument = createReflowController();
  assert.equal(newDocument.start({
    currentSpeed: 16,
    reason: "new-document",
    now: 0,
  }).durationMs, 90_000);

  const longPause = createReflowController({ longPauseThresholdMs: 10 * 60_000 });
  const snapshot = longPause.start({
    currentSpeed: 22,
    interruptionMs: 10 * 60_000,
    reason: "resume",
    now: 100,
  });
  assert.equal(snapshot.mode, "long");
  assert.equal(snapshot.durationMs, 90_000);
});

test("manual intervention cancels a curve and it never revives by itself", () => {
  const controller = createReflowController();
  controller.start({ currentSpeed: 16, reason: "trace-return", now: 0 });
  const before = controller.sample(10_000);
  const cancelled = controller.cancel("user-scroll", { now: 10_000 });
  assert.equal(cancelled.active, false);
  assert.equal(cancelled.lastReason, "user-scroll");
  assert.equal(cancelled.lastSpeed, before.speed);
  assert.equal(controller.sample(20_000), null);
});

test("a speed already at the tier target resumes without a fake curve", () => {
  const controller = createReflowController();
  const snapshot = controller.start({ currentSpeed: 20, reason: "resume", now: 0 });
  assert.equal(snapshot.active, false);
  assert.equal(snapshot.startSpeed, 20);
  assert.equal(snapshot.targetSpeed, 20);
  assert.equal(controller.sample(10_000), null);
});
