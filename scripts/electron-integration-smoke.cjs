const { app, BrowserWindow, ipcMain } = require("electron");
const {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { dirname, join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

const root = resolve(__dirname, "..");
const integrationPreload = join(__dirname, "electron-integration-preload.cjs");
const productPreload = join(root, "electron-preload.cjs");
const tempRoot = mkdtempSync(join(tmpdir(), "night-study-integration-"));
const profileRoot = join(tempRoot, "electron-profile");
const captureDirectory = process.env.ELECTRON_SMOKE_CAPTURE_DIR
  ? resolve(process.env.ELECTRON_SMOKE_CAPTURE_DIR)
  : null;

mkdirSync(profileRoot, { recursive: true });
app.setPath("userData", profileRoot);
app.once("quit", () => rmSync(tempRoot, { recursive: true, force: true }));

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

function createSyntheticPdf(filePath) {
  const stream = [
    "BT",
    "/F1 24 Tf",
    "72 700 Td",
    "(Night Study integration smoke) Tj",
    "0 -40 Td",
    "/F1 14 Tf",
    "(Local synthetic PDF. No private document content.) Tj",
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /ID [<AABBCCDDEEFF00112233445566778899><AABBCCDDEEFF00112233445566778899>] >>\n`;
  body += `startxref\n${xrefOffset}\n%%EOF\n`;
  writeFileSync(filePath, body);
}

function listen(server) {
  return new Promise((resolveListen, rejectListen) => {
    const onError = (error) => {
      server.off("listening", onListening);
      rejectListen(error);
    };
    const onListening = () => {
      server.off("error", onError);
      const address = server.address();
      if (!address || typeof address === "string") {
        rejectListen(new Error("Integration server did not receive a TCP port."));
        return;
      }
      resolveListen(`http://127.0.0.1:${address.port}/`);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });
}

function closeServer(server) {
  if (!server?.listening) return Promise.resolve();
  return new Promise((resolveClose) => server.close(resolveClose));
}

function createWindow(preloadPath = integrationPreload) {
  return new BrowserWindow({
    width: 1180,
    height: 860,
    show: false,
    backgroundColor: "#f5efe6",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: preloadPath,
    },
  });
}

async function loadUrl(window, url, label) {
  try {
    await window.loadURL(url);
  } catch (error) {
    throw new Error(`${label} failed to load ${url}: ${error.message}`, { cause: error });
  }
}

async function waitFor(window, expression, timeoutMs = 10_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await window.webContents.executeJavaScript(expression, true)) return;
    await wait(100);
  }
  throw new Error(`Timed out waiting for renderer expression: ${expression}`);
}

async function seedShelf(window) {
  await window.webContents.executeJavaScript(`(() => {
    const now = new Date().toISOString();
    const documents = {};
    ["庄子集释.pdf", "Feynman Lectures.pdf", "李商隐诗选.pdf"].forEach((fileName, index) => {
      const id = "doc_smoke_" + index;
      documents[id] = {
        id,
        fileName,
        fileSize: 1000 + index,
        lastModified: 1700000000000 + index,
        fingerprint: "smoke:" + index,
        lastPageIndex: index * 10,
        lastScrollTop: index * 100,
        progressRatio: [0.18, 0.42, 0.67][index],
        lastSpeedPxPerSecond: [8, 16, 24][index],
        lastBandKey: ["snow-mist", "aesthetic-walk", "long-day"][index],
        openedAt: now,
        updatedAt: new Date(Date.now() - index * 1000).toISOString(),
      };
    });
    localStorage.setItem("pdf-flow-reader:v3:local-state", JSON.stringify({
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
      documents,
      rhythmRecords: {},
      preferences: { recentDocumentLimit: 6, restoreLastPositionEnabled: true },
    }));
    return true;
  })()`, true);
}

