import { READING_TRACE_SCHEMA_VERSION } from "./reading-trace.mjs";

export const TRACE_IPC_CHANNELS = Object.freeze({
  capabilities: "night-study:trace-capabilities",
  registerDocument: "night-study:trace-register-document",
  createDraft: "night-study:trace-create-draft",
  readTrace: "night-study:trace-read",
  listTraces: "night-study:trace-list",
  transitionTrace: "night-study:trace-transition",
});

function payloadObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function publicError(error) {
  return {
    code: typeof error?.code === "string" ? error.code : "TRACE_IPC_FAILED",
    message: typeof error?.message === "string" ? error.message : "Trace operation failed.",
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
    const error = new Error("Trace IPC only accepts the local reader renderer.");
    error.code = "TRACE_IPC_UNTRUSTED_SENDER";
    throw error;
  }
}

export function registerTraceIpc({ ipcMain, repository } = {}) {
  if (!ipcMain?.handle || !ipcMain?.removeHandler) {
    throw new TypeError("registerTraceIpc 需要 ipcMain.handle/removeHandler。");
  }
  if (!repository) throw new TypeError("registerTraceIpc 需要 repository。");

  const handlers = new Map([
    [TRACE_IPC_CHANNELS.capabilities, async () => ({
      schemaVersion: READING_TRACE_SCHEMA_VERSION,
      atomicFilesystem: true,
      browserFallback: false,
    })],
    [TRACE_IPC_CHANNELS.registerDocument, async (_event, payload) => (
      repository.registerDocument(payloadObject(payload))
    )],
    [TRACE_IPC_CHANNELS.createDraft, async (_event, payload) => (
      repository.createDraft(payloadObject(payload))
    )],
    [TRACE_IPC_CHANNELS.readTrace, async (_event, payload) => {
      const input = payloadObject(payload);
      return repository.readTrace(input.documentId, input.traceId);
    }],
    [TRACE_IPC_CHANNELS.listTraces, async (_event, payload) => {
      const input = payloadObject(payload);
      return repository.listTraces(input.documentId, {
        includeTrashed: input.includeTrashed === true,
      });
    }],
    [TRACE_IPC_CHANNELS.transitionTrace, async (_event, payload) => {
      const input = payloadObject(payload);
      return repository.transitionTrace(
        input.documentId,
        input.traceId,
        payloadObject(input.event),
        { expectedRevision: input.expectedRevision },
      );
    }],
  ]);

  for (const [channel, handler] of handlers) {
    ipcMain.handle(channel, async (event, payload) => {
      assertTrustedSender(event);
      try {
        return { ok: true, value: await handler(event, payload) };
      } catch (error) {
        return { ok: false, error: publicError(error) };
      }
    });
  }
  return () => {
    for (const channel of handlers.keys()) ipcMain.removeHandler(channel);
  };
}
