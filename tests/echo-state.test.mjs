import test from "node:test";
import assert from "node:assert/strict";

import {
  ECHO_MAX_ATTEMPTS,
  ECHO_STATE_KEY,
  createEmptyEchoState,
  readEchoState,
  recordEchoFailure,
  recordEchoPending,
  recordEchoSuccess,
  retryableEchoRecords,
  writeEchoState,
} from "../echo-state.mjs";

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    dump: () => new Map(map),
  };
}

test("pending, success, and failure transitions persist across reads", () => {
  const storage = memoryStorage();
  let state = readEchoState(storage);
  state = recordEchoPending(state, "trace-1");
  state = recordEchoSuccess(state, "trace-1", {
    text: "一句复述。",
    mode: "text-only",
    model: "deepseek-chat",
    latencyMs: 1234,
  });
  writeEchoState(state, storage);

  const reloaded = readEchoState(storage);
  assert.equal(reloaded.records["trace-1"].status, "done");
  assert.equal(reloaded.records["trace-1"].text, "一句复述。");
  assert.equal(reloaded.records["trace-1"].latencyMs, 1234);
  assert.equal(storage.getItem(ECHO_STATE_KEY).includes("一句复述"), true);
});

test("a done record is a terminal state that later pending calls cannot overwrite", () => {
  let state = createEmptyEchoState();
  state = recordEchoSuccess(state, "trace-1", { text: "保留的复述。" });
  state = recordEchoPending(state, "trace-1");
  state = recordEchoFailure(state, "trace-1", "timeout");
  assert.equal(state.records["trace-1"].status, "done");
  assert.equal(state.records["trace-1"].text, "保留的复述。");
});

test("failure records keep reasons and a bounded attempt counter", () => {
  let state = createEmptyEchoState();
  state = recordEchoFailure(state, "trace-1", "timeout");
  assert.equal(state.records["trace-1"].attempts, 1);
  state = recordEchoFailure(state, "trace-1", "network");
  assert.equal(state.records["trace-1"].attempts, 2);
  assert.equal(state.records["trace-1"].reason, "network");
  const retryable = retryableEchoRecords(state);
  assert.equal(retryable.length, 1);
  assert.equal(retryable[0].traceId, "trace-1");

  for (let index = 0; index < ECHO_MAX_ATTEMPTS; index += 1) {
    state = recordEchoFailure(state, "trace-1", "flaky");
  }
  assert.equal(state.records["trace-1"].attempts, ECHO_MAX_ATTEMPTS);
  assert.deepEqual(retryableEchoRecords(state), []);
});

test("corrupt state falls back to empty without throwing", () => {
  const storage = memoryStorage();
  storage.setItem(ECHO_STATE_KEY, "{broken json");
  assert.deepEqual(readEchoState(storage).records, {});
});

test("sanitize drops records with unknown statuses or mismatched ids", () => {
  const storage = memoryStorage();
  storage.setItem(ECHO_STATE_KEY, JSON.stringify({
    schemaVersion: 1,
    records: {
      good: { traceId: "good", status: "done", text: "有效" },
      badStatus: { traceId: "badStatus", status: "weird" },
      mismatched: { traceId: "other", status: "pending" },
    },
  }));
  const state = readEchoState(storage);
  assert.deepEqual(Object.keys(state.records), ["good"]);
});
