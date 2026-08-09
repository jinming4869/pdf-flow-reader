import test from "node:test";
import assert from "node:assert/strict";

import {
  canRequestManualSpeech,
  cancelTtsSession,
  createTtsController,
  runManualSpeechRequest,
} from "../tts-controller.mjs";
import { createNullTtsProvider } from "../tts-provider.mjs";
import { createTtsScheduler } from "../tts-scheduler.mjs";

function chunk({
  text = "A readable sentence.",
  role = "body",
  priority = 1,
  y = 0.35,
  height = 0.05,
  chunkIndex = 0,
  pageIndex = 0,
} = {}) {
  return {
    source: "native-text",
    pageIndex,
    chunkIndex,
    text,
    role,
    priority,
    languageHint: "latin",
    normalizedBbox: { x: 0.1, y, width: 0.8, height },
  };
}

function schedulerStub() {
  const calls = [];
  let prepared = null;
  return {
    calls,
    async update(args) {
      calls.push(args);
      const selected = args.chunks[0];
      return selected
        ? {
            chunk: selected,
            key: `${selected.source}:${selected.pageIndex}:${selected.chunkIndex}`,
          }
        : null;
    },
    cancel(reason) {
      calls.push({ cancel: reason });
    },
    reset(reason) {
      calls.push({ reset: reason });
    },
    releasePlaybackLock(reason) {
      calls.push({ release: reason });
    },
    prepare(args) {
      calls.push({ prepare: args });
      prepared = {
        kind: "explicit",
        key: args.key,
        ready: false,
      };
      return { key: args.key, status: "queued", ready: false };
    },
    playPrepared(args) {
      calls.push({ playPrepared: args });
      if (!prepared || prepared.key !== args.key || !prepared.ready) {
        return { key: args.key, status: "late", ready: false };
      }
      prepared = null;
      return { key: args.key, status: "played", ready: true };
    },
    discardPrepared(reason, options) {
      calls.push({ discardPrepared: { reason, ...options } });
      prepared = null;
      return true;
    },
    markPreparedReady() {
      if (prepared) prepared.ready = true;
    },
    snapshot() {
      return { prefetch: prepared ? { ...prepared } : null };
    },
  };
}

test("controller defaults to disabled and does not speak", async () => {
  const scheduler = schedulerStub();
  const controller = createTtsController({ scheduler });
  assert.equal(controller.isEnabled(), false);
  assert.equal(
    await controller.tick({
      isPlaying: true,
      chunks: [chunk()],
      normalizedReadingY: 0.36,
    }),
    null,
  );
  assert.equal(scheduler.calls.length, 0);
});

test("setEnabled and toggleEnabled control one boolean master", () => {
  const scheduler = schedulerStub();
  const controller = createTtsController({
    scheduler,
    getSpeedTier: () => "snow-mist",
  });
  assert.equal(controller.setEnabled(true), true);
  assert.equal(controller.isEnabled(), true);
  assert.equal(controller.getPolicy().tierKey, "snow-mist");
  assert.equal(controller.toggleEnabled(), false);
  assert.equal(controller.isEnabled(), false);
  assert.equal(scheduler.calls.at(-1).reset, "master-off");
});

test("manual read gate requires a ready PDF, enabled matching policy, and chunks", () => {
  const controller = createTtsController({
    scheduler: schedulerStub(),
    getSpeedTier: () => "long-day",
  });
  controller.setEnabled(true);
  const ready = {
    readyToMove: true,
    hasActivePdf: true,
    controlAllowed: true,
    policy: controller.getPolicy(),
    action: "read-line-sentence",
    hasReadableChunks: true,
  };
  assert.equal(canRequestManualSpeech(ready), true);
  for (const patch of [
    { readyToMove: false },
    { hasActivePdf: false },
    { controlAllowed: false },
    { action: "point-sentence" },
    { hasReadableChunks: false },
  ]) {
    assert.equal(canRequestManualSpeech({ ...ready, ...patch }), false);
  }
  controller.setEnabled(false);
  assert.equal(
    canRequestManualSpeech({ ...ready, policy: controller.getPolicy() }),
    false,
  );
});

