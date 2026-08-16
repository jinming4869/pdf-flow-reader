// archive-electron-smoke.cjs — 归档 IPC 与文件导出的真实 Electron 实测
//
// 验证 renderer 通过 preload 窄 API 设置目的地、导出一条痕迹、
// 队列入队与重试，产物落盘正确且幂等跳过。

const { app, BrowserWindow, ipcMain } = require("electron");
const { existsSync, mkdtempSync, readdirSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { dirname, join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

const root = resolve(__dirname, "..");
const productPreload = join(root, "electron-preload.cjs");
const tempRoot = mkdtempSync(join(tmpdir(), "night-study-archive-"));
app.setPath("userData", join(tempRoot, "profile"));
app.once("quit", () => rmSync(tempRoot, { recursive: true, force: true }));

async function registerArchiveSide() {
  const { createArchiveRepository } = await import(
    pathToFileURL(join(root, "archive-repository.mjs")).href
  );
  const { registerArchiveIpc } = await import(
    pathToFileURL(join(root, "archive-ipc.mjs")).href
  );
  const repository = createArchiveRepository({
    configPath: join(app.getPath("userData"), "archive-config.json"),
    queuePath: join(app.getPath("userData"), "archive-queue.json"),
  });
  registerArchiveIpc({ ipcMain, repository });
  return repository;
}

function sampleTrace() {
  return {
    schemaVersion: 1,
    id: "trace_smoke",
    documentId: "doc_1",
    documentFingerprint: "v1:smoke:1:2",
    pageIndex: 0,
    lassoPath: [{ x: 0.1, y: 0.2, time: 0 }],
    source: { text: "合成圈选文字，不含私人内容。", provenance: "native-text" },
    readingContext: {
      speedTier: "long-day",
      speedPxPerSecond: 16,
      readingOrder: 0,
      capturedAt: "2026-08-16T03:58:00.000Z",
    },
    crop: {
      state: "ready",
      reference: "crops/trace_smoke.png",
      mimeType: "image/png",
      width: 320,
      height: 200,
      errorCode: null,
      updatedAt: "2026-08-16T03:58:00.000Z",
    },
    emotion: {
      state: "placed",
      original: { valence: 0.5, arousal: -0.3 },
      current: { valence: -0.5, arousal: -0.5 },
      updatedAt: "2026-08-16T03:58:10.000Z",
    },
    lifecycle: "active",
    trashedAt: null,
    purgeAfter: null,
    purgedAt: null,
    revision: 1,
    createdAt: "2026-08-16T03:58:00.000Z",
    updatedAt: "2026-08-16T03:58:10.000Z",
  };
}

async function runSmoke() {
  await app.whenReady();
  const destination = join(tempRoot, "vault");
  await registerArchiveSide();

  const { createServer } = await import("node:http");
  const localServer = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end("<!doctype html><title>archive smoke</title>");
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
    const bridge = window.nightStudyArchive;
    if (!bridge) return { ok: false, error: "no bridge" };
    const trace = ${JSON.stringify(sampleTrace())};
    const set = await bridge.setDestination("folder", ${JSON.stringify(destination)});
    const exported = await bridge.exportTrace({
      trace,
      documentName: "归档烟测书.pdf",
      echoText: "一句合成复述。",
      cropBytes: new Uint8Array([1, 2, 3]),
    });
    const exportedAgain = await bridge.exportTrace({
      trace,
      documentName: "归档烟测书.pdf",
      echoText: "一句合成复述。",
      cropBytes: new Uint8Array([1, 2, 3]),
    });
    const queued = await bridge.enqueue({ traceId: "trace-smoke-2", documentName: "归档烟测书.pdf" });
    const status = await bridge.status();
    const cleared = await bridge.clearDestination();
    const statusAfter = await bridge.status();
    return { ok: true, set, exported, exportedAgain, queued, status, cleared, statusAfter };
  })()`, true);

  const bookDirectory = join(destination, "归档烟测书.pdf");
  const filesOnDisk = existsSync(bookDirectory) ? readdirSync(bookDirectory) : [];
  const passed = Boolean(
    result.ok &&
    result.set?.ok &&
    result.exported?.ok &&
    result.exported.status === "written" &&
    result.exportedAgain?.ok &&
    result.exportedAgain.status === "skipped" &&
    result.queued?.ok &&
    result.status?.ok &&
    result.status.queue.pending.length === 1 &&
    result.cleared?.ok &&
    result.statusAfter?.ok &&
    result.statusAfter.destination === null &&
    filesOnDisk.some((file) => file.endsWith(".md")) &&
    filesOnDisk.some((file) => file.endsWith(".png"))
  );

  console.log(`ARCHIVE_SMOKE_RESULT ${JSON.stringify({
    ...result,
    filesOnDisk,
    passed,
  })}`);
  app.exit(passed ? 0 : 1);
}

runSmoke().catch((error) => {
  console.error(`ARCHIVE_SMOKE_FAILED ${error?.message ?? error}`);
  app.exit(1);
});
