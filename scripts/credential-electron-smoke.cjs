// credential-electron-smoke.cjs — 系统凭据在真实 Electron 环境中的实测
//
// 验证 safeStorage 可用性、save/load/remove 往返、落盘密文不含明文。
// 开发模式（未签名）与 packaged 二进制下都应通过。

const { app, BrowserWindow, ipcMain, safeStorage } = require("electron");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { dirname, join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

const root = resolve(__dirname, "..");
const productPreload = join(root, "electron-preload.cjs");
const tempRoot = mkdtempSync(join(tmpdir(), "night-study-credential-"));
app.setPath("userData", join(tempRoot, "profile"));
app.once("quit", () => rmSync(tempRoot, { recursive: true, force: true }));

async function registerCredentialSide() {
  const { createCredentialStore } = await import(
    pathToFileURL(join(root, "credential-store.mjs")).href
  );
  const { registerCredentialIpc } = await import(
    pathToFileURL(join(root, "credential-ipc.mjs")).href
  );
  const filePath = join(app.getPath("userData"), "credentials.json");
  const store = createCredentialStore({ filePath, safeStorage });
  registerCredentialIpc({ ipcMain, store });
  return { store, filePath };
}

async function runSmoke() {
  await app.whenReady();
  const { filePath } = await registerCredentialSide();

  // 与产品环境一致：renderer 必须来自 127.0.0.1 本地阅读服务。
  const { createServer } = await import("node:http");
  const pageHtml = "<!doctype html><title>credential smoke</title>";
  const localServer = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(pageHtml);
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
    const bridge = window.nightStudyCredential;
    if (!bridge) return { ok: false, error: "no bridge" };
    const secret = "sk-smoke-secret-marker";
    const status = await bridge.status();
    const saved = await bridge.save("smoke-credential", secret);
    const loaded = await bridge.load("smoke-credential");
    const listed = await bridge.list();
    const removed = await bridge.remove("smoke-credential");
    const listedAfter = await bridge.list();
    return {
      ok: true,
      status,
      saved,
      loadedRoundTrip: loaded && loaded.secret === secret,
      listed,
      removed,
      listedAfter,
    };
  })()`, true);

  let onDiskPlaintextLeak = false;
  try {
    const raw = readFileSync(filePath, "utf8");
    if (raw.includes("sk-smoke-secret-marker")) onDiskPlaintextLeak = true;
  } catch {
    // remove 后文件可能只含空记录，仍应检查。
  }

  const passed = Boolean(
    result.ok &&
    result.status?.ok &&
    result.status.available === true &&
    result.saved?.ok &&
    result.loadedRoundTrip === true &&
    Array.isArray(result.listed?.ids) &&
    result.listed.ids.length === 1 &&
    result.removed?.ok &&
    result.removed.removed === true &&
    Array.isArray(result.listedAfter?.ids) &&
    result.listedAfter.ids.length === 0 &&
    !onDiskPlaintextLeak
  );

  console.log(`CREDENTIAL_SMOKE_RESULT ${JSON.stringify({
    ...result,
    onDiskPlaintextLeak,
    passed,
  })}`);
  app.exit(passed ? 0 : 1);
}

runSmoke().catch((error) => {
  console.error(`CREDENTIAL_SMOKE_FAILED ${error?.message ?? error}`);
  app.exit(1);
});