test("manual read request never warms or speaks when its gate is closed", async () => {
  const calls = [];
  const result = await runManualSpeechRequest({
    canRequest: () => false,
    warmup: async () => calls.push("warmup"),
    requestAction: () => calls.push("request"),
    onReady: () => calls.push("ready"),
  });

  assert.equal(result, false);
  assert.deepEqual(calls, []);
});

test("manual read request rechecks its gate after warmup", async () => {
  const calls = [];
  let allowed = true;
  const result = await runManualSpeechRequest({
    canRequest: () => allowed,
    warmup: async () => {
      calls.push("warmup");
      allowed = false;
      return true;
    },
    requestAction: () => calls.push("request"),
  });

  assert.equal(result, false);
  assert.deepEqual(calls, ["warmup"]);
});

test("snow-mist reads continuously and prefetches the next chunk", async () => {
  const scheduler = schedulerStub();
  const controller = createTtsController({
    scheduler,
    getSpeedTier: () => "snow-mist",
  });
  controller.setEnabled(true);
  const result = await controller.tick({
    isPlaying: true,
    chunks: [chunk()],
    normalizedReadingY: 0.36,
  });
  assert.ok(result?.chunk);
  const update = scheduler.calls.find((call) => call.speech);
  assert.equal(update.speech.tierKey, "snow-mist");
  assert.equal(update.speech.speed, 1.18);
  assert.equal(update.speech.prefetchNext, true);
  assert.equal(update.speech.prefetchDepth, 2);
});

test("continuous speech consumes a ready nearby prefetch before the reading line reaches it", async () => {
  const calls = [];
  const current = chunk({ text: "Current readable chunk.", y: 0.34, chunkIndex: 0 });
  const next = chunk({ text: "Nearby prefetched chunk.", y: 0.47, chunkIndex: 1 });
  const keyFor = (value) => `${value.source}:${value.pageIndex}:${value.chunkIndex}`;
  const scheduler = {
    async update(args) {
      calls.push(args);
      const selected = args.preferredKey
        ? args.chunks.find((entry) => keyFor(entry) === args.preferredKey)
        : args.chunks[0];
      return selected ? { chunk: selected, key: keyFor(selected) } : null;
    },
    cancel() {},
    reset() {},
    snapshot() {
      return calls.length
        ? { prefetch: { kind: "continuous", key: keyFor(next), ready: true } }
        : { prefetch: null };
    },
  };
  const controller = createTtsController({
    scheduler,
    getSpeedTier: () => "snow-mist",
  });
  controller.setEnabled(true);

  const first = await controller.tick({
    isPlaying: true,
    chunks: [current, next],
    normalizedReadingY: 0.36,
  });
  assert.equal(first.chunk.text, current.text);

  const continued = await controller.tick({
    isPlaying: true,
    chunks: [current, next],
    normalizedReadingY: 0.36,
  });
  assert.equal(continued.chunk.text, next.text);
  assert.equal(calls[1].preferredKey, keyFor(next));
});

test("continuous speech never skips an immediate chunk for a farther ready prefetch", async () => {
  const calls = [];
  const current = chunk({ text: "Current chunk.", y: 0.34, chunkIndex: 0 });
  const immediate = chunk({ text: "Immediate next chunk.", y: 0.43, chunkIndex: 1 });
  const farther = chunk({ text: "Farther prefetched chunk.", y: 0.51, chunkIndex: 2 });
  const keyFor = (value) => `${value.source}:${value.pageIndex}:${value.chunkIndex}`;
  const scheduler = {
    async update(args) {
      calls.push(args);
      const selected = args.preferredKey
        ? args.chunks.find((entry) => keyFor(entry) === args.preferredKey)
        : args.chunks[0];
      return selected ? { chunk: selected, key: keyFor(selected) } : null;
    },
    cancel() {},
    reset() {},
    snapshot() {
      return calls.length
        ? { prefetch: { kind: "continuous", key: keyFor(farther), ready: true } }
        : { prefetch: null };
    },
  };
  const controller = createTtsController({
    scheduler,
    getSpeedTier: () => "snow-mist",
  });
  controller.setEnabled(true);

  await controller.tick({
    isPlaying: true,
    chunks: [current, immediate, farther],
    normalizedReadingY: 0.36,
  });
  const repeated = await controller.tick({
    isPlaying: true,
    chunks: [current, immediate, farther],
    normalizedReadingY: 0.36,
  });

  assert.equal(repeated, null);
  assert.equal(calls.length, 1);
});

