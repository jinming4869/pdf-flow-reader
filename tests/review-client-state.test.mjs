import test from "node:test";
import assert from "node:assert/strict";

import { createReviewClient } from "../review-client.mjs";
import {
  readReviewState,
  recordReviewPending,
  recordReviewResult,
  writeReviewState,
} from "../review-state.mjs";

function openAICompletion(content) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ choices: [{ message: { content } }] }),
  };
}

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, String(value)),
  };
}

const CHUNKS = [
  { index: 0, pageStart: 0, pageEnd: 2, charCount: 100, text: "[第 1 页]\n内容一" },
  { index: 1, pageStart: 3, pageEnd: 5, charCount: 100, text: "[第 4 页]\n内容二" },
];

test("generateReview requests each chunk and collects sections in order", async () => {
  const calls = [];
  const client = createReviewClient({
    apiKey: "sk-test",
    fetchFn: async (_url, init) => {
      calls.push(JSON.parse(init.body));
      return openAICompletion("分节总结。");
    },
  });
  const result = await client.generateReview({
    chunks: CHUNKS,
    aggregateText: "# 阅读轨迹\n- 航迹数：2",
  });
  assert.equal(result.sections.length, 2);
  assert.equal(result.cancelled, false);
  assert.equal(result.failedIndex, null);
  assert.equal(calls.length, 2);
  // 第一块携带航迹聚合。
  assert.match(calls[0].messages[1].content, /阅读轨迹/);
  assert.doesNotMatch(calls[1].messages[1].content, /阅读轨迹/);
});

test("a mid-book failure keeps completed sections as partial", async () => {
  let count = 0;
  const client = createReviewClient({
    apiKey: "sk-test",
    fetchFn: async () => {
      count += 1;
      if (count === 2) {
        return { ok: false, status: 503, text: async () => JSON.stringify({ error: { message: "busy" } }) };
      }
      return openAICompletion("分节总结。");
    },
  });
  const result = await client.generateReview({ chunks: CHUNKS, aggregateText: "" });
  assert.equal(result.sections.length, 1);
  assert.equal(result.failedIndex, 1);
  assert.equal(result.partial, true);
  assert.equal(result.errorCode, "REVIEW_REQUEST_FAILED");
});

test("abort stops generation and reports cancelled with completed sections", async () => {
  const controller = new AbortController();
  let count = 0;
  const client = createReviewClient({
    apiKey: "sk-test",
    fetchFn: async () => {
      count += 1;
      if (count === 1) return openAICompletion("第一段。");
      controller.abort();
      throw new DOMException("已取消", "AbortError");
    },
  });
  const result = await client.generateReview({
    chunks: CHUNKS,
    aggregateText: "",
    signal: controller.signal,
  });
  assert.equal(result.cancelled, true);
  assert.equal(result.sections.length, 1);
  assert.equal(result.partial, true);
});

test("empty chunk responses fail with a review error", async () => {
  const client = createReviewClient({
    apiKey: "sk-test",
    fetchFn: async () => openAICompletion("   "),
  });
  // generateReview 不抛错：失败记录 failedIndex，保留已完成部分。
  const result = await client.generateReview({ chunks: CHUNKS.slice(0, 1), aggregateText: "" });
  assert.equal(result.failedIndex, 0);
  assert.equal(result.sections.length, 0);
  assert.equal(result.errorCode, "REVIEW_REQUEST_FAILED");
});

test("review records persist and sanitize, keeping AI output apart from traces", () => {
  const storage = memoryStorage();
  let state = readReviewState(storage);
  state = recordReviewPending(state, "doc-1");
  assert.equal(state.records["doc-1"].status, "pending");
  state = recordReviewResult(state, "doc-1", {
    status: "done",
    sections: [{ index: 0, pageStart: 0, pageEnd: 2, text: "第一节" }],
    model: "deepseek-chat",
  });
  writeReviewState(state, storage);

  const reloaded = readReviewState(storage);
  assert.equal(reloaded.records["doc-1"].status, "done");
  assert.equal(reloaded.records["doc-1"].sections[0].text, "第一节");
  assert.equal(reloaded.records["doc-1"].model, "deepseek-chat");
});

test("partial and failed records survive sanitize with their error codes", () => {
  const storage = memoryStorage();
  storage.setItem("pdf-flow-reader:v1:review-state", JSON.stringify({
    schemaVersion: 1,
    records: {
      "doc-1": { status: "partial", sections: [{ index: 0, pageStart: 0, pageEnd: 1, text: "部分" }], errorCode: "REVIEW_TIMEOUT" },
      "doc-2": { status: "weird" },
    },
  }));
  const state = readReviewState(storage);
  assert.deepEqual(Object.keys(state.records), ["doc-1"]);
  assert.equal(state.records["doc-1"].errorCode, "REVIEW_TIMEOUT");
});
