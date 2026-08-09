import assert from "node:assert/strict";
import test from "node:test";

import {
  emotionFromPadPoint,
  emotionMarkerPosition,
  moveEmotionCoordinate,
  nearbyEmotionWords,
  normalizeEmotionCoordinate,
} from "../emotion-coordinate.mjs";

test("pad coordinates map valence left-to-right and arousal bottom-to-top", () => {
  const rectangle = { left: 100, top: 200, width: 400, height: 200 };
  assert.deepEqual(emotionFromPadPoint({
    clientX: 400,
    clientY: 250,
    rectangle,
  }), { valence: 0.5, arousal: 0.5 });
  assert.deepEqual(emotionFromPadPoint({
    clientX: 100,
    clientY: 400,
    rectangle,
  }), { valence: -1, arousal: -1 });
  assert.equal(emotionFromPadPoint({
    clientX: 99,
    clientY: 300,
    rectangle,
  }), null);
});

test("normalization clamps values and stores stable three-decimal facts", () => {
  assert.deepEqual(normalizeEmotionCoordinate({ valence: 1.4, arousal: -2 }), {
    valence: 1,
    arousal: -1,
  });
  assert.deepEqual(normalizeEmotionCoordinate({ valence: 0.12349, arousal: -0.55555 }), {
    valence: 0.123,
    arousal: -0.556,
  });
});

test("keyboard movement never stores center unless the user explicitly chooses it", () => {
  assert.deepEqual(moveEmotionCoordinate(null, "ArrowRight"), {
    valence: 0.05,
    arousal: 0,
  });
  assert.deepEqual(moveEmotionCoordinate(null, "ArrowUp", { shiftKey: true }), {
    valence: 0,
    arousal: 0.2,
  });
  assert.deepEqual(moveEmotionCoordinate({ valence: 0.98, arousal: -0.98 }, "ArrowRight"), {
    valence: 1,
    arousal: -0.98,
  });
  assert.equal(moveEmotionCoordinate(null, "Enter"), null);
});

test("marker position converts emotional facts back to pad percentages", () => {
  assert.deepEqual(emotionMarkerPosition({ valence: 0.5, arousal: 0.5 }), {
    leftPercent: 75,
    topPercent: 25,
  });
  assert.deepEqual(emotionMarkerPosition({ valence: -1, arousal: -1 }), {
    leftPercent: 0,
    topPercent: 100,
  });
});

test("nearby words interpret a coordinate without becoming the stored value", () => {
  assert.deepEqual(nearbyEmotionWords({ valence: 0.8, arousal: 0.8 }), ["振奋", "惊喜", "兴奋"]);
  assert.deepEqual(nearbyEmotionWords({ valence: -0.8, arousal: 0.8 }), ["不安", "愤怒", "紧张"]);
  assert.deepEqual(nearbyEmotionWords({ valence: 0.8, arousal: -0.8 }), ["安宁", "满足", "舒缓"]);
  assert.deepEqual(nearbyEmotionWords({ valence: -0.8, arousal: -0.8 }), ["低落", "疲惫", "疏离"]);
  assert.deepEqual(nearbyEmotionWords({ valence: 0.02, arousal: 0.01 }), ["难以命名", "复杂", "平静"]);
});
