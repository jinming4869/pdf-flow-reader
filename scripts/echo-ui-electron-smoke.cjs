// echo-ui-electron-smoke.cjs — v5.1 回声／归档界面的真实 Electron 实测
//
// 加载完整阅读器（本地 server + product preload），验证：
// 1. 航迹面板的“回声／归档”入口打开面板；
// 2. 未配置 AI 时安静状态说明；
// 3. 归档状态读取（无 bridge 时提示桌面版）；
// 4. 配置表单保存后状态更新。

const { app, BrowserWindow } = require("electron");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { dirname, join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

const root = resolve(__dirname, "..");
const productPreload = join(root, "electron-preload.cjs");
const pdfPath = process.env.SMOKE_PDF_PATH || null;
const tempRoot = mkdtempSync(join(tmpdir(), "night-study-echo-ui-"));
app.setPath("userData", join(tempRoot, "profile"));
app.once("quit", () => rmSync(tempRoot, { recursive: true, force: true }));

async function runSmoke() {
  await app.whenReady();
  const { safeStorage } = require("electron");
  const { createCredentialStore } = await import(
    pathToFileURL(join(root, "credential-store.mjs")).href
  );
  const { registerCredentialIpc } = await import(
    pathToFileURL(join(root, "credential-ipc.mjs")).href
  );
  const { createArchiveRepository } = await import(
    pathToFileURL(join(root, "archive-repository.mjs")).href
  );
  const { registerArchiveIpc } = await import(
    pathToFileURL(join(root, "archive-ipc.mjs")).href
  );
  const { ipcMain } = require("electron");
  registerCredentialIpc({
    ipcMain,
    store: createCredentialStore({
      filePath: join(app.getPath("userData"), "credentials.json"),
      safeStorage,
    }),
  });
  registerArchiveIpc({
    ipcMain,
    repository: createArchiveRepository({
      configPath: join(app.getPath("userData"), "archive-config.json"),
      queuePath: join(app.getPath("userData"), "archive-queue.json"),
    }),
  });

  const { createReaderServer } = await import(
    pathToFileURL(join(root, "server.mjs")).href
  );
  const server = createReaderServer({ pdfPath });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const url = `http://127.0.0.1:${server.address().port}/`;

  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: productPreload,
    },
  });
  await window.loadURL(url);

  const result = await window.webContents.executeJavaScript(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 80; i += 1) {
      if (document.querySelectorAll("canvas.page-canvas").length > 0) break;
      await wait(100);
    }
    const canvasCount = document.querySelectorAll("canvas.page-canvas").length;
    const errorText = document.querySelector("#errorText")?.textContent ?? "";
    const errorHidden = document.querySelector("#errorPanel")?.hidden ?? true;
    const emptyVisible = document.querySelector("#emptyState") && !document.querySelector("#emptyState").hidden;
    const title = document.title;
    const traceBookButton = document.querySelector("#traceBookButton");
    traceBookButton?.click();
    await wait(250);
    const echoEntry = document.querySelector("#bookTraceEchoArchive");
    const entryExists = Boolean(echoEntry);
    echoEntry?.click();
    await wait(250);
    const panel = document.querySelector("#echoArchivePanel");
    const panelOpen = Boolean(panel && panel.hidden === false);
    const aiStatus = document.querySelector("#echoAiStatus")?.textContent ?? "";
    const archiveStatus = document.querySelector("#archiveStatus")?.textContent ?? "";
    const baseUrl = document.querySelector("#echoBaseUrlInput");
    const model = document.querySelector("#echoModelInput");
    baseUrl.value = "https://api.deepseek.com";
    model.value = "deepseek-chat";
    document.querySelector("#echoSaveConfig")?.click();
    await wait(200);
    const aiStatusAfter = document.querySelector("#echoAiStatus")?.textContent ?? "";
    document.querySelector("#echoArchiveClose")?.click();
    await wait(150);
    const panelClosed = panel.hidden === true;
    return {
      canvasCount,
      title,
      errorText,
      errorHidden,
      emptyVisible,
      entryExists,
      panelOpen,
      panelClosed,
      aiStatus,
      archiveStatus,
      aiStatusAfter,
    };
  })()`, true);

  const passed = Boolean(
    result.canvasCount > 0 &&
    result.entryExists &&
    result.panelOpen &&
    result.panelClosed &&
    result.aiStatus.includes("未配置") &&
    result.aiStatusAfter.includes("未配置") &&
    result.archiveStatus.includes("未配置")
  );

  console.log(`ECHO_UI_SMOKE_RESULT ${JSON.stringify({ ...result, passed })}`);
  app.exit(passed ? 0 : 1);
}

runSmoke().catch((error) => {
  console.error(`ECHO_UI_SMOKE_FAILED ${error?.message ?? error}`);
  app.exit(1);
});
