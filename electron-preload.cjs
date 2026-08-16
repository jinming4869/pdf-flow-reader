const { contextBridge, ipcRenderer, webUtils } = require("electron");

const channels = Object.freeze({
  capabilities: "night-study:trace-capabilities",
  registerDocument: "night-study:trace-register-document",
  createDraft: "night-study:trace-create-draft",
  readTrace: "night-study:trace-read",
  listTraces: "night-study:trace-list",
  readCrop: "night-study:trace-read-crop",
  saveCrop: "night-study:trace-save-crop",
  transitionTrace: "night-study:trace-transition",
  credentialStatus: "night-study:credential-status",
  credentialSave: "night-study:credential-save",
  credentialLoad: "night-study:credential-load",
  credentialRemove: "night-study:credential-remove",
  credentialList: "night-study:credential-list",
});

function invoke(channel, payload) {
  // Keep the result as a plain envelope. Electron may discard custom Error
  // properties across contextBridge; the renderer reconstructs its own Error.
  return ipcRenderer.invoke(channel, payload);
}

contextBridge.exposeInMainWorld("nightStudyTrace", Object.freeze({
  capabilities() {
    return invoke(channels.capabilities);
  },
  registerDocument(input) {
    return invoke(channels.registerDocument, input);
  },
  createDraft(input) {
    return invoke(channels.createDraft, input);
  },
  readTrace(documentId, traceId) {
    return invoke(channels.readTrace, { documentId, traceId });
  },
  listTraces(documentId, { includeTrashed = false } = {}) {
    return invoke(channels.listTraces, { documentId, includeTrashed });
  },
  readCrop(documentId, traceId) {
    return invoke(channels.readCrop, { documentId, traceId });
  },
  saveCrop(documentId, traceId, bytes, {
    mimeType,
    width,
    height,
    expectedRevision,
  } = {}) {
    return invoke(channels.saveCrop, {
      documentId,
      traceId,
      bytes,
      mimeType,
      width,
      height,
      expectedRevision,
    });
  },
  transitionTrace(documentId, traceId, event, { expectedRevision } = {}) {
    return invoke(channels.transitionTrace, {
      documentId,
      traceId,
      event,
      expectedRevision,
    });
  },
  pathForFile(file) {
    const path = webUtils.getPathForFile(file);
    return path || null;
  },
}));

contextBridge.exposeInMainWorld("nightStudyCredential", Object.freeze({
  status() {
    return invoke(channels.credentialStatus);
  },
  save(id, secret) {
    return invoke(channels.credentialSave, { id, secret });
  },
  load(id) {
    return invoke(channels.credentialLoad, { id });
  },
  remove(id) {
    return invoke(channels.credentialRemove, { id });
  },
  list() {
    return invoke(channels.credentialList);
  },
}));
