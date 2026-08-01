import test from "node:test";
import assert from "node:assert/strict";
import { createTtsAudioPlayer } from "../tts-audio-player.mjs";

function fakeAudioContext() {
  const gain = {
    value: 1,
    cancelScheduledValues() {},
    setValueAtTime(value) { this.value = value; },
    linearRampToValueAtTime(value) { this.value = value; },
  };
  const context = {
    currentTime: 0,
    destination: {},
    createGain() {
      return { gain, connect() {} };
    },
    createBufferSource() {
      return {
        buffer: null,
        onended: null,
        started: false,
        stopped: false,
        connect() {},
        disconnect() {},
        start() { this.started = true; },
        stop() { this.stopped = true; this.onended?.(); },
      };
    },
    async decodeAudioData(buffer) {
      assert.ok(buffer instanceof ArrayBuffer);
      return { duration: 1.25 };
    },
    async resume() {},
  };
  return context;
}

function wavLikeBuffer() {
  return new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]).buffer;
}

test("audio player starts muted by default", () => {
  const player = createTtsAudioPlayer({ audioContextFactory: fakeAudioContext });
  const s = player.snapshot();
  assert.equal(s.muted, true);
  assert.equal(s.status, "idle");
});

test("audio player plays an ArrayBuffer", async () => {
  const player = createTtsAudioPlayer({ audioContextFactory: fakeAudioContext, muted: false, fadeMs: 0 });
  const source = await player.play({ audioBuffer: wavLikeBuffer() });
  assert.ok(source?.started);
  const s = player.snapshot();
  assert.equal(s.status, "playing");
  assert.equal(s.played, 1);
  assert.equal(s.activeDuration, 1.25);
});

test("audio player skips null audio without failing", async () => {
  const player = createTtsAudioPlayer({ audioContextFactory: fakeAudioContext });
  const source = await player.play({ audioBuffer: null });
  assert.equal(source, null);
  assert.equal(player.snapshot().status, "skipped");
});

test("audio player stop clears active source", async () => {
  const player = createTtsAudioPlayer({ audioContextFactory: fakeAudioContext, muted: false, fadeMs: 0 });
  await player.play({ audioBuffer: wavLikeBuffer() });
  player.stop({ fade: false });
  const s = player.snapshot();
  assert.equal(s.active, false);
  assert.equal(s.stopped, 1);
});

test("audio cancelled during decode never starts after the decode resolves", async () => {
  const context = fakeAudioContext();
  const sources = [];
  let resolveDecode;
  context.decodeAudioData = () => new Promise((resolve) => {
    resolveDecode = resolve;
  });
  const originalCreateBufferSource = context.createBufferSource;
  context.createBufferSource = () => {
    const source = originalCreateBufferSource();
    sources.push(source);
    return source;
  };
  const player = createTtsAudioPlayer({
    audioContextFactory: () => context,
    muted: false,
    fadeMs: 0,
  });

  const pending = player.play({ audioBuffer: wavLikeBuffer() });
  await Promise.resolve();
  player.stop({ reason: "page-changed", fade: false });
  resolveDecode({ duration: 1.25 });

  assert.equal(await pending, null);
  assert.equal(sources.some((source) => source.started), false);
  assert.equal(player.snapshot().active, false);
});

test("setMuted and setVolume update snapshot", () => {
  const player = createTtsAudioPlayer({ audioContextFactory: fakeAudioContext, muted: true });
  player.setVolume(0.7);
  player.setMuted(false);
  const s = player.snapshot();
  assert.equal(s.volume, 0.7);
  assert.equal(s.muted, false);
});

test("duck and unduck do not throw", () => {
  const player = createTtsAudioPlayer({ audioContextFactory: fakeAudioContext, muted: false });
  player.duck(0.3);
  player.unduck();
  assert.equal(player.snapshot().failed, 0);
});
