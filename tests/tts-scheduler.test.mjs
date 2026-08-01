import test from "node:test";
import assert from "node:assert/strict";

import { createNullTtsProvider } from "../tts-provider.mjs";
import { createTtsScheduler, trimTextForSpeech } from "../tts-scheduler.mjs";

function chunk(chunkIndex, y, text = `chunk ${chunkIndex}`) {
  return {
    source: "native-text",
    pageIndex: 0,
    chunkIndex,
    text,
    languageHint: "latin",
    role: "body",
    priority: 1,
    normalizedBbox: { x: 0.1, y, width: 0.8, height: 0.08 },
  };
}

test("createNullTtsProvider simulates synthesis without audio", async () => {
  const provider = createNullTtsProvider();
  const result = await provider.synthesize({ text: "hello" });
  assert.equal(result.audioBuffer, null);
  assert.equal(result.providerMeta.skipped, true);
  assert.equal(result.providerMeta.textLength, 5);
});

test("trimTextForSpeech keeps chunks whole except first-sentence mode", () => {
  const text = "This is the first sentence that should be read. This second sentence belongs to the same readable chunk.";
  assert.equal(trimTextForSpeech(text, { mode: "flow", tierKey: "long-day" }), text);
  assert.equal(
    trimTextForSpeech(text, { mode: "flow", tierKey: "winding-stream", firstSentenceOnly: true }),
    "This is the first sentence that should be read.",
  );
  assert.equal(trimTextForSpeech("  A   spaced   sentence.  "), "A spaced sentence.");
});

test("trimTextForSpeech uses CJK sentence endings without requiring whitespace", () => {
  assert.equal(
    trimTextForSpeech("第一句。第二句。", { firstSentenceOnly: true }),
    "第一句。",
  );
  assert.equal(
    trimTextForSpeech("最初の文です。次の文です。", { firstSentenceOnly: true }),
    "最初の文です。",
  );
});

test("createTtsScheduler queues a picked chunk, returns result and records diagnostics", async () => {
  const picks = [];
  const results = [];
  const seen = [];
  const provider = {
    ...createNullTtsProvider(),
    async synthesize(input) {
      seen.push(input);
      return createNullTtsProvider().synthesize(input);
    },
  };
  const scheduler = createTtsScheduler({ provider, onPick: (event) => picks.push(event), onResult: (event) => results.push(event) });
  const pick = await scheduler.update({
    isPlaying: true,
    chunks: [chunk(1, 0.36, "Concepts are theories about ontology.")],
    normalizedReadingY: 0.38,
    pageNumber: 1,
    speech: { mode: "flow", tierKey: "winding-stream", speed: 1.12 },
  });
  assert.equal(pick.key, "native-text:0:1");
  assert.equal(pick.result.providerMeta.skipped, true);
  assert.equal(picks.length, 1);
  assert.equal(picks[0].speech.speed, 1.12);
  assert.equal(results.length, 1);
  assert.equal(results[0].pick.key, "native-text:0:1");
  assert.equal(seen[0].speed, 1.12);
  const snapshot = scheduler.snapshot();
  assert.equal(snapshot.status, "simulated");
  assert.equal(snapshot.queued, 1);
  assert.equal(snapshot.completed, 1);
  assert.equal(snapshot.lastPick.text, "Concepts are theories about ontology.");
  assert.equal(snapshot.lastSpeech.speed, 1.12);
});

test("aesthetic-walk synthesis uses the planned text and dynamic speed", async () => {
  const seen = [];
  const provider = {
    ...createNullTtsProvider(),
    async synthesize(input) {
      seen.push(input);
      return createNullTtsProvider().synthesize(input);
    },
  };
  const scheduler = createTtsScheduler({ provider, now: () => 1_000 });
  const planned = chunk(1, 0.36, "First sentence. A later sentence.");
  planned.utterancePlan = {
    kind: "aesthetic-walk",
    decision: "shortened",
    text: "First sentence.",
    speed: 2.15,
    latestStartAtMs: 2_000,
  };
  const result = await scheduler.update({
    isPlaying: true,
    chunks: [planned],
    normalizedReadingY: 0.38,
    speech: { tierKey: "aesthetic-walk", speed: 1.5 },
  });
  assert.ok(result?.chunk);
  assert.equal(seen[0].text, "First sentence.");
  assert.equal(seen[0].speed, 2.15);
  assert.equal(scheduler.snapshot().lastSpeech.utterancePlan.decision, "shortened");
});

