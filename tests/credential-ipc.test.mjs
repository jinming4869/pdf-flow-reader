import test from "node:test";
import assert from "node:assert/strict";

import { CREDENTIAL_IPC_CHANNELS, registerCredentialIpc } from "../credential-ipc.mjs";

function fakeIpcMain() {
  const handlers = new Map();
  return {
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
    removeHandler(channel) {
      handlers.delete(channel);
    },
    invoke(channel, event, payload) {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`no handler for ${channel}`);
      return handler(event, payload);
    },
    registeredChannels() {
      return [...handlers.keys()];
    },
  };
}

function localEvent(url = "http://127.0.0.1:53201/") {
  return { senderFrame: { url }, sender: { getURL: () => url } };
}

function fakeStore() {
  const records = new Map();
  return {
    status: () => ({ available: true, reason: null }),
    save: async (id, secret) => {
      records.set(id, secret);
      return { id, saved: true };
    },
    load: async (id) => records.get(id) ?? null,
    remove: async (id) => ({ id, removed: records.delete(id) }),
    list: async () => [...records.keys()],
  };
}

test("registers all five credential channels and disposes them", () => {
  const ipcMain = fakeIpcMain();
  const dispose = registerCredentialIpc({ ipcMain, store: fakeStore() });
  assert.deepEqual(ipcMain.registeredChannels().sort(), [
    CREDENTIAL_IPC_CHANNELS.status,
    CREDENTIAL_IPC_CHANNELS.save,
    CREDENTIAL_IPC_CHANNELS.load,
    CREDENTIAL_IPC_CHANNELS.remove,
    CREDENTIAL_IPC_CHANNELS.list,
  ].sort());
  dispose();
  assert.deepEqual(ipcMain.registeredChannels(), []);
});

test("save and load round-trip through the local renderer", async () => {
  const ipcMain = fakeIpcMain();
  registerCredentialIpc({ ipcMain, store: fakeStore() });
  const saved = await ipcMain.invoke(
    CREDENTIAL_IPC_CHANNELS.save,
    localEvent(),
    { id: "echo-fast", secret: "sk-secret" },
  );
  assert.equal(saved.ok, true);
  const loaded = await ipcMain.invoke(
    CREDENTIAL_IPC_CHANNELS.load,
    localEvent(),
    { id: "echo-fast" },
  );
  assert.equal(loaded.ok, true);
  assert.equal(loaded.secret, "sk-secret");
});

test("rejects non-local senders with a stable error code", async () => {
  const ipcMain = fakeIpcMain();
  registerCredentialIpc({ ipcMain, store: fakeStore() });
  const result = await ipcMain.invoke(
    CREDENTIAL_IPC_CHANNELS.load,
    localEvent("https://evil.example.com/"),
    { id: "echo-fast" },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "CREDENTIAL_IPC_UNTRUSTED_SENDER");
});

test("rejects invalid ids without invoking the store", async () => {
  const ipcMain = fakeIpcMain();
  registerCredentialIpc({ ipcMain, store: fakeStore() });
  const result = await ipcMain.invoke(
    CREDENTIAL_IPC_CHANNELS.save,
    localEvent(),
    { id: "not valid!", secret: "sk-secret" },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "CREDENTIAL_INVALID_INPUT");
});

test("public errors never embed the secret value", async () => {
  const ipcMain = fakeIpcMain();
  const store = fakeStore();
  store.save = async () => {
    const error = new Error("store failed");
    error.code = "CREDENTIAL_UNAVAILABLE";
    throw error;
  };
  registerCredentialIpc({ ipcMain, store });
  const result = await ipcMain.invoke(
    CREDENTIAL_IPC_CHANNELS.save,
    localEvent(),
    { id: "echo-fast", secret: "sk-top-secret-marker" },
  );
  assert.equal(result.ok, false);
  assert.doesNotMatch(JSON.stringify(result), /top-secret-marker/);
});
