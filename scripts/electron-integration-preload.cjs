const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("__nightStudyIntegration", Object.freeze({
  ping() {
    return ipcRenderer.invoke("night-study:integration-ping");
  },
}));