test("snow-mist keeps the next page separate from current picking but offers it for prefetch", async () => {
  const scheduler = schedulerStub();
  const controller = createTtsController({
    scheduler,
    getSpeedTier: () => "snow-mist",
  });
  controller.setEnabled(true);
  const current = chunk({ text: "Last chunk on page one.", pageIndex: 0 });
  const next = chunk({ text: "First chunk on page two.", pageIndex: 1 });
  await controller.tick({
    isPlaying: true,
    chunks: [current],
    prefetchChunks: [next],
    normalizedReadingY: 0.36,
    pageNumber: 1,
  });
  const update = scheduler.calls.find((call) => call.speech);
  assert.deepEqual(update.chunks.map((entry) => entry.text), [current.text]);
  assert.deepEqual(update.prefetchChunks.map((entry) => entry.text), [next.text]);
});

test("aesthetic-walk filters notes and balanced parentheticals at 1.5x", async () => {
  const scheduler = schedulerStub();
  const controller = createTtsController({
    scheduler,
    getSpeedTier: () => "aesthetic-walk",
  });
  controller.setEnabled(true);
  await controller.tick({
    isPlaying: true,
    chunks: [
      chunk({ text: "1 A footnote.", role: "footnote", chunkIndex: 0 }),
      chunk({
        text: "Main text (aside) continues.",
        role: "body",
        chunkIndex: 1,
      }),
    ],
    normalizedReadingY: 0.36,
  });
  const update = scheduler.calls.find((call) => call.speech);
  assert.equal(update.chunks.length, 1);
  assert.equal(update.chunks[0].text, "Main text continues.");
  assert.equal(update.speech.speed, 1.5);
  assert.equal(update.speech.prefetchNext, true);
  assert.equal(update.speech.prefetchDepth, 2);
});

test("aesthetic-walk derives a 1.5–2.5x rate from the remaining visual window", async () => {
  const scheduler = schedulerStub();
  const controller = createTtsController({
    scheduler,
    getSpeedTier: () => "aesthetic-walk",
  });
  controller.setEnabled(true);
  await controller.tick({
    isPlaying: true,
    chunks: [chunk({
      text: Array.from({ length: 33 }, () => "word").join(" "),
      y: 0.38,
      height: 0.07,
    })],
    normalizedReadingY: 0.38,
    pageHeightPx: 1_000,
    scrollPxPerSecond: 10,
    nowMs: 2_000,
  });
  const update = scheduler.calls.find((call) => call.speech);
  assert.equal(update.speech.utterancePlan.decision, "full");
  assert.ok(update.speech.speed > 1.5 && update.speech.speed < 2.5);
});

test("aesthetic-walk marks an impossible utterance handled without starting synthesis", async () => {
  const scheduler = schedulerStub();
  const states = [];
  const controller = createTtsController({
    scheduler,
    getSpeedTier: () => "aesthetic-walk",
    onStateChange: (state) => states.push(state),
  });
  controller.setEnabled(true);
  const args = {
    isPlaying: true,
    chunks: [chunk({
      text: `${Array.from({ length: 50 }, () => "unhurried").join(" ")}. Another sentence.`,
      y: 0.37,
      height: 0.02,
    })],
    normalizedReadingY: 0.38,
    pageHeightPx: 1_000,
    scrollPxPerSecond: 12,
    nowMs: 4_000,
  };
  const skipped = await controller.tick(args);
  assert.equal(skipped.status, "visual-skip");
  assert.equal(skipped.skipped, true);
  assert.equal(scheduler.calls.filter((call) => call.speech).length, 0);
  assert.equal(states.at(-1).status, "visual-skip");
  assert.equal(await controller.tick(args), null);
});

