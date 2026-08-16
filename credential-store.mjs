// credential-store.mjs — 系统凭据的本地加密存储（主进程模块）
//
// 凭据只进入 Electron safeStorage（macOS Keychain / Windows Credential
// Manager 派生密钥）。加密不可用时明确报错，绝不退回明文写入。
// 本模块不依赖 Electron 模块本身，safeStorage 由调用方注入，便于单测。

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const CREDENTIAL_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export class CredentialUnavailableError extends Error {
  constructor(reason = "safe-storage-unavailable") {
    super(`系统凭据存储不可用：${reason}`);
    this.name = "CredentialUnavailableError";
    this.code = "CREDENTIAL_UNAVAILABLE";
    this.reason = reason;
  }
}

export class CredentialInvalidInputError extends Error {
  constructor(message = "凭据输入无效。") {
    super(message);
    this.name = "CredentialInvalidInputError";
    this.code = "CREDENTIAL_INVALID_INPUT";
  }
}

export function isValidCredentialId(id) {
  return typeof id === "string" && CREDENTIAL_ID_PATTERN.test(id);
}

function validateSecret(secret) {
  if (typeof secret !== "string") {
    throw new CredentialInvalidInputError("凭据必须是字符串。");
  }
  if (!secret.trim() || secret.length > 2048) {
    throw new CredentialInvalidInputError("凭据长度必须在 1 到 2048 字符之间。");
  }
}

function readRecordsFile(filePath) {
  let raw = null;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    // 损坏的文件不静默丢弃：隔离备份后重新开始，避免覆盖用户唯一密文。
    const backup = `${filePath}.corrupt-${Date.now()}`;
    try {
      renameSync(filePath, backup);
    } catch {
      // 备份失败仍继续，密文已损坏无法恢复。
    }
    return {};
  }
}

function writeRecordsFile(filePath, records) {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporary, JSON.stringify(records), { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, filePath);
}

export function createCredentialStore({
  filePath = null,
  safeStorage = null,
  now = () => new Date(),
} = {}) {
  if (!filePath || typeof filePath !== "string") {
    throw new TypeError("createCredentialStore 需要有效的 filePath。");
  }

  function safeStorageAvailable() {
    try {
      return Boolean(safeStorage?.isEncryptionAvailable?.());
    } catch {
      return false;
    }
  }

  function status() {
    if (safeStorageAvailable()) return { available: true, reason: null };
    return { available: false, reason: "safe-storage-unavailable" };
  }

  function readRecords() {
    return readRecordsFile(filePath);
  }

  function writeRecords(records) {
    writeRecordsFile(filePath, records);
  }

  async function save(id, secret) {
    if (!isValidCredentialId(id)) {
      throw new CredentialInvalidInputError("凭据 id 无效。");
    }
    validateSecret(secret);
    if (!safeStorageAvailable()) {
      throw new CredentialUnavailableError();
    }
    const encrypted = safeStorage.encryptString(secret);
    const ciphertext = Buffer.isBuffer(encrypted)
      ? encrypted.toString("base64")
      : String(encrypted);
    const records = readRecords();
    records[id] = {
      ciphertext,
      updatedAt: new Date(now()).toISOString(),
    };
    writeRecords(records);
    return { id, saved: true };
  }

  async function load(id) {
    if (!isValidCredentialId(id)) {
      throw new CredentialInvalidInputError("凭据 id 无效。");
    }
    if (!safeStorageAvailable()) {
      throw new CredentialUnavailableError();
    }
    const record = readRecords()[id];
    if (!record || typeof record.ciphertext !== "string" || !record.ciphertext) {
      return null;
    }
    try {
      const decrypted = safeStorage.decryptString(
        Buffer.from(record.ciphertext, "base64"),
      );
      return typeof decrypted === "string" ? decrypted : null;
    } catch {
      // 系统密钥环境变化（如 Keychain 重置）后密文不可解，视为无凭据，
      // 移除失效记录，避免反复失败。
      const records = readRecords();
      delete records[id];
      writeRecords(records);
      return null;
    }
  }

  async function remove(id) {
    if (!isValidCredentialId(id)) {
      throw new CredentialInvalidInputError("凭据 id 无效。");
    }
    const records = readRecords();
    if (!(id in records)) return { id, removed: false };
    delete records[id];
    writeRecords(records);
    return { id, removed: true };
  }

  async function list() {
    return Object.keys(readRecords());
  }

  return Object.freeze({
    status,
    save,
    load,
    remove,
    list,
  });
}

export const openaiTtsCredentialId = "openai-tts";
