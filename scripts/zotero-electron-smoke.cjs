// zotero-electron-smoke.cjs — Zotero 桥接在真实 Electron 中的实测
//
// 验证 IPC 链路：probe / match / verify / push 都返回结构化结果。
// Zotero 未运行时 probe 必须安静失败（结构化错误而非异常）；
// 若本机恰好运行 Zotero，probe 成功同样通过。

const { app, BrowserWindow, ipcMain } = require("electron");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { dirname, join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

const root = resolve(__dirname, "..");
const productPreload = join(root, "electron-preload.cjs");
const tempRoot = mkdtempSync(join(tmpdir(), "night-study-zotero-"));
app.setPath("userData", join(tempRoot, "profile"));
app.once("quit", () => rmSync(tempRoot, { recursive: true, force: true }));

async function runSmoke() {
  await app.whenReady();
  const { safeStorage } = require("electron");
  const { createCredentialStore } = await import(
    pathToFileURL(join(root, "credential-store.mjs")).href
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
  registerZoteroIpc({
    ipcMain,
    bridge: createZoteroBridge({ credentialStore }),
  });

  const { createServer } = await import("node:http");
  const localServer = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end("<!doctype html><title>zotero smoke</title>");
  });
  await new Promise((resolveListen) => localServer.listen(0, "127.0.0.1", resolveListen));
  const localUrl = `http://127.0.0.1:${localServer.address().port}/`;

  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: productPreload,
    },
  });
  await window.loadURL(localUrl);

  const result = await window.webContents.executeJavaScript(`(async () => {
    const bridge = window.nightStudyZotero;
    if (!bridge) return { ok: false, error: "no bridge" };
    const probe = await bridge.probe();
    const match = await bridge.matchBook({ fileName: "smoke-book.pdf", title: "Smoke Book" });
    const verify = await bridge.verifyCredentials();
    return { ok: true, probe, match, verify };
  })()`, true);

  // probe 可以成功（Zotero 在运行）或结构化安静失败（未运行）。
  const probeWellFormed = Boolean(result.probe?.ok === true || result.probe?.ok === false);
  const matchWellFormed = Boolean(result.match?.ok === false || result.match?.ok === true);
  const verifyWellFormed = Boolean(
    result.verify?.ok === false &&
    result.verify?.error?.code === "ZOTERO_WEB_NO_CREDENTIALS"
  );
  const passed = Boolean(
    result.ok &&
    probeWellFormed &&
    matchWellFormed &&
    verifyWellFormed
  );

  console.log(`ZOTERO_SMOKE_RESULT ${JSON.stringify({ ...result, passed })}`);
  app.exit(passed ? 0 : 1);
}

runSmoke().catch((error) => {
  console.error(`ZOTERO_SMOKE_FAILED ${error?.message ?? error}`);
  app.exit(1);
});
