import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  TRACE_IPC_CHANNELS,
  registerTraceIpc,
} from "../trace-ipc.mjs";

class FakeIpcMain {
  constructor() {
    this.handlers = new Map();
  }

  handle(channel, handler) {
    if (this.handlers.has(channel)) throw new Error(`duplicate channel: ${channel}`);
    this.handlers.set(channel, handler);
  }

  removeHandler(channel) {
    this.handlers.delete(channel);
  }

  async invoke(channel, payload, event = {
    senderFrame: { url: "http://127.0.0.1:43123/" },
  }) {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error(`missing handler: ${channel}`);
    const response = await handler(event, payload);
    if (response?.ok === false) {
      const error = new Error(response.error.message);
      error.code = response.error.code;
      throw error;
    }
    return response?.ok === true ? response.value : response;
  }
}

test("trace IPC registers an allowlisted facade and disposes every handler", async () => {
  const ipcMain = new FakeIpcMain();
  const calls = [];
  const repository = {
    async registerDocument(payload) { calls.push(["register", payload]); return { id: payload.id }; },
    async createDraft(payload) { calls.push(["create", payload]); return { id: payload.id, revision: 1 }; },
    async readTrace(documentId, traceId) { calls.push(["read", documentId, traceId]); return { id: traceId }; },
    async listTraces(documentId, options) { calls.push(["list", documentId, options]); return []; },
    async readCrop(documentId, traceId) {
      calls.push(["read-crop", documentId, traceId]);
      return { mimeType: "image/png", width: 10, height: 10, bytes: Uint8Array.from([1]) };
    },
    async saveCrop(documentId, traceId, bytes, metadata, options) {
      calls.push(["crop", documentId, traceId, bytes, metadata, options]);
      return { id: traceId, crop: { state: "ready" }, revision: 2 };
    },
    async transitionTrace(documentId, traceId, event, options) {
      calls.push(["transition", documentId, traceId, event, options]);
      return { id: traceId, revision: 2 };
    },
  };

  const dispose = registerTraceIpc({ ipcMain, repository });
  assert.deepEqual([...ipcMain.handlers.keys()].sort(), Object.values(TRACE_IPC_CHANNELS).sort());
  assert.deepEqual(await ipcMain.invoke(TRACE_IPC_CHANNELS.capabilities), {
    schemaVersion: 1,
    atomicFilesystem: true,
    browserFallback: false,
  });
  assert.deepEqual(await ipcMain.invoke(TRACE_IPC_CHANNELS.registerDocument, { id: "doc-a" }), { id: "doc-a" });
  assert.deepEqual(await ipcMain.invoke(TRACE_IPC_CHANNELS.createDraft, { id: "trace-a" }), {
    id: "trace-a",
    revision: 1,
  });
  assert.deepEqual(await ipcMain.invoke(TRACE_IPC_CHANNELS.readTrace, {
    documentId: "doc-a",
    traceId: "trace-a",
  }), { id: "trace-a" });
  assert.deepEqual(await ipcMain.invoke(TRACE_IPC_CHANNELS.listTraces, {
    documentId: "doc-a",
    includeTrashed: true,
  }), []);
  assert.deepEqual(await ipcMain.invoke(TRACE_IPC_CHANNELS.readCrop, {
    documentId: "doc-a",
    traceId: "trace-a",
  }), { mimeType: "image/png", width: 10, height: 10, bytes: Uint8Array.from([1]) });
  assert.deepEqual(await ipcMain.invoke(TRACE_IPC_CHANNELS.saveCrop, {
    documentId: "doc-a",
    traceId: "trace-a",
    bytes: Uint8Array.from([137, 80, 78, 71]),
    mimeType: "image/png",
    width: 10,
    height: 10,
    expectedRevision: 1,
  }), { id: "trace-a", crop: { state: "ready" }, revision: 2 });
  assert.deepEqual(await ipcMain.invoke(TRACE_IPC_CHANNELS.transitionTrace, {
    documentId: "doc-a",
    traceId: "trace-a",
    event: { type: "CROP_FAILED", errorCode: "X" },
    expectedRevision: 1,
  }), { id: "trace-a", revision: 2 });
  assert.equal(calls.length, 7);

  await assert.rejects(
    ipcMain.invoke(
      TRACE_IPC_CHANNELS.capabilities,
      undefined,
      { senderFrame: { url: "https://untrusted.example/" } },
    ),
    { code: "TRACE_IPC_UNTRUSTED_SENDER" },
  );

  dispose();
  assert.equal(ipcMain.handlers.size, 0);
});

test("production preload exposes narrow trace methods without raw ipcRenderer", () => {
  const preload = readFileSync(new URL("../electron-preload.cjs", import.meta.url), "utf8");
  assert.match(preload, /contextBridge\.exposeInMainWorld\("nightStudyTrace"/);
  for (const method of [
    "capabilities",
    "registerDocument",
    "createDraft",
    "readTrace",
    "listTraces",
    "readCrop",
    "saveCrop",
    "transitionTrace",
    "pathForFile",
  ]) {
    assert.match(preload, new RegExp(`${method}\\s*\\(`), method);
  }
  assert.match(preload, /webUtils\.getPathForFile/);
  assert.doesNotMatch(preload, /exposeInMainWorld\([^\n]+ipcRenderer/);
});

test("desktop package includes product repository and preload but not arbitrary trace HTTP routes", () => {
  const packageJson = JSON.parse(readFileSync(
    new URL("../package.json", import.meta.url),
    "utf8",
  ));
  for (const filename of ["electron-preload.cjs", "trace-ipc.mjs", "trace-repository.mjs"]) {
    assert.ok(packageJson.build.files.includes(filename), filename);
  }

  const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(server, /trace-repository\.mjs/);
  assert.doesNotMatch(server, /electron-preload\.cjs/);

  const main = readFileSync(new URL("../electron-main.mjs", import.meta.url), "utf8");
  assert.match(main, /createTraceRepository/);
  assert.match(main, /registerTraceIpc/);
  assert.match(main, /preload:\s*join\(appRoot,\s*["']electron-preload\.cjs["']\)/);
});
