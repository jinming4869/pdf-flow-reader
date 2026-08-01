import test from "node:test";
import assert from "node:assert/strict";

import { createPointReadSession } from "../tts-point-session.mjs";

test("a natural end restores the scroll state captured before point reading", () => {
  const session = createPointReadSession();
  const request = session.begin({ targetKey: "sentence-a", wasPlaying: true, speed: 32 });

  assert.equal(request.shouldPause, true);
  assert.equal(session.snapshot().holdActive, true);
  assert.equal(session.markPhase(request.token, "playing"), true);

  const result = session.settle(request.token, { outcome: "ended" });
  assert.deepEqual(result, {
    accepted: true,
    shouldResume: true,
    resumeSpeed: 32,
    outcome: "ended",
  });
  assert.equal(session.snapshot().active, false);
  assert.equal(session.snapshot().holdActive, false);
});

test("a failed point read releases the hold without restoring playback", () => {
  const session = createPointReadSession();
  const request = session.begin({ targetKey: "sentence-a", wasPlaying: true, speed: 20 });
  const result = session.settle(request.token, { outcome: "failed" });

  assert.equal(result.accepted, true);
  assert.equal(result.shouldResume, false);
  assert.equal(result.resumeSpeed, null);
  assert.equal(session.snapshot().active, false);
  assert.equal(session.snapshot().holdActive, false);
});

test("user intervention prevents restoration after audio ends", () => {
  const session = createPointReadSession();
  const request = session.begin({ targetKey: "sentence-a", wasPlaying: true, speed: 24 });

  session.interrupt("speed-change");
  const result = session.settle(request.token, { outcome: "ended" });

  assert.equal(result.accepted, true);
  assert.equal(result.shouldResume, false);
  assert.equal(session.snapshot().lastReason, "speed-change");
});

test("A to B replacement is last-click-wins and preserves the original scroll baseline", () => {
  const session = createPointReadSession();
  const a = session.begin({ targetKey: "sentence-a", wasPlaying: true, speed: 45 });
  const b = session.begin({ targetKey: "sentence-b", wasPlaying: false, speed: 0 });

  assert.equal(session.isCurrent(a.token), false);
  assert.equal(session.isCurrent(b.token), true);
  assert.equal(b.shouldPause, false);
  assert.equal(b.baseline.wasPlaying, true);
  assert.equal(b.baseline.speed, 45);

  assert.deepEqual(session.settle(a.token, { outcome: "ended" }), {
    accepted: false,
    shouldResume: false,
    resumeSpeed: null,
    outcome: "ended",
  });
  assert.equal(session.isCurrent(b.token), true);

  const result = session.settle(b.token, { outcome: "ended" });
  assert.equal(result.shouldResume, true);
  assert.equal(result.resumeSpeed, 45);
  assert.equal(session.snapshot().active, false);
});

test("cancel invalidates the request token and clears the scroll hold", () => {
  const session = createPointReadSession();
  const request = session.begin({ targetKey: "sentence-a", wasPlaying: true, speed: 28 });

  const cancelled = session.cancel("page-change");

  assert.equal(cancelled.active, false);
  assert.equal(cancelled.holdActive, false);
  assert.equal(cancelled.lastReason, "page-change");
  assert.equal(session.isCurrent(request.token), false);
});
