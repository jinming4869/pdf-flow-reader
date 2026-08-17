// review-ui-electron-smoke.cjs — v5.2 回望面板与强分析配置的真实 Electron 实测
//
// 验证：回望入口打开面板、授权清单显示发送规模、未配置强分析时
// 安静禁用、Zotero 状态刷新（本机 Zotero 在运行时显示运行中）。

const { app, BrowserWindow, ipcMain } = require("electron");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { dirname, join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

const root = resolve(__dirname, "..");
const productPreload = join(root, "electron-preload.cjs");
const pdfPath = process.env.SMOKE_PDF_PATH || null;
const tempRoot = mkdtempSync(join(tmpdir(), "night-study-review-ui-"));
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
  const { createZoteroBridge } = await import(
    pathToFileURL(join(root, "zotero-bridge.mjs")).href
  );
  const { registerZoteroIpc } = await import(
    pathToFileURL(join(root, "zotero-ipc.mjs")).href
  );
  const credentialStore = createCredentialStore({
    filePath: join(app.getPath("userData"), "credentials.json"),
    safeStorage,
  });
  registerCredentialIpc({ ipcMain, store: credentialStore });
  registerZoteroIpc({ ipcMain, bridge: createZoteroBridge({ credentialStore }) });

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
    const reviewButton = document.querySelector("#bookTraceReview");
    const reviewButtonExists = Boolean(reviewButton);
    reviewButton?.click();
    await wait(600);
    const panel = document.querySelector("#reviewPanel");
    const panelOpen = Boolean(panel && panel.hidden === false);
    const consentSummary = document.querySelector("#reviewConsentSummary")?.textContent ?? "";
    const consentShown = consentSummary.includes("发送内容");
    document.querySelector("#reviewClose")?.click();
    await wait(150);
    const panelClosed = panel.hidden === true;

    // 强分析未配置状态（打开回声／归档面板）。
    document.querySelector("#bookTraceEchoArchive")?.click();
    await wait(250);
    const strongStatus = document.querySelector("#strongAiStatus")?.textContent ?? "";
    document.querySelector("#echoArchiveClose")?.click();
    await wait(150);

    // Zotero 状态刷新。
    document.querySelector("#bookTraceEchoArchive")?.click();
    await wait(200);
    document.querySelector("#zoteroRefreshStatus")?.click();
    await wait(1200);
    const zoteroStatus = document.querySelector("#zoteroStatus")?.textContent ?? "";
    document.querySelector("#echoArchiveClose")?.click();

    return {
      canvasCount,
      reviewButtonExists,
      panelOpen,
      panelClosed,
      consentSummary,
      consentShown,
      strongStatus,
      zoteroStatus,
    };
  })()`, true);

  const passed = Boolean(
    result.canvasCount > 0 &&
    result.reviewButtonExists &&
    result.panelOpen &&
    result.panelClosed &&
    result.consentShown &&
    result.strongStatus.includes("未配置") &&
    result.zoteroStatus.length > 0
  );

  console.log(`REVIEW_UI_SMOKE_RESULT ${JSON.stringify({ ...result, passed })}`);
  app.exit(passed ? 0 : 1);
}

runSmoke().catch((error) => {
  console.error(`REVIEW_UI_SMOKE_FAILED ${error?.message ?? error}`);
  app.exit(1);
});
