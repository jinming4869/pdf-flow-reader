import test from "node:test";
import assert from "node:assert/strict";

import {
  shouldActivatePointReadGesture,
  shouldRenderPointReadHover,
} from "../tts-point-gesture.mjs";

const click = {
  button: 0,
  pointerType: "mouse",
  movement: 2,
  maxMovement: 6,
  downTargetKey: "sentence:a",
  upTargetKey: "sentence:a",
  selectionCollapsed: true,
  modified: false,
};

test("a short primary click on one sentence activates point read", () => {
  assert.equal(shouldActivatePointReadGesture(click), true);
});

test("dragging, selecting, changing targets, modifiers, and touch never point-read", () => {
  for (const patch of [
    { movement: 7 },
    { selectionCollapsed: false },
    { upTargetKey: "sentence:b" },
    { modified: true },
    { button: 1 },
    { pointerType: "touch" },
    { downTargetKey: null, upTargetKey: null },
  ]) {
    assert.equal(shouldActivatePointReadGesture({ ...click, ...patch }), false);
  }
});

test("hover feedback never replaces an active queued or speaking sentence", () => {
  const readyHover = {
    sessionActive: false,
    buttons: 0,
    policyEnabled: true,
    masterEnabled: true,
    ready: true,
  };
  assert.equal(shouldRenderPointReadHover(readyHover), true);
  assert.equal(shouldRenderPointReadHover({ ...readyHover, sessionActive: true }), false);
  assert.equal(shouldRenderPointReadHover({ ...readyHover, buttons: 1 }), false);
});
