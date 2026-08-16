// archive-repository.mjs — 归档目的地配置与导出队列（主进程模块）
//
// 规则（v5.1 冻结需求 §4）：
// - 每本书一个主要目的地；更改目的地只影响新痕迹。
// - 重新导出全部幂等：内容相同的已导出文件跳过，不覆盖。
// - 不删除、不改写旧目的地内容（内容哈希进文件名）。
// - 导出队列持久化，自动重试有界（最多 3 次），失败可见。

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  exportFileStemForTrace,
  renderTraceMarkdown,
  sanitizeDestinationType,
} from "./archive-export.mjs";

export const ARCHIVE_MAX_ATTEMPTS = 3;

const CONFIG_SCHEMA_VERSION = 1;
const QUEUE_SCHEMA_VERSION = 1;

function nowIso(now = new Date()) {
  return now instanceof Date ? now.toISOString() : new Date(now).toISOString();
}

function readJsonFile(filePath, fallback) {
  let raw = null;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    const backup = `${filePath}.corrupt-${Date.now()}`;
    try {
      renameSync(filePath, backup);
    } catch {
      // 备份失败仍继续。
    }
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporary, JSON.stringify(value), { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, filePath);
}

function sanitizeConfig(value, now = new Date()) {
  const destination = value?.destination && typeof value.destination === "object"
    ? value.destination
    : null;
  const type = sanitizeDestinationType(destination?.type);
  const path = type && typeof destination?.path === "string" && destination.path
    ? destination.path
    : null;
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    updatedAt: nowIso(now),
    destination: type && path ? { type, path } : null,
  };
}

function sanitizeQueue(value, now = new Date()) {
  const entries = [];
  if (Array.isArray(value?.entries)) {
    for (const entry of value.entries) {
      if (!entry || typeof entry !== "object") continue;
      if (typeof entry.traceId !== "string" || !entry.traceId) continue;
      const attempts = Number.isFinite(Number(entry.attempts))
        ? Math.max(0, Math.min(ARCHIVE_MAX_ATTEMPTS, Math.round(Number(entry.attempts))))
        : 0;
      entries.push({
        traceId: entry.traceId,
        documentName: typeof entry.documentName === "string" ? entry.documentName : "",
        echoText: typeof entry.echoText === "string" ? entry.echoText : "",
        attempts,
        lastError: typeof entry.lastError === "string" ? entry.lastError : null,
        queuedAt: typeof entry.queuedAt === "string" ? entry.queuedAt : nowIso(now),
      });
    }
  }
  return {
    schemaVersion: QUEUE_SCHEMA_VERSION,
    updatedAt: nowIso(now),
    entries,
  };
}