test("aesthetic-walk drops a synthesis result that misses its latest start", async () => {
  let resolveSynthesis;
  let currentNow = 1_000;
  const results = [];
  const provider = {
    ...createNullTtsProvider(),
    synthesize() {
      return new Promise((resolve) => {
        resolveSynthesis = resolve;
      });
    },
  };
  const scheduler = createTtsScheduler({
    provider,
    now: () => currentNow,
    onResult: (event) => results.push(event),
  });
  const planned = chunk(1, 0.36, "A sentence that is still in view.");
  planned.utterancePlan = {
    kind: "aesthetic-walk",
    decision: "full",
    text: planned.text,
    speed: 2,
    latestStartAtMs: 1_500,
  };
  const pending = scheduler.update({
    isPlaying: true,
    chunks: [planned],
    normalizedReadingY: 0.38,
    speech: { tierKey: "aesthetic-walk", speed: 2 },
  });
  await Promise.resolve();
  currentNow = 1_700;
  resolveSynthesis(await createNullTtsProvider().synthesize({ text: planned.text }));
  const skipped = await pending;
  assert.equal(skipped.status, "late-skip");
  assert.equal(skipped.skipped, true);
  assert.equal(results.length, 0);
  assert.equal(scheduler.snapshot().playbackLocked, false);
  assert.equal(scheduler.snapshot().status, "late-skip");
});

