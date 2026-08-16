import test from "node:test";
import assert from "node:assert/strict";

import {
  EchoOutputInvalidError,
  EchoRequestError,
  EchoTimeoutError,
  createEchoClient,
} from "../echo-client.mjs";

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  };
}

function errorResponse(status, message = "boom") {
  return {
    ok: false,
    status,
    text: async () => JSON.stringify({ error: { message } }),
  };
}

function openAICompletion(content) {
  return { choices: [{ message: { content } }] };
}

test("text-only request uses the OpenAI-compatible chat shape", async () => {
  const calls = [];
  const client = createEchoClient({
    apiKey: "sk-test",
    fetchFn: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(openAICompletion("圈选内容在比较两种民主测量。"));
    },
  });
  const result = await client.generateEcho({ text: "圈选的正文内容。" });
  assert.equal(result.text, "圈选内容在比较两种民主测量。");
  assert.equal(result.mode, "text-only");
  assert.match(calls[0].url, /\/chat\/completions$/);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, "deepseek-chat");
  assert.equal(body.messages[0].role, "system");
  assert.equal(typeof body.messages[1].content, "string");
  assert.equal(calls[0].init.headers.Authorization, "Bearer sk-test");
  assert.ok(result.latencyMs >= 0);
});

test("vision-capable client sends image content and records vision mode", async () => {
  const calls = [];
  const client = createEchoClient({
    apiKey: "sk-test",
    vision: true,
    fetchFn: async (_url, init) => {
      calls.push(JSON.parse(init.body));
      return jsonResponse(openAICompletion("图中是情绪坐标的散点。"));
    },
  });
  const result = await client.generateEcho({
    text: "圈选文字。",
    imageBytes: new Uint8Array([1, 2, 3]),
  });
  assert.equal(result.mode, "vision");
  const userMessage = calls[0].messages[1].content;
  assert.ok(Array.isArray(userMessage));
  assert.equal(userMessage[0].type, "text");
  assert.equal(userMessage[1].type, "image_url");
  assert.match(userMessage[1].image_url.url, /^data:image\/png;base64,/);
});

test("a 4xx vision failure falls back to text-only and remembers the capability", async () => {
  const calls = [];
  const client = createEchoClient({
    apiKey: "sk-test",
    vision: true,
    fetchFn: async (_url, init) => {
      const body = JSON.parse(init.body);
      const visionRequest = Array.isArray(body.messages[1].content);
      calls.push({ visionRequest });
      if (visionRequest) return errorResponse(400, "image not supported");
      return jsonResponse(openAICompletion("纯文字复述。"));
    },
  });
  const result = await client.generateEcho({
    text: "圈选文字。",
    imageBytes: new Uint8Array([1]),
  });
  assert.equal(result.mode, "text-only");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].visionRequest, true);
  assert.equal(calls[1].visionRequest, false);
  assert.equal(client.visionKnown, true);
  assert.equal(client.visionSupported, false);

  // 记住降级后，后续请求不再尝试图文。
  const second = await client.generateEcho({
    text: "下一段圈选。",
    imageBytes: new Uint8Array([1]),
  });
  assert.equal(second.mode, "text-only");
  assert.equal(calls.length, 3);
  assert.equal(calls[2].visionRequest, false);
});

test("5xx errors do not trigger a vision fallback", async () => {
  let attempts = 0;
  const client = createEchoClient({
    apiKey: "sk-test",
    fetchFn: async () => {
      attempts += 1;
      return errorResponse(503, "server busy");
    },
  });
  await assert.rejects(
    () => client.generateEcho({ text: "圈选文字。", imageBytes: new Uint8Array([1]) }),
    (error) => error instanceof EchoRequestError && error.status === 503,
  );
  assert.equal(attempts, 1);
});

test("timeouts surface as EchoTimeoutError", async () => {
  const client = createEchoClient({
    apiKey: "sk-test",
    timeoutMs: 30,
    fetchFn: (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }),
  });
  await assert.rejects(
    () => client.generateEcho({ text: "圈选文字。" }),
    EchoTimeoutError,
  );
});

test("empty or oversized outputs are rejected", async () => {
  const emptyClient = createEchoClient({
    apiKey: "sk-test",
    fetchFn: async () => jsonResponse(openAICompletion("   ")),
  });
  await assert.rejects(() => emptyClient.generateEcho({ text: "圈选文字。" }), EchoOutputInvalidError);

  const longClient = createEchoClient({
    apiKey: "sk-test",
    fetchFn: async () => jsonResponse(openAICompletion("长".repeat(500))),
  });
  await assert.rejects(() => longClient.generateEcho({ text: "圈选文字。" }), EchoOutputInvalidError);
});

test("empty circled text is rejected before any network call", async () => {
  let calls = 0;
  const client = createEchoClient({
    apiKey: "sk-test",
    fetchFn: async () => {
      calls += 1;
      return jsonResponse(openAICompletion("x"));
    },
  });
  await assert.rejects(() => client.generateEcho({ text: "  " }), EchoRequestError);
  assert.equal(calls, 0);
});

test("external abort propagates without a timeout disguise", async () => {
  const client = createEchoClient({
    apiKey: "sk-test",
    fetchFn: (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason));
    }),
  });
  const controller = new AbortController();
  const promise = client.generateEcho({ text: "圈选文字。", signal: controller.signal });
  controller.abort(new DOMException("已取消", "AbortError"));
  await assert.rejects(promise, (error) => error?.name === "AbortError");
});
