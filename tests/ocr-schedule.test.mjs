import test from "node:test";
import assert from "node:assert/strict";

import {
  continuousOcrAheadPage,
  createOcrTaskScheduler,
  ocrTaskKey,
} from "../ocr-schedule.mjs";

function fakeTimers() {
  let sequence = 0;
  const timers = new Map();
  return {
    setTimeoutFn(callback) {
      sequence += 1;
      timers.set(sequence, callback);
      return sequence;
    },
    clearTimeoutFn(id) {
      timers.delete(id);
    },
    runNext() {
      const entry = timers.entries().next().value;
      if (!entry) return false;
      const [id, callback] = entry;
      timers.delete(id);
      callback();
      return true;
    },
    get size() {
      return timers.size;
    },
    get created() {
      return sequence;
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("snow-mist advances OCR one page ahead only when that page still needs first recognition", () => {
  const base = {
    enabled: true,
    tierKey: "snow-mist",
    isPlaying: true,
    workloadActive: false,
    currentPage: 102,
    pageCount: 584,
    nextPageNativeKnown: true,
    nextPageTtsReady: false,
    nextPageOcrKnown: false,
    nextPageFailed: false,
  };
  assert.equal(continuousOcrAheadPage(base), 103);
  assert.equal(continuousOcrAheadPage({ ...base, tierKey: "aesthetic-walk" }), null);
  assert.equal(continuousOcrAheadPage({ ...base, enabled: false }), null);
  assert.equal(continuousOcrAheadPage({ ...base, isPlaying: false }), null);
  assert.equal(continuousOcrAheadPage({ ...base, workloadActive: true }), null);
  assert.equal(continuousOcrAheadPage({ ...base, nextPageNativeKnown: false }), null);
  assert.equal(continuousOcrAheadPage({ ...base, nextPageTtsReady: true }), null);
  assert.equal(continuousOcrAheadPage({ ...base, nextPageOcrKnown: true }), null);
  assert.equal(continuousOcrAheadPage({ ...base, nextPageFailed: true }), null);
  assert.equal(continuousOcrAheadPage({ ...base, currentPage: 584 }), null);
});

test("same OCR page ticks reuse one pending debounce instead of starving it", async () => {
  const timers = fakeTimers();
  const runs = [];
  const scheduler = createOcrTaskScheduler({
    delayMs: 180,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    onReady: async (task) => runs.push(task),
  });
  const task = { centerPage: 23, priorityPage: 23, generation: 7, request: 1 };

  const first = scheduler.schedule(task);
  for (let tick = 0; tick < 8; tick += 1) {
    const repeated = scheduler.schedule({ ...task, request: tick + 2 });
    assert.equal(repeated.reused, true);
  }

  assert.equal(first.scheduled, true);
  assert.equal(timers.size, 1);
  assert.equal(scheduler.snapshot().pendingKey, ocrTaskKey(task));
  timers.runNext();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(runs.length, 1);
  assert.equal(runs[0].request, 1);
});

test("a new OCR page replaces pending work and only the latest page runs", async () => {
  const timers = fakeTimers();
  const runs = [];
  const scheduler = createOcrTaskScheduler({
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    onReady: async (task) => runs.push(task.centerPage),
  });

  scheduler.schedule({ centerPage: 1, priorityPage: 1, generation: 2, request: 1 });
  scheduler.schedule({ centerPage: 100, priorityPage: 100, generation: 2, request: 2 });

  assert.equal(timers.size, 1);
  assert.equal(timers.created, 1);
  timers.runNext();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(runs, [100]);
});

test("ticks reuse the active OCR task until its promise settles", async () => {
  const timers = fakeTimers();
  const run = deferred();
  const scheduler = createOcrTaskScheduler({
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    onReady: () => run.promise,
  });
  const task = { centerPage: 8, priorityPage: 8, generation: 3, request: 1 };

  scheduler.schedule(task);
  timers.runNext();
  await Promise.resolve();
  assert.equal(scheduler.snapshot().activeKey, ocrTaskKey(task));
  assert.equal(scheduler.schedule({ ...task, request: 2 }).reused, true);
  assert.equal(timers.size, 0);

  run.resolve();
  await run.promise;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(scheduler.snapshot().activeKey, null);
});

test("the latest page wins when scheduling moves active A → pending B → A", async () => {
  const timers = fakeTimers();
  const active = deferred();
  const runs = [];
  const scheduler = createOcrTaskScheduler({
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    onReady: (task) => {
      runs.push(task.centerPage);
      return runs.length === 1 ? active.promise : Promise.resolve();
    },
  });

  scheduler.schedule({ centerPage: 4, priorityPage: 4, generation: 1, request: 1 });
  timers.runNext();
  await Promise.resolve();
  scheduler.schedule({ centerPage: 9, priorityPage: 9, generation: 1, request: 2 });
  scheduler.schedule({ centerPage: 4, priorityPage: 4, generation: 1, request: 3 });
  timers.runNext();
  await Promise.resolve();

  assert.deepEqual(runs, [4, 4]);
  active.resolve();
});

test("cancelling OCR pending work prevents it from running", async () => {
  const timers = fakeTimers();
  let runs = 0;
  const scheduler = createOcrTaskScheduler({
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    onReady: async () => {
      runs += 1;
    },
  });

  scheduler.schedule({ centerPage: 4, priorityPage: 4, generation: 1, request: 1 });
  scheduler.cancel("document-cleared");
  assert.equal(timers.size, 0);
  assert.equal(scheduler.snapshot().pendingKey, null);
  assert.equal(runs, 0);
});