async function probeShelf(window) {
  return window.webContents.executeJavaScript(`(() => {
    const list = document.querySelector("#recentBooks");
    const selected = document.querySelector(".recent-book-card.is-selected");
    let pointerProbe = null;
    selected.addEventListener("pointerdown", (event) => {
      pointerProbe = {
        type: event.pointerType,
        x: event.clientX,
        y: event.clientY,
      };
    }, { once: true });
    selected.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: "mouse",
      clientX: 24,
      clientY: 32,
    }));
    list.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "ArrowRight",
      key: "ArrowRight",
    }));
    return {
      cardCount: document.querySelectorAll(".recent-book-card").length,
      selectedTitle: document.querySelector("#bookSelectionTitle").textContent,
      pointerProbe,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  })()`, true);
}

async function capture(window, filename) {
  if (!captureDirectory) return null;
  mkdirSync(captureDirectory, { recursive: true });
  const target = join(captureDirectory, filename);
  writeFileSync(target, (await window.webContents.capturePage()).toPNG());
  return filename;
}

function closeWindow(window) {
  if (window.isDestroyed()) return Promise.resolve();
  return new Promise((resolveClose) => {
    window.once("closed", resolveClose);
    window.close();
  });
}

async function run() {
  const pdfPath = join(tempRoot, "integration-smoke.pdf");
  createSyntheticPdf(pdfPath);

  const [
    { createReaderServer },
    { createTraceRepository },
    { registerTraceIpc },
  ] = await Promise.all([
    import(pathToFileURL(join(root, "server.mjs")).href),
    import(pathToFileURL(join(root, "trace-repository.mjs")).href),
    import(pathToFileURL(join(root, "trace-ipc.mjs")).href),
  ]);
  const shelfServer = createReaderServer({ appRoot: root });
  const readerServer = createReaderServer({ appRoot: root, pdfPath });
  const traceRepository = createTraceRepository({ rootPath: join(tempRoot, "trace-store") });
  await traceRepository.initialize();
  await traceRepository.recover();
  const windows = [];

  ipcMain.handle("night-study:integration-ping", () => ({ ok: true, channel: "isolated-preload" }));
  const disposeTraceIpc = registerTraceIpc({ ipcMain, repository: traceRepository });

  try {
    const [shelfUrl, readerUrl] = await Promise.all([
      listen(shelfServer),
      listen(readerServer),
    ]);

    const firstWindow = createWindow();
    windows.push(firstWindow);
    await loadUrl(firstWindow, shelfUrl, "initial shelf");
    await seedShelf(firstWindow);
    await loadUrl(firstWindow, shelfUrl, "seeded shelf");
    await waitFor(firstWindow, `document.querySelectorAll(".recent-book-card").length === 4`);
    await waitFor(firstWindow, `document.querySelector("#homeEcho")?.classList.contains("is-ready")`);

    const shelf = await probeShelf(firstWindow);
    const ipc = await firstWindow.webContents.executeJavaScript(
      `window.__nightStudyIntegration.ping()`,
      true,
    );
    await firstWindow.webContents.executeJavaScript(`(() => {
      document.querySelector("#homeEcho")?.scrollIntoView({ block: "center" });
      return true;
    })()`, true);
    await wait(700);
    shelf.selectedOpacity = await firstWindow.webContents.executeJavaScript(
      `Number.parseFloat(getComputedStyle(document.querySelector(".recent-book-card.is-selected")).opacity)`,
      true,
    );
    if (shelf.selectedOpacity < 0.99) {
      throw new Error(`Selected shelf card did not become visible: ${shelf.selectedOpacity}`);
    }
    const shelfCapture = await capture(firstWindow, "electron-bookshelf.png");
    await closeWindow(firstWindow);
    await wait(100);

    const restartedWindow = createWindow();
    windows.push(restartedWindow);
    await loadUrl(restartedWindow, shelfUrl, "restarted shelf");
    await waitFor(restartedWindow, `document.querySelectorAll(".recent-book-card").length === 4`);
    const restartPersistence = await restartedWindow.webContents.executeJavaScript(`(() => ({
      cardCount: document.querySelectorAll(".recent-book-card").length,
      firstTitle: document.querySelector(".recent-book-card")?.getAttribute("aria-label") || "",
    }))()`, true);

    await loadUrl(restartedWindow, readerUrl, "synthetic PDF reader");
    await waitFor(
      restartedWindow,
      `document.querySelectorAll("canvas.page-canvas").length === 1 && document.querySelector(".page-shell.rendered")`,
    );
    const reader = await restartedWindow.webContents.executeJavaScript(`(() => ({
      title: document.title,
      documentName: document.querySelector("#documentName").textContent,
      pageStatus: document.querySelector("#pageStatus").textContent,
      canvasCount: document.querySelectorAll("canvas.page-canvas").length,
      renderedShellCount: document.querySelectorAll(".page-shell.rendered").length,
      errorHidden: document.querySelector("#errorPanel").hidden,
    }))()`, true);
    const readerCapture = await capture(restartedWindow, "electron-reader.png");

    const productWindow = createWindow(productPreload);
    windows.push(productWindow);
    await loadUrl(productWindow, shelfUrl, "product trace preload");
    await waitFor(productWindow, `typeof window.nightStudyTrace === "object"`);
    const traceBridge = await productWindow.webContents.executeJavaScript(`(async () => {
      const api = window.nightStudyTrace;
      const call = async (method, ...args) => {
        const response = await api[method](...args);
        if (!response?.ok) {
          const error = new Error(response?.error?.message || "Trace operation failed.");
          error.code = response?.error?.code || "TRACE_IPC_FAILED";
          throw error;
        }
        return response.value;
      };
      const capabilities = await call("capabilities");
      const document = await call("registerDocument", {
        id: "doc-integration",
        fingerprint: "sha256:integration-document",
        displayName: "integration-smoke.pdf",
        fileSize: 1024,
      });
      const created = await call("createDraft", {
        id: "trace-integration",
        documentId: document.id,
        documentFingerprint: document.fingerprint,
        pageIndex: 0,
        lassoPath: [
          { x: 0.1, y: 0.1 },
          { x: 0.8, y: 0.1 },
          { x: 0.4, y: 0.8 },
        ],
        sourceText: "Synthetic trace text.",
        sourceProvenance: "native",
        speedTier: "long-day",
        speedPxPerSecond: 20,
      });
      const listed = await call("listTraces", document.id);
      const transitioned = await call(
        "transitionTrace",
        document.id,
        created.id,
        { type: "CROP_FAILED", errorCode: "INTEGRATION_PROBE" },
        { expectedRevision: created.revision },
      );
      let conflictCode = null;
      try {
        await call(
          "transitionTrace",
          document.id,
          created.id,
          { type: "RETRY_CROP" },
          { expectedRevision: created.revision },
        );
      } catch (error) {
        conflictCode = error.code || null;
      }
      if (conflictCode !== "TRACE_REVISION_CONFLICT") {
        throw new Error("Trace IPC lost its public error code: " + conflictCode);
      }
      return {
        capabilities,
        documentId: document.id,
        traceId: created.id,
        readingOrder: created.readingContext.readingOrder,
        listedCount: listed.length,
        cropState: transitioned.crop.state,
        revision: transitioned.revision,
        conflictCode,
        pathForFileType: typeof api.pathForFile,
      };
    })()`, true);

    return {
      ok: true,
      security: { contextIsolation: true, nodeIntegration: false, sandbox: true },
      ipc,
      traceBridge,
      shelf,
      restartPersistence,
      reader,
      captures: [shelfCapture, readerCapture].filter(Boolean),
    };
  } finally {
    for (const window of windows) {
      if (!window.isDestroyed()) window.destroy();
    }
    disposeTraceIpc();
    ipcMain.removeHandler("night-study:integration-ping");
    await Promise.all([closeServer(shelfServer), closeServer(readerServer)]);
  }
}

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-gpu-compositing");
app.on("window-all-closed", () => {});
app.whenReady()
  .then(run)
  .then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
