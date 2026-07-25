import test from "node:test";
import assert from "node:assert/strict";

import {
  clampVolume,
  createCueNotes,
  cueDirection,
  cueSampleName,
  transitionSteps,
} from "../sound-engine.mjs";

test("cueDirection distinguishes upward and downward tier changes", () => {
  assert.equal(cueDirection(1, 3), "up");
  assert.equal(cueDirection(4, 2), "down");
  assert.equal(cueDirection(2, 2), "same");
});

test("transitionSteps expands a cross-tier gesture into boundary samples", () => {
  assert.deepEqual(
    transitionSteps(1, 4).map((step) => cueSampleName(step)),
    ["up-2", "up-3", "up-4"],
  );
  assert.deepEqual(
    transitionSteps(5, 3).map((step) => cueSampleName(step)),
    ["down-5", "down-4"],
  );
});

test("createCueNotes returns no notes for the same tier", () => {
  assert.deepEqual(createCueNotes(2, 2), []);
});

test("createCueNotes creates an ascending synth fallback for speed-up", () => {
  const notes = createCueNotes(1, 4);
  assert.equal(notes.length, 4);
  assert.ok(notes[0].frequency < notes.at(-1).frequency);
  assert.deepEqual(notes.map((note) => note.offsetMs), [0, 92, 184, 276]);
});

test("createCueNotes creates a descending synth fallback for slow-down", () => {
  const notes = createCueNotes(5, 3);
  assert.equal(notes.length, 3);
  assert.ok(notes[0].frequency > notes.at(-1).frequency);
});

test("clampVolume keeps sound cue volume bounded", () => {
  assert.equal(clampVolume(-1), 0);
  assert.equal(clampVolume(2), 1);
  assert.equal(clampVolume(0.4), 0.4);
});