test("long-day stays quiet until its line action is explicitly requested", async () => {
  const scheduler = schedulerStub();
  const controller = createTtsController({
    scheduler,
    getSpeedTier: () => "long-day",
  });
  controller.setEnabled(true);
  assert.equal(
    await controller.tick({
      isPlaying: true,
      chunks: [chunk()],
      normalizedReadingY: 0.36,
    }),
    null,
  );
  assert.equal(scheduler.calls.filter((call) => call.speech).length, 0);

  assert.equal(controller.requestAction("read-line-sentence"), true);
  const result = await controller.tick({
    isPlaying: false,
    chunks: [chunk({ text: "First sentence. Second sentence." })],
    normalizedReadingY: 0.36,
  });
  assert.ok(result?.chunk);
  const update = scheduler.calls.find((call) => call.speech);
  assert.equal(update.speech.manual, true);
  assert.equal(update.speech.firstSentenceOnly, true);
  assert.equal(controller.snapshot().manualArmedAction, null);
});

test("long-day can explicitly reread the same chunk", async () => {
  const scheduler = schedulerStub();
  const controller = createTtsController({
    scheduler,
    getSpeedTier: () => "long-day",
  });
  controller.setEnabled(true);
  for (let count = 0; count < 2; count += 1) {
    assert.equal(controller.requestAction("read-line-sentence"), true);
    await controller.tick({
      isPlaying: false,
      chunks: [chunk({ y: 0.37 })],
      normalizedReadingY: 0.36,
    });
  }
  assert.equal(scheduler.calls.filter((call) => call.speech).length, 2);
});

test("point read speaks the explicit sentence target instead of repicking by reading line", async () => {
  const scheduler = schedulerStub();
  const controller = createTtsController({
    scheduler,
    getSpeedTier: () => "strong-wind",
  });
  controller.setEnabled(true);
  const target = chunk({
    text: "The sentence under the pointer.",
    y: 0.78,
    chunkIndex: 7,
  });
  target.speechKey = "native-text:0:point:7";
  target.pointReadRequestId = 12;

  assert.equal(controller.requestTarget("point-sentence", target), true);
  const result = await controller.tick({
    isPlaying: false,
    chunks: [chunk({ text: "A closer but unclicked sentence.", y: 0.36 })],
    normalizedReadingY: 0.36,
    pageNumber: 1,
  });

  assert.equal(result?.chunk?.text, target.text);
  const update = scheduler.calls.find((call) => call.speech);
  assert.deepEqual(update.chunks, [target]);
  assert.equal(update.speech.action, "point-sentence");
  assert.equal(update.speech.manual, true);
  assert.equal(update.speech.firstSentenceOnly, false);
  assert.equal(update.speech.requestId, 12);
});

test("point read rejects explicit targets outside the two highest tiers", () => {
  const target = chunk({ text: "Do not read me." });
  for (const tierKey of ["snow-mist", "aesthetic-walk", "long-day", "winding-stream"]) {
    const controller = createTtsController({
      scheduler: schedulerStub(),
      getSpeedTier: () => tierKey,
    });
    controller.setEnabled(true);
    assert.equal(controller.requestTarget("point-sentence", target), false, tierKey);
  }
});

test("long-day reads the nearest sentence below the line with the real scheduler", async () => {
  const spoken = [];
  const provider = {
    ...createNullTtsProvider(),
    async synthesize(input) {
      spoken.push(input.text);
      return createNullTtsProvider().synthesize(input);
    },
  };
  const scheduler = createTtsScheduler({ provider });
  const controller = createTtsController({
    scheduler,
    getSpeedTier: () => "long-day",
  });
  controller.setEnabled(true);
  controller.requestAction("read-line-sentence");
  await controller.tick({
    isPlaying: false,
    normalizedReadingY: 0.39,
    chunks: [
      chunk({
        text: "Closer but above.",
        y: 0.31,
        height: 0.05,
        chunkIndex: 1,
      }),
      chunk({
        text: "First sentence. Second sentence. Third sentence.",
        y: 0.3,
        height: 0.3,
        chunkIndex: 2,
      }),
    ],
  });
  assert.deepEqual(spoken, ["Second sentence."]);
});

