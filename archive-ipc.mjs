// archive-ipc.mjs — 归档目的地与导出的主进程窄 IPC 注册

import { sanitizeDestinationType } from "./archive-export.mjs";

export const ARCHIVE_IPC_CHANNELS = Object.freeze({
  status: "night-study:archive-status",
  setDestination: "night-study:archive-set-destination",
  clearDestination: "night-study:archive-clear-destination",
  exportTrace: "night-study:archive-export-trace",
  enqueue: "night-study:archive-enqueue",
  retryFailed: "night-study:archive-retry-failed",
});

function payloadObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function publicError(error) {
  return {
    code: typeof error?.code === "string" ? error.code : "ARCHIVE_IPC_FAILED",
    message: typeof error?.message === "string" ? error.message : "Archive operation failed.",
  };
}

function assertTrustedSender(event) {
  const source = event?.senderFrame?.url || event?.sender?.getURL?.() || "";
  let url = null;
  try {
    url = new URL(source);
  } catch {
    // Rejected below with one stable public error code.
  }
  if (!url || url.protocol !== "http:" || url.hostname !== "127.0.0.1") {
    const error = new Error("Archive IPC only accepts the local reader renderer.");
    error.code = "ARCHIVE_IPC_UNTRUSTED_SENDER";
    throw error;
  }
}

function handle(handler) {
  return async (event, payload) => {
    try {
      assertTrustedSender(event);
      return { ok: true, ...(await handler(payloadObject(payload))) };
    } catch (error) {
      return { ok: false, error: publicError(error) };
    }
  };
}

export function registerArchiveIpc({ ipcMain, repository } = {}) {
  if (!ipcMain?.handle || !ipcMain?.removeHandler) {
    throw new TypeError("registerArchiveIpc 需要 ipcMain.handle/removeHandler。");
  }
  if (!repository) throw new TypeError("registerArchiveIpc 需要 repository。");

  const handlers = new Map([
    [ARCHIVE_IPC_CHANNELS.status, handle(async () => ({
      destination: repository.destination(),
      queue: repository.queueSnapshot(),
    }))],
    [ARCHIVE_IPC_CHANNELS.setDestination, handle(async (payload) => {
      const type = sanitizeDestinationType(payload.type);
      if (!type || typeof payload.path !== "string" || !payload.path) {
        const error = new Error("归档目的地无效。");
        error.code = "ARCHIVE_INVALID_DESTINATION";
        throw error;
      }
      return repository.setDestination({ type, path: payload.path });
    })],
    [ARCHIVE_IPC_CHANNELS.clearDestination, handle(async () => (
      repository.clearDestination()
    ))],
    [ARCHIVE_IPC_CHANNELS.exportTrace, handle(async (payload) => {
      const trace = payload.trace && typeof payload.trace === "object" ? payload.trace : null;
      const result = repository.exportTrace({
        trace,
        documentName: typeof payload.documentName === "string" ? payload.documentName : "",
        echoText: typeof payload.echoText === "string" ? payload.echoText : "",
        cropBytes: payload.cropBytes?.byteLength ? payload.cropBytes : null,
      });
      return result;
    })],
    [ARCHIVE_IPC_CHANNELS.enqueue, handle(async (payload) => (
      repository.enqueue({
        traceId: payload.traceId,
        documentName: payload.documentName,
        echoText: payload.echoText,
      })
    ))],
    [ARCHIVE_IPC_CHANNELS.retryFailed, handle(async () => (
      repository.retryFailed()
    ))],
  ]);

  for (const [channel, handler] of handlers) {
    ipcMain.handle(channel, handler);
  }

  return function disposeArchiveIpc() {
    for (const channel of handlers.keys()) {
      ipcMain.removeHandler(channel);
    }
  };
}
