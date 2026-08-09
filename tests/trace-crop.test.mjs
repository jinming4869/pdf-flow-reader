import assert from "node:assert/strict";
import test from "node:test";

import {
  createLassoCropPlan,
  renderLassoCrop,
} from "../trace-crop.mjs";

const centeredSquare = [
  { x: 0.25, y: 0.25 },
  { x: 0.75, y: 0.25 },
  { x: 0.75, y: 0.75 },
  { x: 0.25, y: 0.75 },
];

test("crop plan converts normalized lasso bounds to padded source pixels", () => {
  const plan = createLassoCropPlan({
    normalizedPath: centeredSquare,
    sourceWidth: 2000,
    sourceHeight: 1000,
    padding: 20,
    maxPixels: 4_000_000,
  });

  assert.deepEqual(plan.source, {
    x: 480,
    y: 230,
    width: 1040,
    height: 540,
  });
  assert.deepEqual(plan.output, { width: 1040, height: 540, scale: 1 });
  assert.deepEqual(plan.normalizedBounds, {
    x: 0.25,
    y: 0.25,
    width: 0.5,
    height: 0.5,
  });
});

test("crop plan clamps context padding at page edges", () => {
  const plan = createLassoCropPlan({
    normalizedPath: [
      { x: 0, y: 0 },
      { x: 0.2, y: 0 },
      { x: 0.2, y: 0.2 },
      { x: 0, y: 0.2 },
    ],
    sourceWidth: 1000,
    sourceHeight: 500,
    padding: 50,
  });
  assert.deepEqual(plan.source, { x: 0, y: 0, width: 250, height: 150 });
});

test("crop plan respects a hard output pixel budget without changing source bounds", () => {
  const plan = createLassoCropPlan({
    normalizedPath: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    sourceWidth: 4000,
    sourceHeight: 4000,
    padding: 0,
    maxPixels: 4_000_000,
  });
  assert.deepEqual(plan.source, { x: 0, y: 0, width: 4000, height: 4000 });
  assert.deepEqual(plan.output, { width: 2000, height: 2000, scale: 0.5 });
});

test("default crop budget is the locally measured four million pixels", () => {
  const plan = createLassoCropPlan({
    normalizedPath: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    sourceWidth: 4000,
    sourceHeight: 4000,
    padding: 0,
  });
  assert.deepEqual(plan.output, { width: 2000, height: 2000, scale: 0.5 });
});

test("crop plan rejects invalid canvas dimensions and unusable paths", () => {
  assert.throws(() => createLassoCropPlan({
    normalizedPath: centeredSquare,
    sourceWidth: 0,
    sourceHeight: 1000,
  }), { code: "TRACE_CROP_INVALID" });
  assert.throws(() => createLassoCropPlan({
    normalizedPath: [{ x: 0.1, y: 0.1 }],
    sourceWidth: 1000,
    sourceHeight: 1000,
  }), { code: "TRACE_CROP_INVALID" });
});

test("renderer crop uses the planned source rectangle and releases its temporary canvas", async () => {
  const drawCalls = [];
  const temporary = {
    width: 1,
    height: 1,
    getContext() {
      return { drawImage(...args) { drawCalls.push(args); } };
    },
    toBlob(callback, mimeType) {
      callback(new Blob(["synthetic-png"], { type: mimeType }));
    },
  };
  const sourceCanvas = { width: 2000, height: 1000 };
  const result = await renderLassoCrop({
    sourceCanvas,
    normalizedPath: centeredSquare,
    padding: 20,
    canvasFactory: () => temporary,
  });

  assert.deepEqual(drawCalls[0], [
    sourceCanvas,
    480,
    230,
    1040,
    540,
    0,
    0,
    1040,
    540,
  ]);
  assert.equal(result.width, 1040);
  assert.equal(result.height, 540);
  assert.equal(result.byteLength, 13);
  assert.equal(result.mimeType, "image/png");
  assert.equal(temporary.width, 1);
  assert.equal(temporary.height, 1);
});

test("renderer crop honors an already aborted signal before allocating a canvas", async () => {
  const controller = new AbortController();
  controller.abort();
  let allocated = false;
  await assert.rejects(renderLassoCrop({
    sourceCanvas: { width: 2000, height: 1000 },
    normalizedPath: centeredSquare,
    signal: controller.signal,
    canvasFactory: () => {
      allocated = true;
      return null;
    },
  }), { name: "AbortError" });
  assert.equal(allocated, false);
});
