import test from "node:test";
import assert from "node:assert/strict";
import { createTtsModelManager, MODEL_STATUS, KOKORO_MODEL_META } from "../tts-model-manager.mjs";

function fakeProvider({ fail = false, delayMs = 0 } = {}) {
  return {
    id: "fake-local",
    async preload() {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      if (fail) throw new Error("download failed");
      return true;
    },
    cancel() {},
  };
}

test("model manager exposes the routed English and CJK model footprint", () => {
  assert.equal(KOKORO_MODEL_META.source, "Kokoro-82M q8 + Kokoro v1.0 int8");
  assert.equal(KOKORO_MODEL_META.approxSizeMb, 201);
  assert.deepEqual(KOKORO_MODEL_META.languages, ["en", "zh", "ja"]);
});

test("ensureModel loads provider and marks ready", async () => {
  const events = [];
  const m = createTtsModelManager({
    providerFactory: () => fakeProvider(),
    onStatusChange: (e) => events.push(e.status),
  });
  const provider = await m.ensureModel();
  assert.ok(provider);
  assert.equal(m.getStatus(), MODEL_STATUS.READY);
  assert.equal(m.snapshot().progress, 100);
  assert.deepEqual(events, [MODEL_STATUS.DOWNLOADING, MODEL_STATUS.DOWNLOADING, MODEL_STATUS.READY]);
});

test("ensureModel reuses concurrent loading promise", async () => {
  let created = 0;
  const m = createTtsModelManager({
    providerFactory: () => {
      created += 1;
      return fakeProvider({ delayMs: 5 });
    },
  });
  const [a, b] = await Promise.all([m.ensureModel(), m.ensureModel()]);
  assert.equal(a, b);
  assert.equal(created, 1);
});

test("ensureModel records errors without throwing", async () => {
  const m = createTtsModelManager({ providerFactory: () => fakeProvider({ fail: true }) });
  const provider = await m.ensureModel();
  assert.equal(provider, null);
  assert.equal(m.getStatus(), MODEL_STATUS.ERROR);
  assert.match(m.snapshot().error, /download failed/);
});

test("markNotDownloaded resets provider and status", async () => {
  const m = createTtsModelManager({ providerFactory: () => fakeProvider() });
  await m.ensureModel();
  m.markNotDownloaded();
  assert.equal(m.getStatus(), MODEL_STATUS.NOT_DOWNLOADED);
  assert.equal(m.getProvider(), null);
  assert.equal(m.snapshot().progress, 0);
});

test("reset returns to unknown", async () => {
  const m = createTtsModelManager({ providerFactory: () => fakeProvider() });
  await m.ensureModel();
  m.reset("document-reset");
  assert.equal(m.getStatus(), MODEL_STATUS.UNKNOWN);
  assert.equal(m.getProvider(), null);
});