test("aesthetic-walk prefetch keeps the next chunk's own plan", async () => {
  const seen = [];
  const provider = {
    ...createNullTtsProvider(),
    async synthesize(input) {
      seen.push({ text: input.text, speed: input.speed });
      return createNullTtsProvider().synthesize(input);
    },
  };
  const scheduler = createTtsScheduler({ provider, now: () => 1_000 });
  const first = chunk(1, 0.2, "First chunk.");
  first.utterancePlan = {
    kind: "aesthetic-walk",
    decision: "full",
    text: first.text,
    speed: 1.6,
    latestStartAtMs: 4_000,
  };
  const second = chunk(2, 0.31, "Second sentence. More words.");
  second.utterancePlan = {
    kind: "aesthetic-walk",
    decision: "shortened",
    text: "Second sentence.",
    speed: 2.3,
    latestStartAtMs: 5_000,
  };
  await scheduler.update({
    isPlaying: true,
    chunks: [first, second],
    normalizedReadingY: 0.21,
    speech: {
      tierKey: "aesthetic-walk",
      speed: 1.5,
      prefetchNext: true,
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(seen, [
    { text: "First chunk.", speed: 1.6 },
    { text: "Second sentence.", speed: 2.3 },
  ]);
});

test("aesthetic-walk discards a prefetched plan after the visual rate changes", async () => {
  const seen = [];
  const provider = {
    ...createNullTtsProvider(),
    async synthesize(input) {
      seen.push({ text: input.text, speed: input.speed });
      return createNullTtsProvider().synthesize(input);
    },
  };
  const scheduler = createTtsScheduler({ provider, now: () => 1_000 });
  const first = chunk(1, 0.2, "First chunk.");
  first.utterancePlan = {
    kind: "aesthetic-walk",
    decision: "full",
    text: first.text,
    speed: 1.5,
    latestStartAtMs: 4_000,
  };
  const second = chunk(2, 0.31, "Second sentence. More words.");
  second.utterancePlan = {
    kind: "aesthetic-walk",
    decision: "full",
    text: second.text,
    speed: 1.6,
    latestStartAtMs: 5_000,
  };
  await scheduler.update({
    isPlaying: true,
    chunks: [first, second],
    normalizedReadingY: 0.21,
    speech: { tierKey: "aesthetic-walk", speed: 1.5, prefetchNext: true },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  scheduler.releasePlaybackLock();
  const fasterSecond = {
    ...second,
    utterancePlan: {
      ...second.utterancePlan,
      decision: "shortened",
      text: "Second sentence.",
      speed: 2.35,
      latestStartAtMs: 3_000,
    },
  };
  await scheduler.update({
    isPlaying: true,
    chunks: [first, fasterSecond],
    normalizedReadingY: 0.32,
    speech: { tierKey: "aesthetic-walk", speed: 2.35, prefetchNext: true },
  });

  assert.deepEqual(seen, [
    { text: "First chunk.", speed: 1.5 },
    { text: "Second sentence. More words.", speed: 1.6 },
    { text: "Second sentence.", speed: 2.35 },
  ]);
  assert.equal(scheduler.snapshot().lastSpeech.speed, 2.35);
  assert.equal(scheduler.snapshot().prefetchUsed, 0);
});

test("createTtsScheduler prefetches and reuses the next chunk in continuous mode", async () => {
  const calls = [];
  const provider = {
    id: "fake",
    name: "Fake",
    mode: "local",
    async synthesize(input) {
      calls.push(input.text);
      return createNullTtsProvider().synthesize(input);
    },
    cancel() {},
  };
  const scheduler = createTtsScheduler({ provider });
  const chunks = [chunk(1, 0.2, "First chunk."), chunk(2, 0.31, "Second chunk.")];
  await scheduler.update({
    isPlaying: true,
    chunks,
    normalizedReadingY: 0.21,
    speech: { mode: "flow", tierKey: "snow-mist", speed: 1.18, prefetchNext: true },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(scheduler.snapshot().prefetch?.ready, true);
  scheduler.releasePlaybackLock();
  await scheduler.update({
    isPlaying: true,
    chunks,
    normalizedReadingY: 0.32,
    speech: { mode: "flow", tierKey: "snow-mist", speed: 1.18, prefetchNext: true },
  });
  assert.equal(scheduler.snapshot().prefetchUsed, 1);
  assert.ok(calls.includes("Second chunk."));
});

test("continuous prefetch crosses a page without letting the next page win current picking", async () => {
  const calls = [];
  const provider = {
    ...createNullTtsProvider(),
    async synthesize(input) {
      calls.push({ text: input.text, pageNumber: input.pageNumber });
      return createNullTtsProvider().synthesize(input);
    },
  };
  const scheduler = createTtsScheduler({ provider });
  const pageOne = chunk(9, 0.9, "Last chunk on page one.");
  const pageTwo = {
    ...chunk(0, 0.1, "First chunk on page two."),
    pageIndex: 1,
  };
  const first = await scheduler.update({
    isPlaying: true,
    chunks: [pageOne],
    prefetchChunks: [pageTwo],
    normalizedReadingY: 0.9,
    speech: { tierKey: "snow-mist", speed: 1.18, prefetchNext: true },
  });
  assert.equal(first.chunk.text, pageOne.text);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(scheduler.snapshot().prefetch?.key, "native-text:1:0");

  scheduler.releasePlaybackLock();
  const second = await scheduler.update({
    isPlaying: true,
    chunks: [pageTwo],
    normalizedReadingY: 0.1,
    pageNumber: 2,
    speech: { tierKey: "snow-mist", speed: 1.18, prefetchNext: true },
  });
  assert.equal(second.chunk.text, pageTwo.text);
  assert.equal(scheduler.snapshot().prefetchUsed, 1);
  assert.deepEqual(calls, [
    { text: pageOne.text, pageNumber: 0 },
    { text: pageTwo.text, pageNumber: 2 },
  ]);
});

test("cross-page continuous prefetch is discarded when the selected text changes", async () => {
  const calls = [];
  const provider = {
    ...createNullTtsProvider(),
    async synthesize(input) {
      calls.push(input.text);
      return createNullTtsProvider().synthesize(input);
    },
  };
  const scheduler = createTtsScheduler({ provider });
  const pageOne = chunk(9, 0.9, "Last chunk on page one.");
  const stalePageTwo = {
    ...chunk(0, 0.1, "Uncorrected OCR sentence."),
    pageIndex: 1,
  };
  await scheduler.update({
    isPlaying: true,
    chunks: [pageOne],
    prefetchChunks: [stalePageTwo],
    normalizedReadingY: 0.9,
    speech: { tierKey: "snow-mist", speed: 1.18, prefetchNext: true },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  scheduler.releasePlaybackLock();

  const correctedPageTwo = {
    ...stalePageTwo,
    text: "Corrected native sentence.",
  };
  const result = await scheduler.update({
    isPlaying: true,
    chunks: [correctedPageTwo],
    normalizedReadingY: 0.1,
    pageNumber: 2,
    speech: { tierKey: "snow-mist", speed: 1.18, prefetchNext: true },
  });
  assert.equal(result.chunk.text, correctedPageTwo.text);
  assert.deepEqual(calls, [pageOne.text, stalePageTwo.text, correctedPageTwo.text]);
  assert.equal(scheduler.snapshot().prefetchUsed, 0);
});

test("continuous prefetch stays single-shot across forty adjacent page transitions", async () => {
  const calls = [];
  const provider = {
    ...createNullTtsProvider(),
    async synthesize(input) {
      calls.push(input.text);
      return createNullTtsProvider().synthesize(input);
    },
  };
  const scheduler = createTtsScheduler({ provider });
  const pages = Array.from({ length: 40 }, (_, pageIndex) => ({
    ...chunk(0, 0.2, `Page ${pageIndex + 1} opening sentence.`),
    pageIndex,
  }));

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const result = await scheduler.update({
      isPlaying: true,
      chunks: [pages[pageIndex]],
      prefetchChunks: pages[pageIndex + 1] ? [pages[pageIndex + 1]] : [],
      normalizedReadingY: 0.2,
      pageNumber: pageIndex + 1,
      speech: { tierKey: "snow-mist", speed: 1.18, prefetchNext: true },
    });
    assert.equal(result.chunk.text, pages[pageIndex].text);
    await new Promise((resolve) => setTimeout(resolve, 0));
    scheduler.releasePlaybackLock();
  }

  assert.equal(calls.length, pages.length);
  assert.deepEqual(calls, pages.map((entry) => entry.text));
  assert.equal(scheduler.snapshot().prefetchUsed, pages.length - 1);
  assert.equal(scheduler.snapshot().failed, 0);
});

test("cancelling while awaiting prefetch cannot restart synthesis for the old page", async () => {
  let resolvePrefetch;
  const calls = [];
  const provider = {
    id: "delayed-prefetch",
    name: "Delayed prefetch",
    mode: "local",
    synthesize(input) {
      calls.push(input.text);
      if (calls.length === 2) {
        return new Promise((resolve) => {
          resolvePrefetch = resolve;
        });
      }
      return createNullTtsProvider().synthesize(input);
    },
    cancel() {},
  };
  const scheduler = createTtsScheduler({ provider });
  const chunks = [chunk(1, 0.2, "First chunk."), chunk(2, 0.31, "Second chunk.")];
  const speech = {
    mode: "flow",
    tierKey: "snow-mist",
    speed: 1.18,
    prefetchNext: true,
  };

  await scheduler.update({
    isPlaying: true,
    chunks,
    normalizedReadingY: 0.21,
    pageNumber: 1,
    speech,
  });
  scheduler.releasePlaybackLock();
  const waiting = scheduler.update({
    isPlaying: true,
    chunks,
    normalizedReadingY: 0.32,
    pageNumber: 1,
    speech,
  });
  await Promise.resolve();
  scheduler.cancel("page-changed");
  resolvePrefetch(await createNullTtsProvider().synthesize({ text: "prefetched old page" }));

  assert.equal(await waiting, null);
  assert.deepEqual(calls, ["First chunk.", "Second chunk."]);
  assert.equal(scheduler.snapshot().status, "page-changed");
});

test("a cancelled continuous prefetch cannot clear a newer slot with the same key", async () => {
  const delayed = [];
  const provider = {
    id: "stubborn-prefetch",
    name: "Stubborn prefetch",
    mode: "local",
    synthesize(input) {
      if (input.speech?.prefetched) {
        return new Promise((resolve, reject) => {
          delayed.push({ input, resolve, reject });
        });
      }
      return createNullTtsProvider().synthesize(input);
    },
    cancel() {},
  };
  const scheduler = createTtsScheduler({ provider });
  const chunks = [chunk(1, 0.2, "First chunk."), chunk(2, 0.31, "Second chunk.")];
  const speech = {
    mode: "flow",
    tierKey: "snow-mist",
    speed: 1.18,
    prefetchNext: true,
  };

  await scheduler.update({
    isPlaying: true,
    chunks,
    normalizedReadingY: 0.21,
    speech,
  });
  await Promise.resolve();
  assert.equal(delayed.length, 1);
  scheduler.cancel("page-changed");
  scheduler.releasePlaybackLock();

  await scheduler.update({
    isPlaying: true,
    chunks,
    normalizedReadingY: 0.21,
    speech: { ...speech, manual: true },
  });
  await Promise.resolve();
  assert.equal(delayed.length, 2);
  const newerSlot = scheduler.snapshot().prefetch;

  delayed[0].reject(new Error("old request ignored abort"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(scheduler.snapshot().prefetch, newerSlot);

  delayed[1].resolve(await createNullTtsProvider().synthesize({ text: "new prefetch" }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(scheduler.snapshot().prefetch?.ready, true);
});

test("createTtsScheduler locks the current utterance until playback is released", async () => {
  const scheduler = createTtsScheduler({ provider: createNullTtsProvider() });
  await scheduler.update({ isPlaying: true, chunks: [chunk(1, 0.36)], normalizedReadingY: 0.38 });
  await scheduler.update({ isPlaying: true, chunks: [chunk(2, 0.42)], normalizedReadingY: 0.43 });
  let snapshot = scheduler.snapshot();
  assert.equal(snapshot.status, "holding-current-utterance");
  assert.equal(snapshot.queued, 1);
  scheduler.releasePlaybackLock();
  await scheduler.update({ isPlaying: true, chunks: [chunk(2, 0.42)], normalizedReadingY: 0.43 });
  snapshot = scheduler.snapshot();
  assert.equal(snapshot.queued, 2);
});

test("manual speech can replay the current chunk instead of reporting a false start", async () => {
  let syntheses = 0;
  const provider = {
    ...createNullTtsProvider(),
    async synthesize(input) {
      syntheses += 1;
      return createNullTtsProvider().synthesize(input);
    },
  };
  const scheduler = createTtsScheduler({ provider });
  const chunks = [chunk(1, 0.36, "Read this sentence again.")];

  await scheduler.update({
    isPlaying: true,
    chunks,
    normalizedReadingY: 0.38,
    speech: { mode: "flow", manual: false },
  });
  scheduler.releasePlaybackLock();
  await scheduler.update({
    isPlaying: true,
    chunks,
    normalizedReadingY: 0.38,
    speech: { mode: "flow", manual: true },
  });

  assert.equal(syntheses, 2);
  assert.equal(scheduler.snapshot().queued, 2);
});

test("createTtsScheduler cancels when paused or reset", async () => {
  const scheduler = createTtsScheduler({ provider: createNullTtsProvider() });
  await scheduler.update({ isPlaying: true, chunks: [chunk(1, 0.36)], normalizedReadingY: 0.38 });
  await scheduler.update({ isPlaying: false, chunks: [chunk(1, 0.36)], normalizedReadingY: 0.38 });
  assert.equal(scheduler.snapshot().status, "paused");
  scheduler.reset("document-cleared");
  assert.equal(scheduler.snapshot().status, "document-cleared");
  assert.equal(scheduler.snapshot().currentKey, null);
});

test("a late synthesis result cannot call onResult after page cancellation", async () => {
  let resolveSynthesis;
  const results = [];
  const provider = {
    id: "delayed",
    name: "Delayed",
    mode: "local",
    synthesize() {
      return new Promise((resolve) => {
        resolveSynthesis = resolve;
      });
    },
    cancel() {},
  };
  const scheduler = createTtsScheduler({
    provider,
    onResult: (event) => results.push(event),
  });

  const pending = scheduler.update({
    isPlaying: true,
    chunks: [chunk(1, 0.36, "Old page sentence.")],
    normalizedReadingY: 0.38,
    pageNumber: 1,
  });
  await Promise.resolve();
  scheduler.cancel("page-changed");
  resolveSynthesis(await createNullTtsProvider().synthesize({ text: "old" }));
  await pending;

  assert.equal(results.length, 0);
  assert.equal(scheduler.snapshot().status, "page-changed");
});

test("explicit prepare is idempotent and ready playback never synthesizes twice", async () => {
  const calls = [];
  const picks = [];
  const results = [];
  const provider = {
    ...createNullTtsProvider(),
    async synthesize(input) {
      calls.push(input.text);
      return createNullTtsProvider().synthesize(input);
    },
  };
  const scheduler = createTtsScheduler({
    provider,
    onPick: (event) => picks.push(event),
    onResult: (event) => results.push(event),
  });
  const target = chunk(4, 0.4, "Prepared paragraph lead.");
  const pick = { key: "paragraph:4:lead", chunk: target };

  assert.equal(scheduler.prepare({
    key: pick.key,
    pick,
    contextKey: "doc:1",
    speech: { tierKey: "winding-stream", speed: 1.25 },
  }).status, "queued");
  assert.equal(scheduler.prepare({
    key: pick.key,
    pick,
    contextKey: "doc:1",
  }).status, "reused");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(scheduler.snapshot().prefetch.ready, true);

  const played = scheduler.playPrepared({
    key: pick.key,
    contextKey: "doc:1",
  });
  assert.equal(played.status, "played");
  assert.deepEqual(calls, ["Prepared paragraph lead."]);
  assert.equal(picks.length, 1);
  assert.equal(results.length, 1);
  assert.equal(scheduler.snapshot().prefetch, null);
  assert.equal(scheduler.snapshot().playbackLocked, true);
});

test("playPrepared returns late immediately and a late promise can never play", async () => {
  let resolveSynthesis;
  const results = [];
  const provider = {
    id: "delayed-explicit",
    name: "Delayed explicit",
    mode: "local",
    synthesize() {
      return new Promise((resolve) => {
        resolveSynthesis = resolve;
      });
    },
    cancel() {},
  };
  const scheduler = createTtsScheduler({
    provider,
    onResult: (event) => results.push(event),
  });
  const pick = {
    key: "paragraph:1:lead",
    chunk: chunk(1, 0.3, "Too late."),
  };
  scheduler.prepare({ key: pick.key, pick, contextKey: "doc:1" });
  await Promise.resolve();

  const played = scheduler.playPrepared({
    key: pick.key,
    contextKey: "doc:1",
  });
  assert.equal(played.status, "late");
  assert.equal(scheduler.snapshot().prefetch, null);

  resolveSynthesis(await createNullTtsProvider().synthesize({ text: "late" }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(results.length, 0);
  assert.equal(scheduler.snapshot().status, "prepared-late");
});

test("playPrepared rejects stale context and discardPrepared is key-scoped", async () => {
  const scheduler = createTtsScheduler({ provider: createNullTtsProvider() });
  const pick = {
    key: "paragraph:2:lead",
    chunk: chunk(2, 0.3, "Context-bound lead."),
  };
  scheduler.prepare({ key: pick.key, pick, contextKey: "doc:1" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    scheduler.discardPrepared("wrong-key", { key: "paragraph:9:lead" }),
    false,
  );
  assert.equal(scheduler.snapshot().prefetch.key, pick.key);
  assert.equal(
    scheduler.playPrepared({ key: pick.key, contextKey: "doc:2" }).status,
    "stale",
  );
  assert.equal(scheduler.snapshot().prefetch, null);
});

test("playPrepared discards a ready lead when another utterance still holds playback", async () => {
  const scheduler = createTtsScheduler({ provider: createNullTtsProvider() });
  await scheduler.update({
    isPlaying: true,
    chunks: [chunk(1, 0.2, "Current utterance.")],
    normalizedReadingY: 0.21,
  });
  const pick = {
    key: "paragraph:2:lead",
    chunk: chunk(2, 0.3, "Prepared while busy."),
  };
  scheduler.prepare({ key: pick.key, pick, contextKey: "doc:1" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(
    scheduler.playPrepared({ key: pick.key, contextKey: "doc:1" }).status,
    "busy",
  );
  assert.equal(scheduler.snapshot().prefetch, null);
  assert.equal(scheduler.snapshot().status, "prepared-busy");
});

test("discarding in the same tick prevents explicit inference from starting", async () => {
  let syntheses = 0;
  const provider = {
    ...createNullTtsProvider(),
    async synthesize(input) {
      syntheses += 1;
      return createNullTtsProvider().synthesize(input);
    },
  };
  const scheduler = createTtsScheduler({ provider });
  const pick = {
    key: "paragraph:3:lead",
    chunk: chunk(3, 0.3, "Never start this inference."),
  };
  scheduler.prepare({ key: pick.key, pick, contextKey: "doc:1" });
  scheduler.discardPrepared("late-or-missing", { key: pick.key });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(syntheses, 0);
  assert.equal(scheduler.snapshot().prefetch, null);
  assert.equal(scheduler.snapshot().status, "late-or-missing");
});
