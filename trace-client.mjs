function unavailableError() {
  const error = new Error("航迹持久化只在桌面版中可用。");
  error.code = "TRACE_DESKTOP_UNAVAILABLE";
  return error;
}

async function unwrap(responsePromise) {
  const response = await responsePromise;
  if (!response?.ok) {
    const error = new Error(response?.error?.message || "Trace operation failed.");
    error.code = response?.error?.code || "TRACE_IPC_FAILED";
    throw error;
  }
  return response.value;
}

export function createTraceClient(bridge = globalThis.nightStudyTrace ?? null) {
  const available = Boolean(
    bridge &&
    typeof bridge.capabilities === "function" &&
    typeof bridge.createDraft === "function"
  );

  const call = (method, args = []) => {
    if (!available) return Promise.reject(unavailableError());
    return unwrap(bridge[method](...args));
  };

  return Object.freeze({
    available,
    capabilities() {
      if (!available) {
        return Promise.resolve({
          available: false,
          schemaVersion: null,
          atomicFilesystem: false,
          browserFallback: false,
        });
      }
      return unwrap(bridge.capabilities());
    },
    registerDocument(input) {
      return call("registerDocument", [input]);
    },
    createDraft(input) {
      return call("createDraft", [input]);
    },
    readTrace(documentId, traceId) {
      return call("readTrace", [documentId, traceId]);
    },
    listTraces(documentId, options) {
      return call("listTraces", [documentId, options]);
    },
    readCrop(documentId, traceId) {
      return call("readCrop", [documentId, traceId]);
    },
    saveCrop(documentId, traceId, bytes, metadata) {
      return call("saveCrop", [documentId, traceId, bytes, metadata]);
    },
    transitionTrace(documentId, traceId, event, options) {
      return call("transitionTrace", [documentId, traceId, event, options]);
    },
    pathForFile(file) {
      if (!available || typeof bridge.pathForFile !== "function") return null;
      return bridge.pathForFile(file);
    },
  });
}