test("non-line tiers reject line actions and unfinished point tiers stay quiet", async () => {
  for (const tierKey of [
    "snow-mist",
    "aesthetic-walk",
    "winding-stream",
    "strong-wind",
    "all-things-flourish",
  ]) {
    const scheduler = schedulerStub();
    const controller = createTtsController({
      scheduler,
      getSpeedTier: () => tierKey,
    });
    controller.setEnabled(true);
    assert.equal(controller.requestAction("read-line-sentence"), false, tierKey);
    if (["strong-wind", "all-things-flourish"].includes(tierKey)) {
      assert.equal(
        await controller.tick({
          isPlaying: true,
          chunks: [chunk()],
          normalizedReadingY: 0.36,
        }),
        null,
        tierKey,
      );
      assert.equal(
        scheduler.calls.filter((call) => call.speech).length,
        0,
        tierKey,
      );
    }
  }
});

function paragraph(index, start, end) {
  return {
    paragraphKey: `paragraph:${index}`,
    paragraphIndex: index,
    source: "native-text",
    role: "body",
    priority: 1,
    start,
    end,
    leadSentence: {
      key: `paragraph:${index}:lead`,
      text: `Lead ${index}.`,
      pageIndex: 0,
      source: "native-text",
      languageHint: "latin",
      normalizedBbox: { x: 0.1, y: start / 1000, width: 0.8, height: 0.03 },
    },
  };
}

test("winding-stream prepares at paragraph start and plays only a ready lead at tail", async () => {
  const scheduler = schedulerStub();
  const controller = createTtsController({
    scheduler,
    getSpeedTier: () => "winding-stream",
  });
  const paragraphs = [
    paragraph(0, 100, 200),
    paragraph(1, 220, 320),
    paragraph(2, 340, 440),
  ];
  controller.setEnabled(true);

  await controller.tick({
    isPlaying: true,
    paragraphs,
    readingPosition: 90,
    paragraphContextKey: "doc:1",
  });
  await controller.tick({
    isPlaying: true,
    paragraphs,
    readingPosition: 110,
    paragraphContextKey: "doc:1",
    documentGeneration: 1,
  });
  const prepared = scheduler.calls.find((call) => call.prepare);
  assert.equal(prepared.prepare.key, "paragraph:1:lead");
  assert.equal(prepared.prepare.speech.paragraphLead, true);
  scheduler.markPreparedReady();

  const played = await controller.tick({
    isPlaying: true,
    paragraphs,
    readingPosition: 210,
    paragraphContextKey: "doc:1",
    documentGeneration: 1,
  });
  assert.equal(played.results[0].status, "played");
  assert.equal(scheduler.calls.at(-1).playPrepared.key, "paragraph:1:lead");
  assert.equal(controller.snapshot().paragraphFlow.handledCount, 1);
});

test("winding-stream discards a lead that is still pending at paragraph tail", async () => {
  const scheduler = schedulerStub();
  const controller = createTtsController({
    scheduler,
    getSpeedTier: () => "winding-stream",
  });
  controller.setEnabled(true);
  const paragraphs = [
    paragraph(0, 100, 200),
    paragraph(1, 220, 320),
  ];
  await controller.tick({
    isPlaying: true,
    paragraphs,
    readingPosition: 90,
    paragraphContextKey: "doc:1",
  });
  const result = await controller.tick({
    isPlaying: true,
    paragraphs,
    readingPosition: 210,
    paragraphContextKey: "doc:1",
  });
  assert.deepEqual(
    result.actions.map((action) => action.type),
    ["prepare", "discard-prepared"],
  );
  assert.ok(scheduler.calls.some((call) => call.discardPrepared?.reason === "late-or-missing"));
});