function sanitizeDocumentDirectoryName(value = "") {
  const name = String(value ?? "").trim()
    .replace(/[\\/:*?"<>|]/gu, "-")
    .replace(/-{2,}/gu, "-")
    .replace(/\s+/gu, " ")
    .slice(0, 80);
  return name || "未命名 PDF";
}

export function createArchiveRepository({
  configPath = null,
  queuePath = null,
  now = () => new Date(),
} = {}) {
  if (!configPath || !queuePath) {
    throw new TypeError("createArchiveRepository 需要 configPath 与 queuePath。");
  }

  function readConfig() {
    return sanitizeConfig(readJsonFile(configPath, {}), now());
  }

  function writeConfig(config) {
    writeJsonFile(configPath, sanitizeConfig(config, now()));
  }

  function readQueue() {
    return sanitizeQueue(readJsonFile(queuePath, {}), now());
  }

  function writeQueue(queue) {
    writeJsonFile(queuePath, sanitizeQueue(queue, now()));
  }

  function destination() {
    return readConfig().destination;
  }

  function setDestination({ type, path } = {}) {
    const normalizedType = sanitizeDestinationType(type);
    if (!normalizedType || typeof path !== "string" || !path) {
      throw new TypeError("setDestination 需要有效的 type 与 path。");
    }
    const config = readConfig();
    config.destination = { type: normalizedType, path };
    config.updatedAt = nowIso(now());
    writeConfig(config);
    return { destination: config.destination };
  }

  function clearDestination() {
    const config = readConfig();
    config.destination = null;
    config.updatedAt = nowIso(now());
    writeConfig(config);
    return { destination: null };
  }

  function documentDirectory(destination, documentName) {
    const base = destination?.path;
    if (typeof base !== "string" || !base) {
      throw new Error("归档目的地未配置。");
    }
    return join(base, sanitizeDocumentDirectoryName(documentName));
  }

  function writeTraceFiles({ destination, trace, documentName, echoText, cropBytes }) {
    const directory = documentDirectory(destination, documentName);
    mkdirSync(directory, { recursive: true });
    const stem = exportFileStemForTrace(trace, echoText, now());
    const markdownPath = join(directory, `${stem}.md`);

    if (existsSync(markdownPath)) {
      return { status: "skipped", filePath: markdownPath };
    }

    let imageName = "";
    if (cropBytes?.byteLength) {
      imageName = `${stem}.png`;
      const imagePath = join(directory, imageName);
      const imageTemporary = `${imagePath}.tmp-${process.pid}-${Date.now()}`;
      writeFileSync(imageTemporary, cropBytes);
      renameSync(imageTemporary, imagePath);
    }

    const markdown = renderTraceMarkdown({
      trace,
      documentName,
      echoText,
      imageName,
      format: destination.type === "obsidian" ? "obsidian" : "folder",
    });
    const markdownTemporary = `${markdownPath}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(markdownTemporary, markdown, { encoding: "utf8" });
    renameSync(markdownTemporary, markdownPath);

    return { status: "written", filePath: markdownPath };
  }

  function exportTrace({ trace, documentName = "", echoText = "", cropBytes = null } = {}) {
    const destination = readConfig().destination;
    if (!destination) {
      const error = new Error("归档目的地未配置。");
      error.code = "ARCHIVE_NO_DESTINATION";
      throw error;
    }
    if (!trace || typeof trace.id !== "string") {
      throw new TypeError("exportTrace 需要有效的 trace。");
    }
    return writeTraceFiles({ destination, trace, documentName, echoText, cropBytes });
  }

  function enqueue({ traceId, documentName = "", echoText = "" } = {}) {
    if (typeof traceId !== "string" || !traceId) {
      throw new TypeError("enqueue 需要 traceId。");
    }
    const queue = readQueue();
    const existing = queue.entries.find((entry) => entry.traceId === traceId);
    const entry = {
      traceId,
      documentName: String(documentName),
      echoText: String(echoText),
      attempts: existing?.attempts ?? 0,
      lastError: null,
      queuedAt: existing?.queuedAt ?? nowIso(now()),
    };
    queue.entries = queue.entries
      .filter((candidate) => candidate.traceId !== traceId)
      .concat(entry);
    queue.updatedAt = nowIso(now());
    writeQueue(queue);
    return { queued: true, traceId };
  }

  function dequeueOne() {
    const queue = readQueue();
    const entry = queue.entries.find((candidate) => candidate.attempts < ARCHIVE_MAX_ATTEMPTS);
    if (!entry) return null;
    queue.entries = queue.entries.filter((candidate) => candidate.traceId !== entry.traceId);
    writeQueue(queue);
    return entry;
  }

  function requeue(entry, errorMessage) {
    const queue = readQueue();
    queue.entries = queue.entries
      .filter((candidate) => candidate.traceId !== entry.traceId)
      .concat({
        ...entry,
        attempts: Math.min(ARCHIVE_MAX_ATTEMPTS, (entry?.attempts ?? 0) + 1),
        lastError: typeof errorMessage === "string" ? errorMessage : String(errorMessage),
        queuedAt: entry?.queuedAt ?? nowIso(now()),
      });
    queue.updatedAt = nowIso(now());
    writeQueue(queue);
  }

  function failedEntries() {
    return readQueue().entries.filter((entry) => entry.attempts >= ARCHIVE_MAX_ATTEMPTS);
  }

  function retryFailed() {
    const queue = readQueue();
    for (const entry of queue.entries) {
      if (entry.attempts >= ARCHIVE_MAX_ATTEMPTS) {
        entry.attempts = 0;
        entry.lastError = null;
      }
    }
    queue.updatedAt = nowIso(now());
    writeQueue(queue);
    return { reset: true };
  }

  function queueSnapshot() {
    const queue = readQueue();
    return {
      pending: queue.entries.filter((entry) => entry.attempts < ARCHIVE_MAX_ATTEMPTS),
      failed: queue.entries.filter((entry) => entry.attempts >= ARCHIVE_MAX_ATTEMPTS),
    };
  }

  return Object.freeze({
    destination,
    setDestination,
    clearDestination,
    exportTrace,
    enqueue,
    dequeueOne,
    requeue,
    retryFailed,
    queueSnapshot,
    config: readConfig,
  });
}
