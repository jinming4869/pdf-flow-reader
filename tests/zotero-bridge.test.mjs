import test from "node:test";
import assert from "node:assert/strict";

import { createZoteroBridge } from "../zotero-bridge.mjs";

function fakeCredentialStore(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    load: async (id) => map.get(id) ?? null,
  };
}

function fakeLocal(matchResult) {
  return {
    probe: async () => ({ available: true, message: "Zotero API v3" }),
    matchBook: async () => matchResult,
  };
}

function fakeWeb({ verify = {}, note = { noteKey: "N1", version: 1 }, created = { itemKey: "I1", version: 2 }, upload = { uploaded: true } } = {}) {
  const calls = { verify: 0, note: 0, create: 0, upload: 0 };
  return {
    calls,
    verifyKey: async () => {
      calls.verify += 1;
      return verify;
    },
    createPdfItem: async () => {
      calls.create += 1;
      return created;
    },
    uploadPdf: async () => {
      calls.upload += 1;
      return upload;
    },
    createChildNote: async () => {
      calls.note += 1;
      return note;
    },
  };
}

function bridge({ store, match, web } = {}) {
  return createZoteroBridge({
    credentialStore: store ?? fakeCredentialStore({
      "zotero-api-key": "key",
      "zotero-library-id": "42",
    }),
    localClient: fakeLocal(match ?? { matched: true, matchKind: "title", itemKey: "P1", title: "书", attachmentKey: null }),
    webClientFactory: async () => web ?? fakeWeb(),
  });
}

test("pushBook writes a note onto a matched item without creating or uploading", async () => {
  const web = fakeWeb();
  const zotero = bridge({ web });
  const result = await zotero.pushBook({
    fileName: "书.pdf",
    title: "书",
    pdfBytes: new Uint8Array([1]),
    noteHtml: "<p>一句复述</p>",
  });
  assert.equal(result.ok, true);
  assert.equal(result.matched, true);
  assert.equal(result.itemKey, "P1");
  assert.equal(result.noteKey, "N1");
  assert.equal(result.createdItem, false);
  assert.deepEqual(web.calls, { verify: 0, note: 1, create: 0, upload: 0 });
});

test("pushBook creates an item and uploads the pdf when nothing matches", async () => {
  const web = fakeWeb();
  const zotero = bridge({
    web,
    match: { matched: false, matchKind: null, itemKey: null, title: null, attachmentKey: null },
  });
  const result = await zotero.pushBook({
    fileName: "新书.pdf",
    title: "新书",
    pdfBytes: new Uint8Array([1, 2]),
    noteHtml: "<p>导入的第一条痕迹</p>",
  });
  assert.equal(result.ok, true);
  assert.equal(result.matched, false);
  assert.equal(result.itemKey, "I1");
  assert.equal(result.createdItem, true);
  assert.equal(result.noteKey, "N1");
  assert.deepEqual(web.calls, { verify: 0, note: 1, create: 1, upload: 1 });
});

test("pushBook fails quietly when local matching throws", async () => {
  const zotero = createZoteroBridge({
    credentialStore: fakeCredentialStore({ "zotero-api-key": "key", "zotero-library-id": "42" }),
    localClient: {
      matchBook: async () => {
        throw new Error("boom");
      },
    },
    webClientFactory: async () => fakeWeb(),
  });
  const result = await zotero.pushBook({ fileName: "书.pdf", title: "书", noteHtml: "<p>x</p>" });
  assert.equal(result.ok, false);
  assert.equal(result.stage, "push");
  assert.equal(typeof result.error.code, "string");
});

test("pushBook reports missing web credentials before touching the network", async () => {
  const zotero = createZoteroBridge({
    credentialStore: fakeCredentialStore({}),
    localClient: fakeLocal({ matched: true, matchKind: "title", itemKey: "P1", title: "书", attachmentKey: null }),
  });
  const result = await zotero.pushBook({ fileName: "书.pdf", title: "书", noteHtml: "<p>x</p>" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "ZOTERO_WEB_NO_CREDENTIALS");
});

test("pushBook rejects an empty note before any write", async () => {
  const web = fakeWeb();
  const zotero = bridge({ web });
  const result = await zotero.pushBook({ fileName: "书.pdf", title: "书", noteHtml: "  " });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "ZOTERO_NOTE_EMPTY");
  assert.equal(web.calls.note, 0);
});
