import assert from "node:assert/strict";
import test from "node:test";

import { createTraceClient } from "../trace-client.mjs";

function success(value) {
  return Promise.resolve({ ok: true, value });
}

test("renderer trace client unwraps successful desktop envelopes", async () => {
  const bridge = {
    capabilities: () => success({ schemaVersion: 1, atomicFilesystem: true }),
    registerDocument: (input) => success({ ...input, registered: true }),
    createDraft: (input) => success({ ...input, revision: 1 }),
    readTrace: (_documentId, traceId) => success({ id: traceId }),
    listTraces: () => success([{ id: "trace-1" }]),
    transitionTrace: (_documentId, traceId) => success({ id: traceId, revision: 2 }),
    pathForFile: () => "/books/A.pdf",
  };
  const client = createTraceClient(bridge);

  assert.equal(client.available, true);
  assert.deepEqual(await client.capabilities(), { schemaVersion: 1, atomicFilesystem: true });
  assert.equal((await client.registerDocument({ id: "doc-a" })).registered, true);
  assert.equal((await client.createDraft({ id: "trace-a" })).revision, 1);
  assert.equal((await client.readTrace("doc-a", "trace-a")).id, "trace-a");
  assert.equal((await client.listTraces("doc-a")).length, 1);
  assert.equal((await client.transitionTrace("doc-a", "trace-a", { type: "TRASH" })).revision, 2);
  assert.equal(client.pathForFile({}), "/books/A.pdf");
});

test("renderer trace client reconstructs stable public error codes", async () => {
  const bridge = {
    capabilities: () => Promise.resolve({
      ok: false,
      error: { code: "TRACE_REVISION_CONFLICT", message: "stale revision" },
    }),
    createDraft: () => success(null),
  };
  const client = createTraceClient(bridge);

  await assert.rejects(client.capabilities(), {
    code: "TRACE_REVISION_CONFLICT",
    message: "stale revision",
  });
});

test("browser mode reports unavailable without inventing a persistence fallback", async () => {
  const client = createTraceClient(null);
  assert.equal(client.available, false);
  assert.deepEqual(await client.capabilities(), {
    available: false,
    schemaVersion: null,
    atomicFilesystem: false,
    browserFallback: false,
  });
  await assert.rejects(client.createDraft({}), { code: "TRACE_DESKTOP_UNAVAILABLE" });
  assert.equal(client.pathForFile({}), null);
});
