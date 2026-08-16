import { app, BrowserWindow, ipcMain, Menu, nativeImage, shell } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createReaderServer } from "./server.mjs";
import { registerTraceIpc } from "./trace-ipc.mjs";
import { createTraceRepository } from "./trace-repository.mjs";
import { createCredentialStore } from "./credential-store.mjs";
import { registerCredentialIpc } from "./credential-ipc.mjs";
import { createArchiveRepository } from "./archive-repository.mjs";
import { registerArchiveIpc } from "./archive-ipc.mjs";

const appRoot = dirname(fileURLToPath(import.meta.url));
const applicationName = "夜晚的书斋";
const iconCheckIntervalMs = 5 * 60 * 1000;
const headlessSmokeMode = process.env.NIGHT_STUDY_HEADLESS_SMOKE === "1";
const smokeUserData = process.env.NIGHT_STUDY_SMOKE_USER_DATA
  ? resolve(process.env.NIGHT_STUDY_SMOKE_USER_DATA)
  : null;

if (headlessSmokeMode && smokeUserData) {
  mkdirSync(smokeUserData, { recursive: true });
  app.setPath("userData", smokeUserData);
}

let mainWindow = null;
let readerServer = null;
let readerUrl = null;
let activeIconMode = null;
let iconTimer = null;
let traceRepository = null;
let disposeTraceIpc = null;
let credentialStore = null;
let disposeCredentialIpc = null;
let archiveRepository = null;
let disposeArchiveIpc = null;
let pendingPdfPath = findPdfArgument(process.argv.slice(1));

process.on("unhandledRejection", (reason) => {
  console.error("夜晚的书斋主进程未处理异步错误：", reason);
});

process.on("uncaughtException", (error) => {
  console.error("夜晚的书斋主进程异常：", error);
});

