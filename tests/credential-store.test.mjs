import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CredentialUnavailableError,
  createCredentialStore,
  isValidCredentialId,
} from "../credential-store.mjs";

function fakeSafeStorage({ available = true } = {}) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain) => Buffer.from(`enc:${plain}`, "utf8"),
    decryptString: (buffer) => {
      const text = buffer.toString("utf8");
      if (!text.startsWith("enc:")) throw new Error("bad ciphertext");
      return text.slice(4);
    },
  };
}

function tempStore(options = {}) {
  const directory = mkdtempSync(join(tmpdir(), "credential-store-test-"));
  const store = createCredentialStore({
    filePath: join(directory, "credentials.json"),
    safeStorage: options.safeStorage ?? fakeSafeStorage(),
  });
  return { directory, store, filePath: join(directory, "credentials.json") };
}

test("save and load round-trips a secret through encryption", async () => {
  const { directory, store } = tempStore();
  try {
    await store.save("echo-fast", "sk-secret-value");
    assert.equal(await store.load("echo-fast"), "sk-secret-value");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the on-disk file never contains the plaintext secret", async () => {
  const { directory, store, filePath } = tempStore();
  try {
    await store.save("echo-fast", "sk-plaintext-must-not-leak");
    const raw = readFileSync(filePath, "utf8");
    assert.doesNotMatch(raw, /plaintext-must-not-leak/);
    assert.match(raw, /ciphertext/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("status reports unavailability when safeStorage cannot encrypt", async () => {
  const { directory, store } = tempStore({ safeStorage: fakeSafeStorage({ available: false }) });
  try {
    assert.deepEqual(store.status(), { available: false, reason: "safe-storage-unavailable" });
    await assert.rejects(() => store.save("echo-fast", "sk-any"), CredentialUnavailableError);
    await assert.rejects(() => store.load("echo-fast"), CredentialUnavailableError);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("invalid credential ids are rejected before touching the store", async () => {
  const { directory, store } = tempStore();
  try {
    await assert.rejects(() => store.save("../escape", "sk-any"));
    await assert.rejects(() => store.save("", "sk-any"));
    await assert.rejects(() => store.load("a b"));
    assert.equal(isValidCredentialId("echo-fast"), true);
    assert.equal(isValidCredentialId("echo_fast"), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("empty or oversized secrets are rejected", async () => {
  const { directory, store } = tempStore();
  try {
    await assert.rejects(() => store.save("echo-fast", ""));
    await assert.rejects(() => store.save("echo-fast", "   "));
    await assert.rejects(() => store.save("echo-fast", "x".repeat(2049)));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a corrupt credentials file is quarantined and treated as empty", async () => {
  const { directory, store, filePath } = tempStore();
  try {
    writeFileSync(filePath, "{not json", "utf8");
    assert.equal(await store.load("echo-fast"), null);
    await store.save("echo-fast", "sk-after-corrupt");
    assert.equal(await store.load("echo-fast"), "sk-after-corrupt");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an undecryptable record is dropped and reported as absent", async () => {
  const { directory, store, filePath } = tempStore();
  try {
    await store.save("echo-fast", "sk-original");
    // 模拟系统密钥环境变化：密文无法解密。
    writeFileSync(filePath, JSON.stringify({
      "echo-fast": { ciphertext: Buffer.from("not:encrypted", "utf8").toString("base64"), updatedAt: "2026-08-16T00:00:00.000Z" },
    }), "utf8");
    assert.equal(await store.load("echo-fast"), null);
    assert.deepEqual(await store.list(), []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("remove deletes only the requested id", async () => {
  const { directory, store } = tempStore();
  try {
    await store.save("echo-fast", "sk-fast");
    await store.save("echo-strong", "sk-strong");
    assert.deepEqual((await store.list()).sort(), ["echo-fast", "echo-strong"]);
    assert.deepEqual(await store.remove("echo-fast"), { id: "echo-fast", removed: true });
    assert.deepEqual((await store.list()).sort(), ["echo-strong"]);
    assert.deepEqual(await store.remove("echo-fast"), { id: "echo-fast", removed: false });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
