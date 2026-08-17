import test from "node:test";
import assert from "node:assert/strict";

import {
  LSE_FIELDS,
  LseOutputInvalidError,
  LseRequestError,
  createLseClient,
} from "../lse-client.mjs";

function openAICompletion(content) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ choices: [{ message: { content } }] }),
  };
}

const WORKSHEET_JSON = JSON.stringify({
  mainArgument: "作者主张测量效度取决于概念定义。",
  evidence: "跨国比较数据与案例研究。",
  structure: "先定义后测量再比较。",
  limitations: "样本局限与操作化分歧。",
  literatureRelation: "延续 Collier 与 Bollen 之争。",
  openQuestions: "概念分歧能否用数据解决仍未回答。",
});

test("generateWorksheet parses the six official fields", async () => {
  const client = createLseClient({
    apiKey: "sk-test",
    systemText: "lse prompt",
    fetchFn: async (_url, init) => {
      const body = JSON.parse(init.body);
      assert.equal(body.messages[0].content, "lse prompt");
      return openAICompletion(WORKSHEET_JSON);
    },
  });
  const result = await client.generateWorksheet({ reviewText: "分节总结。", aggregateText: "航迹。", });
  assert.deepEqual(Object.keys(result.worksheet).sort(), [...LSE_FIELDS].sort());
  assert.equal(result.worksheet.mainArgument, "作者主张测量效度取决于概念定义。");
});

test("markdown-fenced json is accepted", async () => {
  const client = createLseClient({
    apiKey: "sk-test",
    fetchFn: async () => openAICompletion(`\`\`\`json\n${WORKSHEET_JSON}\n\`\`\``),
  });
  const result = await client.generateWorksheet({ reviewText: "x" });
  assert.equal(Object.keys(result.worksheet).length, 6);
});

test("missing fields are omitted but partial worksheets pass with one field", async () => {
  const client = createLseClient({
    apiKey: "sk-test",
    fetchFn: async () => openAICompletion(JSON.stringify({ mainArgument: "只有一条。" })),
  });
  const result = await client.generateWorksheet({ reviewText: "x" });
  assert.deepEqual(result.fields, ["mainArgument"]);
});

test("non-json or empty outputs are rejected", async () => {
  const broken = createLseClient({
    apiKey: "sk-test",
    fetchFn: async () => openAICompletion("这不是 JSON。"),
  });
  await assert.rejects(() => broken.generateWorksheet({ reviewText: "x" }), LseOutputInvalidError);

  const empty = createLseClient({
    apiKey: "sk-test",
    fetchFn: async () => openAICompletion(JSON.stringify({})),
  });
  await assert.rejects(() => empty.generateWorksheet({ reviewText: "x" }), LseOutputInvalidError);
});

test("empty input is rejected before any request", async () => {
  let calls = 0;
  const client = createLseClient({
    apiKey: "sk-test",
    fetchFn: async () => {
      calls += 1;
      return openAICompletion(WORKSHEET_JSON);
    },
  });
  await assert.rejects(() => client.generateWorksheet({}), LseRequestError);
  assert.equal(calls, 0);
});

test("5xx failures surface with status", async () => {
  const client = createLseClient({
    apiKey: "sk-test",
    fetchFn: async () => ({ ok: false, status: 500, text: async () => "{}" }),
  });
  await assert.rejects(
    () => client.generateWorksheet({ reviewText: "x" }),
    (error) => error.status === 500,
  );
});
