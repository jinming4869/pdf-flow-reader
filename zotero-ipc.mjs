// zotero-ipc.mjs — Zotero 双向连接的主进程窄 IPC 注册

export const ZOTERO_IPC_CHANNELS = Object.freeze({
  probe: "night-study:zotero-probe",
  matchBook: "night-study:zotero-match",
  verifyCredentials: "night-study:zotero-verify",
  pushBook: "night-study:zotero-push",
});

function payloadObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function publicError(error) {
  return {
    code: typeof error?.code === "string" ? error.code : "ZOTERO_IPC_FAILED",
    message: typeof error?.message === "string" ? error.message : "Zotero operation failed.",
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
    const error = new Error("Zotero IPC only accepts the local reader renderer.");
    error.code = "ZOTERO_IPC_UNTRUSTED_SENDER";
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

export function registerZoteroIpc({ ipcMain, bridge } = {}) {
  if (!ipcMain?.handle || !ipcMain?.removeHandler) {
    throw new TypeError("registerZoteroIpc 需要 ipcMain.handle/removeHandler。");
  }
  if (!bridge) throw new TypeError("registerZoteroIpc 需要 bridge。");

  const handlers = new Map([
    [ZOTERO_IPC_CHANNELS.probe, handle(async () => bridge.probe())],
    [ZOTERO_IPC_CHANNELS.matchBook, handle(async (payload) => (
      bridge.matchBook({ fileName: payload.fileName, title: payload.title })
    ))],
    [ZOTERO_IPC_CHANNELS.verifyCredentials, handle(async () => (
      bridge.verifyCredentials()
    ))],
    [ZOTERO_IPC_CHANNELS.pushBook, handle(async (payload) => (
      bridge.pushBook({
        fileName: payload.fileName,
        title: payload.title,
        pdfBytes: payload.pdfBytes?.byteLength ? payload.pdfBytes : null,
        noteHtml: payload.noteHtml,
      })
    ))],
  ]);

  for (const [channel, handler] of handlers) {
    ipcMain.handle(channel, handler);
  }

  return function disposeZoteroIpc() {
    for (const channel of handlers.keys()) {
      ipcMain.removeHandler(channel);
    }
  };
}
