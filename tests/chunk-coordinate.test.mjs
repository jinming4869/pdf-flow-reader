import test from "node:test";
import assert from "node:assert/strict";

import {
  bboxToTopLeft,
  enrichChunkCoordinates,
  normalizePageDimensions,
  relativeBbox,
} from "../chunk-coordinate.mjs";

test("normalizePageDimensions keeps valid page dimensions and coordinate system", () => {
  assert.deepEqual(normalizePageDimensions({ width: 600, height: 800, coordinateSystem: "pdf" }), {
    width: 600,
    height: 800,
    coordinateSystem: "pdf",
  });
  assert.equal(normalizePageDimensions({ width: 0, height: 800 }), null);
});

test("bboxToTopLeft converts PDF bottom-left y into top-left reading coordinates", () => {
  assert.deepEqual(
    bboxToTopLeft(
      { x: 40, y: 700, width: 120, height: 20 },
      { width: 600, height: 800, coordinateSystem: "pdf" },
    ),
    { x: 40, y: 80, width: 120, height: 20 },
  );
});

test("relativeBbox creates page-relative coordinates for future TTS picking", () => {
  assert.deepEqual(relativeBbox({ x: 60, y: 80, width: 120, height: 40 }, { width: 600, height: 800 }), {
    x: 0.1,
    y: 0.1,
    width: 0.2,
    height: 0.05,
  });
});

test("enrichChunkCoordinates stores reading and normalized bbox without losing source bbox", () => {
  const chunk = enrichChunkCoordinates(
    { text: "hello", bbox: { x: 50, y: 760, width: 100, height: 20 } },
    { pageDimensions: { width: 500, height: 1000, coordinateSystem: "pdf" } },
  );
  assert.deepEqual(chunk.bbox, { x: 50, y: 760, width: 100, height: 20 });
  assert.deepEqual(chunk.readingBbox, { x: 50, y: 220, width: 100, height: 20 });
  assert.equal(chunk.yStart, 220);
  assert.equal(chunk.yEnd, 240);
  assert.deepEqual(chunk.normalizedBbox, { x: 0.1, y: 0.22, width: 0.2, height: 0.02 });
});
