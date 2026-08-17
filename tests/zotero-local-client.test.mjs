import test from "node:test";
import assert from "node:assert/strict";

import {
  ZoteroLocalError,
  createZoteroLocalClient,
} from "../zotero-local-client.mjs";

function mockFetch(handler) {
  return async (url, init = {}) => {
    const response = handler(String(url), init);
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      text: async () => JSON.stringify(response.body ?? null),
    };
  };
}

test("probe reports availability from the local api root", async () => {
  const client = createZoteroLocalClient({
    fetchFn: mockFetch((url) => {
      assert.match(url, /^http:\/\/127\.0\.0\.1:23119\/api\/$/);
      return { body: { message: "Zotero API v3" } };
    }),
  });
  const probe = await client.probe();
  assert.equal(probe.available, true);
  assert.equal(probe.message, "Zotero API v3");
});

test("unreachable local api raises a structured error", async () => {
  const client = createZoteroLocalClient({
    fetchFn: async () => {
      throw new Error("ECONNREFUSED");
    },
  });
  await assert.rejects(() => client.probe(), (error) => (
    error instanceof ZoteroLocalError && error.code === "ZOTERO_LOCAL_UNREACHABLE"
  ));
});

test("non-loopback base urls are rejected", () => {
  assert.throws(
    () => createZoteroLocalClient({ baseUrl: "http://example.com:23119" }),
    (error) => error.code === "ZOTERO_LOCAL_UNSAFE_URL",
  );
});

test("matchBook prefers an attachment filename over a title match", async () => {
  const calls = [];
  const client = createZoteroLocalClient({
    fetchFn: mockFetch((url) => {
      calls.push(url);
      if (url.includes("/items/top")) {
        return {
          body: [
            { key: "A1", data: { title: "民主测量", itemType: "journalArticle" } },
            { key: "A2", data: { title: "另一本书", itemType: "book" } },
          ],
        };
      }
      if (url.includes("/A1/children")) {
        return { body: [{ key: "C1", data: { itemType: "attachment", filename: "demo-测量.pdf" } }] };
      }
      return { body: [] };
    }),
  });
  const result = await client.matchBook({ fileName: "demo-测量.pdf", title: "另一本书" });
  assert.equal(result.matched, true);
  assert.equal(result.matchKind, "attachment-filename");
  assert.equal(result.itemKey, "A1");
  assert.equal(result.attachmentKey, "C1");
});

test("matchBook falls back to title when no attachment matches", async () => {
  const client = createZoteroLocalClient({
    fetchFn: mockFetch((url) => {
      if (url.includes("/items/top")) {
        return {
          body: [{ key: "B1", data: { title: "The Measurement Book" } }],
        };
      }
      return { body: [{ key: "C2", data: { itemType: "attachment", filename: "unrelated.pdf" } }] };
    }),
  });
  const result = await client.matchBook({ fileName: "absent.pdf", title: "The Measurement Book" });
  assert.equal(result.matched, true);
  assert.equal(result.matchKind, "title");
  assert.equal(result.itemKey, "B1");
  assert.equal(result.attachmentKey, null);
});

test("matchBook reports no match when nothing aligns", async () => {
  const client = createZoteroLocalClient({
    fetchFn: mockFetch((url) => {
      if (url.includes("/items/top")) {
        return { body: [{ key: "X1", data: { title: "Unrelated" } }] };
      }
      return { body: [] };
    }),
  });
  const result = await client.matchBook({ fileName: "missing.pdf", title: "Nowhere" });
  assert.equal(result.matched, false);
});

test("matchBook requires at least one input", async () => {
  const client = createZoteroLocalClient({ fetchFn: mockFetch(() => ({ body: [] })) });
  await assert.rejects(() => client.matchBook({}), (error) => error.code === "ZOTERO_MATCH_NO_INPUT");
});

test("timeouts surface as a local timeout error", async () => {
  const client = createZoteroLocalClient({
    timeoutMs: 20,
    fetchFn: (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        error.reason = new ZoteroLocalError("超时", "ZOTERO_LOCAL_TIMEOUT");
        reject(error);
      });
    }),
  });
  await assert.rejects(() => client.probe(), (error) => error.code === "ZOTERO_LOCAL_TIMEOUT");
});
