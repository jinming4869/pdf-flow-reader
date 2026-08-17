import test from "node:test";
import assert from "node:assert/strict";

import {
  ZoteroWebError,
  createZoteroWebClient,
} from "../zotero-web-client.mjs";

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

test("verifyKey reports user id and access flags", async () => {
  const client = createZoteroWebClient({
    apiKey: "zot-key",
    libraryId: "12345",
    fetchFn: mockFetch((url, init) => {
      assert.match(url, /api\.zotero\.org\/keys\/current$/);
      assert.equal(init.headers["Zotero-API-Key"], "zot-key");
      return { body: { userID: 12345, access: { user: { library: true, write: true, files: true } } } };
    }),
  });
  const info = await client.verifyKey();
  assert.deepEqual(info, {
    valid: true,
    userID: 12345,
    access: { library: true, write: true, files: true },
  });
});

test("createPdfItem posts a document item and returns the new key", async () => {
  const client = createZoteroWebClient({
    apiKey: "zot-key",
    libraryId: "9",
    fetchFn: mockFetch((url, init) => {
      assert.match(url, /\/users\/9\/items$/);
      const body = JSON.parse(init.body);
      assert.equal(body[0].itemType, "document");
      assert.equal(body[0].title, "测量与效度.pdf");
      return { body: { successful: { "0": { key: "NEWKEY", version: 3 } } } };
    }),
  });
  const created = await client.createPdfItem({ title: "测量与效度.pdf", fileName: "测量与效度.pdf" });
  assert.deepEqual(created, { itemKey: "NEWKEY", version: 3 });
});

test("uploadPdf posts multipart with If-None-Match guard", async () => {
  const client = createZoteroWebClient({
    apiKey: "zot-key",
    libraryId: "9",
    fetchFn: mockFetch((url, init) => {
      assert.match(url, /\/users\/9\/items\/K1\/file$/);
      assert.equal(init.headers["If-None-Match"], "*");
      assert.match(init.headers["Content-Type"], /^multipart\/form-data; boundary=/);
      return { body: { uploaded: 1 } };
    }),
  });
  const result = await client.uploadPdf("K1", new Uint8Array([1, 2, 3]), "书.pdf");
  assert.equal(result.uploaded, true);
});

test("createChildNote posts a note child and returns its key", async () => {
  const client = createZoteroWebClient({
    apiKey: "zot-key",
    libraryId: "9",
    fetchFn: mockFetch((url, init) => {
      assert.match(url, /\/users\/9\/items\/P1\/children$/);
      const body = JSON.parse(init.body);
      assert.equal(body[0].itemType, "note");
      assert.equal(body[0].parentItem, "P1");
      assert.equal(body[0].note, "<p>一句复述</p>");
      return { body: { successful: { "0": { key: "NOTE1", version: 1 } } } };
    }),
  });
  const result = await client.createChildNote("P1", "<p>一句复述</p>");
  assert.deepEqual(result, { noteKey: "NOTE1", version: 1 });
});

test("403 responses surface as forbidden errors", async () => {
  const client = createZoteroWebClient({
    apiKey: "bad-key",
    libraryId: "9",
    fetchFn: mockFetch(() => ({ ok: false, status: 403, body: { message: "Forbidden" } })),
  });
  await assert.rejects(() => client.verifyKey(), (error) => (
    error instanceof ZoteroWebError && error.code === "ZOTERO_WEB_FORBIDDEN" && error.status === 403
  ));
});

test("a failed item creation reports a stable code", async () => {
  const client = createZoteroWebClient({
    apiKey: "zot-key",
    libraryId: "9",
    fetchFn: mockFetch(() => ({ body: { failed: { "0": {} } } })),
  });
  await assert.rejects(() => client.createPdfItem({ title: "书" }), (error) => (
    error.code === "ZOTERO_WEB_CREATE_FAILED"
  ));
});

test("clients require api key and library id", () => {
  assert.throws(() => createZoteroWebClient({ apiKey: "", libraryId: "9" }), TypeError);
  assert.throws(() => createZoteroWebClient({ apiKey: "k", libraryId: "" }), TypeError);
});