test("shortcut actions derive from the enabled tier policy", () => {
  let tierKey = "long-day";
  const controller = createTtsController({
    scheduler: schedulerStub(),
    getSpeedTier: () => tierKey,
  });
  assert.equal(controller.shortcutAction("KeyH"), "toggle-master");
  assert.equal(controller.shortcutAction("KeyR"), null);
  controller.setEnabled(true);
  assert.equal(controller.shortcutAction("KeyR"), "read-line-sentence");
  tierKey = "snow-mist";
  assert.equal(controller.shortcutAction("KeyR"), null);
});

test("stop cancels the session without disabling the master", () => {
  const scheduler = schedulerStub();
  const controller = createTtsController({ scheduler });
  controller.setEnabled(true);
  controller.stop();
  assert.equal(controller.isEnabled(), true);
  assert.equal(scheduler.calls.at(-1).cancel, "manual-stop");
});

test("stop invalidates an in-flight tick before it can write old page state", async () => {
  let resolveUpdate;
  const states = [];
  const scheduler = {
    cancel() {},
    update() {
      return new Promise((resolve) => {
        resolveUpdate = resolve;
      });
    },
  };
  const controller = createTtsController({
    scheduler,
    getSpeedTier: () => "snow-mist",
    onStateChange: (state) => states.push(state),
  });
  controller.setEnabled(true);
  const pending = controller.tick({
    isPlaying: true,
    chunks: [chunk({ text: "Old page sentence." })],
    normalizedReadingY: 0.36,
  });
  await Promise.resolve();
  controller.stop("page-changed");
  resolveUpdate({
    key: "native-text:0:0",
    chunk: chunk({ text: "Old page sentence." }),
    result: { audioBuffer: new ArrayBuffer(0) },
  });

  assert.equal(await pending, null);
  assert.equal(controller.snapshot().lastChunkKey, null);
  assert.equal(states.some((state) => state.status === "speaking"), false);
});

test("snapshot exposes master and policy without old three-state modes", () => {
  const controller = createTtsController({
    scheduler: schedulerStub(),
    getSpeedTier: () => "long-day",
  });
  controller.setEnabled(true);
  const snapshot = controller.snapshot();
  assert.equal(snapshot.enabled, true);
  assert.equal(snapshot.policy.tierKey, "long-day");
  assert.equal("mode" in snapshot, false);
  assert.equal("manualArmed" in snapshot, false);
});

test("unified session cancellation stops controller, playback lock, audio and focus", () => {
  const calls = [];
  const controller = {
    stop(reason) {
      calls.push(["controller.stop", reason]);
    },
    reset(reason) {
      calls.push(["controller.reset", reason]);
    },
  };
  const scheduler = {
    cancel(reason) {
      calls.push(["scheduler.cancel", reason]);
    },
    releasePlaybackLock(reason) {
      calls.push(["scheduler.release", reason]);
    },
  };
  const audioPlayer = {
    stop(options) {
      calls.push(["audio.stop", options]);
    },
  };

  cancelTtsSession(
    {
      controller,
      scheduler,
      audioPlayer,
      clearFocus: () => calls.push(["focus.clear"]),
      setUtteranceLocked: (locked) => calls.push(["locked", locked]),
    },
    "page-changed",
  );

  assert.deepEqual(calls, [
    ["controller.stop", "page-changed"],
    ["scheduler.release", "page-changed"],
    ["audio.stop", { reason: "page-changed", fade: true }],
    ["focus.clear"],
    ["locked", false],
  ]);
});

test("unified session reset uses controller reset for a new document", () => {
  const calls = [];
  cancelTtsSession(
    {
      controller: {
        stop(reason) {
          calls.push(["stop", reason]);
        },
        reset(reason) {
          calls.push(["reset", reason]);
        },
      },
      scheduler: {
        releasePlaybackLock(reason) {
          calls.push(["release", reason]);
        },
      },
      audioPlayer: {
        stop(options) {
          calls.push(["audio", options.reason]);
        },
      },
    },
    "document-cleared",
    { reset: true, fade: false },
  );

  assert.deepEqual(calls, [
    ["reset", "document-cleared"],
    ["release", "document-cleared"],
    ["audio", "document-cleared"],
  ]);
});
