import assert from "node:assert/strict";
import test from "node:test";

import {
  lassoBounds,
  normalizePointerToPage,
  prepareLassoPath,
  sampleLassoPoint,
  selectLassoText,
} from "../lasso-geometry.mjs";

test("pointer coordinates map into the page and reject points outside it", () => {
  const rectangle = { left: 100, top: 200, width: 400, height: 800 };
  assert.deepEqual(normalizePointerToPage({ clientX: 300, clientY: 600, rectangle }), {
    x: 0.5,
    y: 0.5,
  });
  assert.equal(normalizePointerToPage({ clientX: 99, clientY: 600, rectangle }), null);
  assert.equal(normalizePointerToPage({ clientX: 300, clientY: 1001, rectangle }), null);
});

test("sampling rejects near-duplicate points and respects a hard point budget", () => {
  let points = [];
  points = sampleLassoPoint(points, { x: 0.1, y: 0.1 }, { minDistance: 0.05, maxPoints: 3 });
  const unchanged = sampleLassoPoint(points, { x: 0.11, y: 0.11 }, {
    minDistance: 0.05,
    maxPoints: 3,
  });
  assert.equal(unchanged, points);
  points = sampleLassoPoint(points, { x: 0.3, y: 0.1 }, { minDistance: 0.05, maxPoints: 3 });
  points = sampleLassoPoint(points, { x: 0.3, y: 0.4 }, { minDistance: 0.05, maxPoints: 3 });
  const capped = sampleLassoPoint(points, { x: 0.7, y: 0.7 }, {
    minDistance: 0.05,
    maxPoints: 3,
  });
  assert.equal(capped, points);
  assert.equal(points.length, 3);
});

test("path preparation simplifies and smooths a usable normalized lasso", () => {
  const raw = [
    { x: 0.1, y: 0.1 },
    { x: 0.3, y: 0.1 },
    { x: 0.6, y: 0.1 },
    { x: 0.9, y: 0.1 },
    { x: 0.9, y: 0.5 },
    { x: 0.9, y: 0.9 },
    { x: 0.5, y: 0.9 },
    { x: 0.1, y: 0.9 },
    { x: 0.1, y: 0.5 },
  ];
  const prepared = prepareLassoPath(raw, {
    simplifyTolerance: 0.005,
    smoothingIterations: 1,
    minArea: 0.01,
  });

  assert.equal(prepared.valid, true);
  assert.equal(prepared.reason, null);
  assert.ok(prepared.path.length >= 4);
  assert.ok(prepared.path.every((point) => (
    point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1
  )));
  assert.ok(prepared.area > 0.5);
  assert.deepEqual(lassoBounds(prepared.path), prepared.bounds);
});

test("tiny and malformed lassos are rejected without inventing a region", () => {
  assert.deepEqual(prepareLassoPath([{ x: 0.1, y: 0.1 }]), {
    valid: false,
    reason: "not-enough-points",
    path: [],
    bounds: null,
    area: 0,
  });
  const tiny = prepareLassoPath([
    { x: 0.1, y: 0.1 },
    { x: 0.101, y: 0.1 },
    { x: 0.101, y: 0.101 },
  ], { minArea: 0.001 });
  assert.equal(tiny.valid, false);
  assert.equal(tiny.reason, "area-too-small");
});

test("lasso text picking does not jump across a two-column gutter", () => {
  const lasso = [
    { x: 0.05, y: 0.1 },
    { x: 0.47, y: 0.1 },
    { x: 0.47, y: 0.8 },
    { x: 0.05, y: 0.8 },
  ];
  const chunks = [
    {
      key: "left-a",
      text: "Left column first sentence.",
      source: "native-text",
      normalizedBbox: { x: 0.1, y: 0.2, width: 0.3, height: 0.08 },
    },
    {
      key: "right-a",
      text: "Right column should stay out.",
      source: "native-text",
      normalizedBbox: { x: 0.58, y: 0.2, width: 0.3, height: 0.08 },
    },
    {
      key: "left-b",
      text: "左栏第二句。",
      source: "ocr",
      normalizedBbox: { x: 0.1, y: 0.5, width: 0.3, height: 0.08 },
    },
  ];

  const selected = selectLassoText(chunks, lasso);
  assert.deepEqual(selected.chunks.map((chunk) => chunk.key), ["left-a", "left-b"]);
  assert.equal(selected.text, "Left column first sentence.\n左栏第二句。");
  assert.equal(selected.provenance, "mixed");
});
