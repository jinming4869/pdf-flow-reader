import test from "node:test";
import assert from "node:assert/strict";
import {
  cacheBudgetForDeviceMemory,
  directionalPageOrder,
  RenderScheduler,
} from "../render-scheduler.mjs";

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("memory tiers and OCR reserve produce bounded page caches", () => {
  assert.equal(cacheBudgetForDeviceMemory(8).pages, 7);
  assert.equal(cacheBudgetForDeviceMemory(16).pages, 10);
  assert.equal(cacheBudgetForDeviceMemory(32).pages, 14);
  assert.equal(cacheBudgetForDeviceMemory(undefined).pages, 10);
  assert.equal(cacheBudgetForDeviceMemory(8, { ocrEnabled: true }).pages, 7);
  assert.equal(cacheBudgetForDeviceMemory(16, { ocrEnabled: true }).pages, 9);
});

test("directional order prioritizes current page and reading direction", () => {
  assert.deepEqual(directionalPageOrder(10, 1, 30, 7), [10, 11, 9, 12, 8, 13, 14]);
  assert.deepEqual(directionalPageOrder(10, -1, 30, 5), [10, 9, 11, 8, 12]);
  assert.deepEqual(directionalPageOrder(1, -1, 4, 4), [1, 2, 3, 4]);
});

test("a nearby page change pre-empts prefetch work for the new current page", async () => {
  const started = [];
  const scheduler = new RenderScheduler({
    budget: { pages: 7, pixels: 100 },
    render: (pageNumber, { signal }) => new Promise((resolve, reject) => {
      started.push(pageNumber);
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
  });

  scheduler.updateView({ currentPage: 5, direction: 1, pageCount: 20 });
  await tick();
  assert.deepEqual(started, [5, 6]);

  scheduler.updateView({ currentPage: 7, direction: 1, pageCount: 20 });
  await tick();
  await tick();
  assert.ok(started.includes(7));
  assert.equal(scheduler.snapshot().render.cancelled, 1);
  scheduler.destroy();
});

test("scheduler caps concurrency at two and starts the current page first", async () => {
  const started = [];
  const releases = new Map();
  const scheduler = new RenderScheduler({
    budget: { pages: 4, pixels: 100 },
    render: (pageNumber) => new Promise((resolve) => {
      started.push(pageNumber);
      releases.set(pageNumber, () => resolve({ pixels: 10, quality: "2x" }));
    }),
  });

  scheduler.updateView({ currentPage: 5, direction: 1, pageCount: 20 });
  await tick();
  assert.deepEqual(started, [5, 6]);
  assert.equal(scheduler.snapshot().running.length, 2);
  releases.get(5)();
  await tick();
  await tick();
  assert.deepEqual(started, [5, 6, 4]);
  scheduler.destroy();
});

test("jumping pages cancels old work and schedules the new target", async () => {
  const started = [];
  const scheduler = new RenderScheduler({
    budget: { pages: 3, pixels: 100 },
    render: (pageNumber, { signal }) => new Promise((resolve, reject) => {
      started.push(pageNumber);
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
  });

  scheduler.updateView({ currentPage: 2, direction: 1, pageCount: 50 });
  await tick();
  scheduler.updateView({ currentPage: 40, direction: 1, pageCount: 50 });
  await tick();
  assert.ok(started.includes(40));
  assert.equal(scheduler.snapshot().render.cancelled, 2);
  assert.deepEqual(scheduler.snapshot().hot.slice(0, 2), [40, 41]);
  scheduler.destroy();
});

test("returning before cancelled work settles requeues the page", async () => {
  const started = [];
  const scheduler = new RenderScheduler({
    budget: { pages: 3, pixels: 100 },
    render: (pageNumber, { signal }) => new Promise((resolve, reject) => {
      started.push(pageNumber);
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
  });

  scheduler.updateView({ currentPage: 2, direction: 1, pageCount: 50 });
  await tick();
  scheduler.updateView({ currentPage: 40, direction: 1, pageCount: 50 });
  scheduler.updateView({ currentPage: 2, direction: -1, pageCount: 50 });
  await tick();
  await tick();

  assert.equal(started.filter((pageNumber) => pageNumber === 2).length, 2);
  assert.ok(scheduler.snapshot().running.includes(2));
  scheduler.destroy();
});

test("pixel budget evicts distant canvases while keeping current page", async () => {
  const disposed = [];
  const scheduler = new RenderScheduler({
    budget: { pages: 4, pixels: 25 },
    render: async (pageNumber) => ({
      pixels: 10,
      quality: "2x",
      dispose: () => disposed.push(pageNumber),
    }),
  });

  scheduler.updateView({ currentPage: 10, direction: 1, pageCount: 30 });
  for (let index = 0; index < 8; index += 1) await tick();
  const snapshot = scheduler.snapshot();
  assert.ok(snapshot.canvas.pixels <= 25 || snapshot.canvas.count === 1);
  assert.equal(snapshot.currentQuality, "2x");
  assert.ok(disposed.length >= 1);
  scheduler.destroy();
});
