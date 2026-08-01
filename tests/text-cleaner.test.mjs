import test from "node:test";
import assert from "node:assert/strict";

import {
  cleanReadableLine,
  isLikelyRunningHeader,
  normalizePdfArtifacts,
  repeatedLineKeys,
  replaceLigatures,
} from "../text-cleaner.mjs";

test("replaceLigatures normalizes PDF typography for TTS", () => {
  assert.equal(replaceLigatures("deﬁne and ﬂow"), "define and flow");
});

test("normalizePdfArtifacts repairs common Goertz-style extraction artifacts", () => {
  const input = "October 20, 2005 14:31 nec100 Sheet number 17 Page number 3 democ- racy and Goertz’ s concept.";
  assert.equal(normalizePdfArtifacts(input), "democracy and Goertz’s concept.");
});

test("repeatedLineKeys helps filter running headers across pages", () => {
  const repeated = repeatedLineKeys([
    ["CHAPTER ONE", "The first body line"],
    ["CHAPTER ONE", "Another body line"],
    ["INTRODUCTION", "A third body line"],
  ]);
  assert.equal(isLikelyRunningHeader("CHAPTER ONE", { repeatedLines: repeated }), true);
  assert.equal(isLikelyRunningHeader("The first body line", { repeatedLines: repeated }), false);
});

test("cleanReadableLine removes ornamental and spacing noise conservatively", () => {
  assert.equal(cleanReadableLine("  This is a sentence , with spacing .  "), "This is a sentence, with spacing.");
});