function findPdfArgument(args) {
  for (const arg of args) {
    if (!arg || arg.startsWith("--")) continue;
    const candidate = resolve(arg);
    if (extname(candidate).toLowerCase() === ".pdf" && existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function iconModeForDate(date = new Date()) {
  const hour = date.getHours();
  return hour >= 6 && hour < 18 ? "day" : "night";
}

function iconPathForMode(mode) {
  return join(appRoot, "build", mode === "day" ? "icon-day.png" : "icon-night.png");
}

function iconImageForMode(mode) {
  return nativeImage.createFromPath(iconPathForMode(mode));
}

function applyApplicationIcon(date = new Date(), { force = false } = {}) {
  const mode = iconModeForDate(date);
  if (!force && activeIconMode === mode) return;

  const image = iconImageForMode(mode);
  if (image.isEmpty()) return;

  activeIconMode = mode;
  if (process.platform === "darwin" && app.dock) {
    app.dock.setIcon(image);
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setIcon(image);
  }
}

function startIconSchedule() {
  applyApplicationIcon(new Date(), { force: true });
  if (iconTimer) clearInterval(iconTimer);
  iconTimer = setInterval(() => applyApplicationIcon(), iconCheckIntervalMs);
  iconTimer.unref?.();
}

function startReaderServer(pdfPath = null) {
  return new Promise((resolveStart, rejectStart) => {
    const server = createReaderServer({ pdfPath });
    const onError = (error) => {
      server.off("listening", onListening);
      rejectStart(error);
    };
    const onListening = () => {
      server.off("error", onError);
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        rejectStart(new Error("本地阅读服务没有取得端口。"));
        return;
      }
      server.on("error", (error) => {
        console.error("本地阅读服务运行时错误：", error);
      });
      resolveStart({ server, url: `http://127.0.0.1:${address.port}/` });
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });
}

async function ensureReaderServer(pdfPath = pendingPdfPath) {
  if (readerServer && readerUrl) return readerUrl;

  const started = await startReaderServer(pdfPath);
  readerServer = started.server;
  readerUrl = started.url;
  return readerUrl;
}

async function initializeTraceInfrastructure() {
  try {
    traceRepository = createTraceRepository({
      rootPath: join(app.getPath("userData"), "reading-traces"),
    });
    await traceRepository.initialize();
    const recovery = await traceRepository.recover();
    const purged = await traceRepository.purgeExpired();
    disposeTraceIpc = registerTraceIpc({ ipcMain, repository: traceRepository });
    if (recovery.removedTemps || recovery.quarantined.length || purged.length) {
      console.info("航迹本地仓库已恢复：", {
        removedTemps: recovery.removedTemps,
        quarantined: recovery.quarantined.length,
        purged: purged.length,
      });
    }
    return true;
  } catch (error) {
    traceRepository = null;
    disposeTraceIpc?.();
    disposeTraceIpc = null;
    console.error("航迹本地仓库暂不可用，基础阅读仍可继续：", error);
    return false;
  }
}

async function initializeCredentialInfrastructure() {
  try {
    const { safeStorage } = await import("electron");
    credentialStore = createCredentialStore({
      filePath: join(app.getPath("userData"), "credentials.json"),
      safeStorage,
    });
    const availability = credentialStore.status();
    if (!availability.available) {
      console.info("系统凭据存储不可用，AI 功能将保持禁用。");
    }
    disposeCredentialIpc = registerCredentialIpc({ ipcMain, store: credentialStore });
    return availability.available;
  } catch (error) {
    credentialStore = null;
    disposeCredentialIpc?.();
    disposeCredentialIpc = null;
    console.error("系统凭据暂不可用，AI 功能将保持禁用：", error);
    return false;
  }
}

async function initializeArchiveInfrastructure() {
  try {
    archiveRepository = createArchiveRepository({
      configPath: join(app.getPath("userData"), "archive-config.json"),
      queuePath: join(app.getPath("userData"), "archive-queue.json"),
    });
    disposeArchiveIpc = registerArchiveIpc({ ipcMain, repository: archiveRepository });
    return true;
  } catch (error) {
    archiveRepository = null;
    disposeArchiveIpc?.();
    disposeArchiveIpc = null;
    console.error("归档基础设施暂不可用：", error);
    return false;
  }
}

async function runCredentialSelfCheck() {
  try {
    const marker = "night-study-credential-smoke-secret";
    const status = credentialStore?.status?.() ?? { available: false };
    const result = { status };
    if (status.available) {
      await credentialStore.save("smoke-credential", marker);
      result.roundTrip = (await credentialStore.load("smoke-credential")) === marker;
      await credentialStore.remove("smoke-credential");
      result.remaining = await credentialStore.list();
    }
    const credentialFile = join(app.getPath("userData"), "credentials.json");
    try {
      result.onDiskLeak = readFileSync(credentialFile, "utf8").includes(marker);
    } catch {
      result.onDiskLeak = false;
    }
    result.passed = Boolean(
      status.available && result.roundTrip === true && result.onDiskLeak === false
    );
    console.log(`CREDENTIAL_SELF_CHECK ${JSON.stringify(result)}`);
    try {
      writeFileSync(
        join(app.getPath("temp"), "night-study-credential-check.json"),
        JSON.stringify(result),
        "utf8",
      );
    } catch {
      // 诊断文件写入失败不影响自检结论。
    }
    setTimeout(() => app.exit(result.passed ? 0 : 1), 0);
    return true;
  } catch (error) {
    console.error(`CREDENTIAL_SELF_CHECK_FAILED ${error?.message ?? error}`);
    setTimeout(() => app.exit(1), 0);
    return false;
  }
}

async function runHeadlessSmoke(window) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const result = await window.webContents.executeJavaScript(`(() => ({
      title: document.title,
      documentName: document.querySelector("#documentName")?.textContent || "",
      canvasCount: document.querySelectorAll("canvas.page-canvas").length,
      traceLassoVisible: !document.querySelector("#traceLassoButton")?.hidden,
      traceBookVisible: !document.querySelector("#traceBookButton")?.hidden,
      errorHidden: document.querySelector("#errorPanel")?.hidden ?? false,
      emptyVisible: !document.querySelector("#emptyState")?.hidden,
    }))()`, true);
    const ready = pendingPdfPath
      ? result.canvasCount > 0 && result.traceLassoVisible && result.errorHidden
      : result.emptyVisible;
    if (ready) {
      return {
        version: app.getVersion(),
        ...result,
      };
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("Packaged headless smoke timed out before the reader became ready.");
}

async function createMainWindow() {
  const url = await ensureReaderServer();
  const initialIcon = iconImageForMode(iconModeForDate());

  mainWindow = new BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 820,
    minHeight: 560,
    title: applicationName,
    icon: initialIcon,
    backgroundColor: "#f5efe6",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(appRoot, "electron-preload.cjs"),
    },
  });

  mainWindow.once("ready-to-show", () => {
    applyApplicationIcon(new Date(), { force: true });
    if (!headlessSmokeMode) mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (/^https?:\/\//i.test(targetUrl)) {
      shell.openExternal(targetUrl);
    }
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(url);
  if (headlessSmokeMode) {
    const result = await runHeadlessSmoke(mainWindow);
    console.log(`HEADLESS_SMOKE_RESULT ${JSON.stringify(result)}`);
    setTimeout(() => app.quit(), 0);
  }
}

function installApplicationMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" },
      ],
    },
    {
      label: "窗口",
      submenu: [
        { role: "minimize", label: "最小化" },
        { role: "zoom", label: "缩放" },
        { type: "separator" },
        { role: "front", label: "全部置于顶层" },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.setName(applicationName);

app.on("open-file", (event, filePath) => {
  event.preventDefault();
  if (extname(filePath).toLowerCase() !== ".pdf") return;
  pendingPdfPath = filePath;
  if (mainWindow && readerUrl) {
    mainWindow.loadURL(readerUrl).catch(() => {});
  }
});

function writeBootProbe(stage, detail = null) {
  if (process.env.NIGHT_STUDY_CREDENTIAL_SMOKE !== "1") return;
  try {
    writeFileSync(
      join(app.getPath("temp"), "night-study-boot-probe.json"),
      JSON.stringify({ stage, detail, at: Date.now() }),
      "utf8",
    );
  } catch {
    // 探针写入失败不影响启动。
  }
}

writeBootProbe("module-loaded");

app.whenReady().then(async () => {
  writeBootProbe("ready");
  installApplicationMenu();
  writeBootProbe("menu");
  startIconSchedule();
  writeBootProbe("icon");
  await initializeTraceInfrastructure();
  writeBootProbe("trace");
  await initializeCredentialInfrastructure();
  writeBootProbe("credential", credentialStore?.status() ?? null);
  await initializeArchiveInfrastructure();
  writeBootProbe("archive");
  if (process.env.NIGHT_STUDY_CREDENTIAL_SMOKE === "1") {
    await runCredentialSelfCheck();
    return;
  }
  await createMainWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  disposeTraceIpc?.();
  disposeTraceIpc = null;
  traceRepository = null;
  disposeCredentialIpc?.();
  disposeCredentialIpc = null;
  credentialStore = null;
  disposeArchiveIpc?.();
  disposeArchiveIpc = null;
  archiveRepository = null;
  if (iconTimer) {
    clearInterval(iconTimer);
    iconTimer = null;
  }
  if (!readerServer) return;
  const server = readerServer;
  readerServer = null;
  readerUrl = null;
  server.close();
});
