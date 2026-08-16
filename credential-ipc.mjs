// credential-ipc.mjs — 系统凭据的主进程窄 IPC 注册
//
// 只接受本地阅读 renderer 的调用；id 白名单校验；任何日志与错误消息
// 都不携带凭据值。

import {
  CredentialInvalidInputError,
  CredentialUnavailableError,
  isValidCredentialId,
} from "./credential-store.mjs";

export const CREDENTIAL_IPC_CHANNELS = Object.freeze({
  status: "night-study:credential-status",
  save: "night-study:credential-save",
  load: "night-study:credential-load",
  remove: "night-study:credential-remove",
  list: "night-study:credential-list",
});

function payloadObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function publicError(error) {
  return {
    code: typeof error?.code === "string" ? error.code : "CREDENTIAL_IPC_FAILED",
    message: typeof error?.message === "string"
      ? error.message
      : "Credential operation failed.",
    reason: typeof error?.reason === "string" ? error.reason : null,
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
    const error = new Error("Credential IPC only accepts the local reader renderer.");
    error.code = "CREDENTIAL_IPC_UNTRUSTED_SENDER";
    throw error;
  }
}

function credentialInput(payload) {
  const input = payloadObject(payload);
  const id = typeof input.id === "string" ? input.id : "";
  if (!isValidCredentialId(id)) {
    throw new CredentialInvalidInputError("凭据 id 无效。");
  }
  return { id, secret: input.secret ?? null };
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

export function registerCredentialIpc({ ipcMain, store } = {}) {
  if (!ipcMain?.handle || !ipcMain?.removeHandler) {
    throw new TypeError("registerCredentialIpc 需要 ipcMain.handle/removeHandler。");
  }
  if (!store) throw new TypeError("registerCredentialIpc 需要 store。");

  const handlers = new Map([
    [CREDENTIAL_IPC_CHANNELS.status, handle(async () => store.status())],
    [CREDENTIAL_IPC_CHANNELS.save, handle(async (payload) => {
      const { id, secret } = credentialInput(payload);
      return store.save(id, secret);
    })],
    [CREDENTIAL_IPC_CHANNELS.load, handle(async (payload) => {
      const { id } = credentialInput(payload);
      const secret = await store.load(id);
      return { id, secret };
    })],
    [CREDENTIAL_IPC_CHANNELS.remove, handle(async (payload) => {
      const { id } = credentialInput(payload);
      return store.remove(id);
    })],
    [CREDENTIAL_IPC_CHANNELS.list, handle(async () => ({ ids: await store.list() }))],
  ]);

  for (const [channel, handler] of handlers) {
    ipcMain.handle(channel, handler);
  }

  return function disposeCredentialIpc() {
    for (const channel of handlers.keys()) {
      ipcMain.removeHandler(channel);
    }
  };
}
